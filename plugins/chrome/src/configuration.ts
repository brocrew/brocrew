import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import releaseMetadata from '../manifest-template.json' with { type: 'json' }
import type { ProfileStore, ProfileFlags } from './profiles/store.js'
import { FLAG_NAMES, isProfileName, ProfileStoreError } from './profiles/store.js'
import { ProfileInUseError } from './browser/profileBrowser.js'
import type { ProfileBrowser } from './browser/profileBrowser.js'
import type { ProfileOpener } from './openWindow.js'
import type { TabRegistry } from './tabs.js'
import { bareUrl } from './tabs.js'
import { PublicToolError } from './shared/toolServer.js'
import type { ToolHandler, ToolDefinition } from './shared/toolServer.js'

export interface ConfigurationDeps {
  store: ProfileStore
  browser: ProfileBrowser
  opener: Pick<ProfileOpener, 'open'>
}
const actions = [
  'create-profile',
  'set-enabled',
  'set-flags',
  'open-window',
  'delete-profile',
  'helper-on',
  'rename-profile',
]
const profile = { type: 'string', minLength: 1, maxLength: 32, pattern: '^[a-z0-9-]+$' }
const refuse = (message: string): never => {
  throw new PublicToolError(message)
}

const configurationProperties = {
  profile,
  action: { type: 'string', enum: actions },
  newName: { type: 'string' },
  confirm: { type: 'string' },
  deleteConfirmation: { type: 'string' },
  ...Object.fromEntries(FLAG_NAMES.map((name) => [name, { type: 'boolean' }])),
}
export const configurationDefinition: ToolDefinition = {
  name: 'configure_profile',
  description: 'Configure one explicitly named Chrome profile.',
  inputSchema: {
    type: 'object',
    properties: configurationProperties,
    required: ['profile', 'action'],
    additionalProperties: false,
  },
}

/** Configure uses ordinary MCP operations; every mutating operation names its target. */
export function createConfigurationTools(deps: ConfigurationDeps): ToolHandler[] {
  const { store, browser } = deps
  const properties = configurationProperties
  return [
    {
      definition: configurationDefinition,
      async execute(args, metadata) {
        if (
          metadata.origin !== 'settings.page' ||
          typeof metadata.workspaceId !== 'string' ||
          !metadata.workspaceId.trim() ||
          !(
            (typeof metadata.requestId === 'string' && metadata.requestId.length > 0) ||
            (typeof metadata.requestId === 'number' && Number.isFinite(metadata.requestId))
          )
        )
          return refuse('Open Chrome Configure to change profile settings.')
        if (!isProfileName(args.profile)) return refuse('Give an explicit Chrome profile name.')
        const name = args.profile
        if (
          typeof args.action !== 'string' ||
          !actions.includes(args.action) ||
          Object.keys(args).some((key) => !(key in properties))
        )
          return refuse('Unknown configuration action or field.')
        const allowed: Record<string, string[]> = {
          'create-profile': [],
          'set-enabled': ['enabled'],
          'set-flags': [...FLAG_NAMES],
          'open-window': [],
          'delete-profile': ['confirm', 'deleteConfirmation'],
          'helper-on': [],
          'rename-profile': ['newName'],
        }
        if (
          Object.keys(args).some(
            (key) => !['profile', 'action', ...allowed[args.action as string]].includes(key),
          )
        )
          return refuse('This field does not apply to that action.')
        try {
          if (args.action === 'create-profile') store.create(name, 'panel')
          else {
            const rec = store.get(name)
            if (!rec) return refuse('There is no such profile.')
            switch (args.action) {
              case 'set-enabled':
              case 'set-flags': {
                const flags = Object.fromEntries(
                  FLAG_NAMES.filter((key) => args[key] !== undefined).map((key) => [
                    key,
                    args[key],
                  ]),
                )
                if (
                  !Object.keys(flags).length ||
                  Object.values(flags).some((value) => typeof value !== 'boolean')
                )
                  return refuse('Give at least one boolean profile flag.')
                if (
                  rec.temporary &&
                  ['allowExtensions', 'allowSettings', 'allowSync', 'keepRunning'].some(
                    (key) => flags[key] === true,
                  )
                )
                  return refuse('Temporary profiles cannot receive account access or keep running.')
                store.setFlags(name, flags as Partial<ProfileFlags>)
                if (
                  flags.enabled === false ||
                  (flags.allowExtensions !== undefined &&
                    flags.allowExtensions !== rec.allowExtensions)
                )
                  await browser.exclusive(name, () => browser.close(name))
                break
              }
              case 'open-window':
                if (rec.temporary)
                  return refuse('A temporary profile cannot be opened for the person.')
                await deps.opener.open(name)
                break
              case 'helper-on':
                if (!rec.enabled)
                  return refuse('Enable this profile first, then turn the helper on.')
                store.setHelper(name, 'turning-on')
                await browser.turnHelperOn(name)
                break
              case 'rename-profile':
                if (typeof args.newName !== 'string') return refuse('Give a profile display name.')
                store.rename(name, args.newName)
                break
              case 'delete-profile':
                if (args.confirm !== name) return refuse('Type the profile name to confirm.')
                await browser.removeWhenIdle(name, () => {
                  if (store.shared?.view(name).shared === true) {
                    if (typeof args.deleteConfirmation !== 'string')
                      return refuse('Review the global deletion warning first.')
                    store.shared.remove(name, args.deleteConfirmation)
                  } else {
                    store.setFlags(name, { enabled: false })
                    store.remove(name)
                  }
                })
                break
            }
          }
        } catch (error) {
          if (args.action === 'delete-profile' && error instanceof ProfileInUseError)
            return refuse(
              'Turn this profile off and wait for agent work to finish, then try again.',
            )
          if (error instanceof ProfileStoreError) return refuse(error.message)
          throw error
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ profile: name, completed: true }) }],
        }
      },
    },
  ]
}

/** Unscoped discovery is a Configure concern, separate from profile business actions. */
export async function configurationSnapshot(
  deps: Pick<ConfigurationDeps, 'store' | 'browser'> & { tabs: TabRegistry },
): Promise<Record<string, unknown>> {
  const profiles = deps.store.list().map((rec) => ({
    ...rec,
    ...deps.store.shared?.view(rec.name),
    ...(rec.deleting ? { status: 'deleting' } : {}),
    open: deps.browser.state(rec.name) !== null,
    mode: deps.browser.state(rec.name)?.mode ?? null,
    helperOff: rec.helper === 'off',
  }))
  const tabs = await Promise.all(
    deps.tabs
      .list((name) => deps.browser.state(name)?.generation ?? null)
      .slice(0, 200)
      .map(async (tab) => ({
        id: tab.id,
        profile: tab.profile,
        url: bareUrl(tab.page.url()).slice(0, 2048),
        title: await Promise.race([
          tab.page.title().catch(() => ''),
          new Promise<string>((resolve) => {
            const timer = setTimeout(() => resolve(''), 250)
            timer.unref()
          }),
        ]).then((value) => value.slice(0, 512)),
      })),
  )
  return { configRevision: 0, profiles, tabs }
}

// This server uses the same MCP request path for page and agent calls.
export function createChromeMcpServer(tools: ToolHandler[]): Server {
  const server = new Server(
    { name: 'brocrew-chrome', version: releaseMetadata.version },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => tool.definition),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((item) => item.definition.name === request.params.name)
    if (!tool) return { isError: true, content: [{ type: 'text', text: 'Unknown Chrome tool.' }] }
    try {
      return await tool.execute(request.params.arguments ?? {}, request.params._meta ?? {})
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              error instanceof PublicToolError
                ? error.message.slice(0, 2000)
                : 'Plugin unavailable. Try again.',
          },
        ],
      }
    }
  })
  return server
}

/** Profileless discovery is explicitly permitted for Configure and agent questions. */
export const configurationDiscoveryDefinition: ToolDefinition = {
  name: 'configuration_snapshot',
  description:
    'Discover Chrome profile names and configuration before choosing a named profile. This discovery does not act on a browser.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
}
export function createConfigurationDiscovery(
  deps: Pick<ConfigurationDeps, 'store' | 'browser'> & { tabs: TabRegistry },
): ToolHandler {
  return {
    definition: configurationDiscoveryDefinition,
    async execute(args) {
      if (Object.keys(args).length) return refuse('Configuration discovery takes no arguments.')
      return {
        content: [{ type: 'text', text: JSON.stringify(await configurationSnapshot(deps)) }],
      }
    },
  }
}
