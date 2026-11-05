import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
// Real package subjects. Only native browser/account seams use the packages' own fakes.
// This module implements no domain action, schema, policy, ledger or transport adapter.
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { vi } from 'vitest'
import { PluginProfileLedger as Encoder820 } from './fixtures/plugin-encoder-820/profile-ledger'

const roots: string[] = []
const connections: Array<() => Promise<unknown>> = []
export async function cleanupRetirementSubjects() {
  for (const close of connections.splice(0).reverse()) await close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
}
export async function subjectRoot() {
  const root = await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'retirement-'))
  roots.push(root)
  return root
}
export const personMetadata = {
  origin: 'settings.page',
  workspaceId: 'fictional-workspace',
  requestId: 'fictional-person-press',
}
export interface CurrentTool {
  definition: { name: string; inputSchema: Record<string, unknown> }
  execute(
    args: Record<string, unknown>,
    context: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: string; text?: string }>
    structuredContent?: Record<string, unknown>
    isError?: boolean
  }>
}
export interface CurrentProfiles {
  create(name: string, by: 'panel' | 'agent', options?: { temporary: boolean }): unknown
  setFlags(name: string, flags: Record<string, boolean>): unknown
  setHelper(name: string, value: string): unknown
  get(name: string): Record<string, unknown> | undefined
  list(): Array<Record<string, unknown>>
  dirOf(name: string): string
  rename(name: string, displayName: string): unknown
}
export interface CurrentBrowser {
  helperTurnedOn: string[]
  state(name: string): unknown
  close(name: string): Promise<void>
  exclusive<T>(name: string, action: () => Promise<T>): Promise<T>
  turnHelperOn(name: string): Promise<void>
  removeWhenIdle(name: string, action: () => void): Promise<void>
}
export async function chromeSubject() {
  const home = await subjectRoot()
  const { createProfileStore } = await vi.importActual<{
    createProfileStore(options: { home: string }): CurrentProfiles
  }>('../../../plugins/chrome/src/profiles/store')
  const { FakeBrowser } = await vi.importActual<{
    FakeBrowser: new (dirOf: (name: string) => string) => CurrentBrowser
  }>('../../../plugins/chrome/test/fakes')
  const { TabRegistry } = await vi.importActual<{ TabRegistry: new () => unknown }>(
    '../../../plugins/chrome/src/tabs',
  )
  const { createConfigurationTools, configurationSnapshot } = await vi.importActual<{
    createConfigurationTools(deps: unknown): CurrentTool[]
    configurationSnapshot(deps: unknown): Promise<Record<string, unknown>>
  }>('../../../plugins/chrome/src/configuration')
  const store = createProfileStore({ home }),
    browser = new FakeBrowser(store.dirOf),
    tabs = new TabRegistry()
  const open = vi.fn(async (_name: string) => {
    void _name
  })
  const deps = { store, browser, tabs, opener: { open } }
  const tools = createConfigurationTools(deps)
  return {
    home,
    store,
    browser,
    open,
    tools,
    configure: tools.find((tool) => tool.definition.name === 'configure_profile')!,
    snapshot: () => configurationSnapshot(deps),
  }
}
export interface CurrentSettings {
  get(): { read: boolean; prefix: boolean; writable: string[] }
  setRead(enabled: boolean): void
  setPrefix(enabled: boolean): void
  setWritable(group: string, enabled: boolean): void
}
export interface CurrentBridge {
  state: string
  account: string
  unlinked: number
  requests: Array<{ route: string; body: unknown }>
  groupList: Array<{ jid: string; name: string }>
  status(): Record<string, unknown>
  groups(): readonly { jid: string; name: string }[]
  unlink(): Promise<void>
  pair(): Promise<boolean>
  refreshGroups(): Promise<void>
}
export async function whatsappSubject() {
  const home = await subjectRoot()
  const { createSettingsStore } = await vi.importActual<{
    createSettingsStore(home: string): CurrentSettings
  }>('../../../plugins/whatsapp/src/settings')
  const { FakeBridge } = await vi.importActual<{ FakeBridge: new () => CurrentBridge }>(
    '../../../plugins/whatsapp/test/fakes',
  )
  const { createConfigurationTools } = await vi.importActual<{
    createConfigurationTools(deps: unknown): CurrentTool[]
  }>('../../../plugins/whatsapp/src/tools/configuration')
  const settings = createSettingsStore(home),
    bridge = new FakeBridge()
  const tools = createConfigurationTools({ settings, bridge })
  return {
    home,
    settings,
    bridge,
    tools,
    tool: (name: string) => tools.find((tool) => tool.definition.name === name)!,
  }
}
export async function legacyImportSubject(plugin: 'chrome' | 'whatsapp') {
  const root = await subjectRoot(),
    legacy = join(root, 'historical-820'),
    home = join(root, 'selected', 'host', 'data', plugin)
  await mkdir(legacy, { mode: 0o700 })
  await mkdir(home, { recursive: true, mode: 0o700 })
  const installId = randomUUID(),
    encoder = new Encoder820(legacy)
  // The sole historical operation is production of real old reservation bytes in a temp root.
  const oldIo = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Historical encoder must never execute domain I/O'))
  try {
    await encoder.reserve(installId, 0, { action: 'set-enabled', profile: 'fern', enabled: false })
  } finally {
    oldIo.mockRestore()
  }
  const directory = join(
    legacy,
    'profile-apply',
    createHash('sha256').update(installId).digest('hex'),
  )
  const floor = join(legacy, 'profile-apply', installId + '.floor')
  const data = join(home, 'opaque-account.bin')
  await writeFile(data, Buffer.from([0, 255, 17, 10]))
  const subject = await (plugin === 'chrome'
    ? vi.importActual<{
        importLegacyConfiguration(
          home: string,
          input: { directory: string; floor: string },
        ): unknown
      }>('../../../plugins/chrome/src/legacyConfiguration')
    : vi.importActual<{
        importLegacyConfiguration(
          home: string,
          input: { directory: string; floor: string },
        ): unknown
      }>('../../../plugins/whatsapp/src/legacyConfiguration'))
  const marker = join(
    home,
    plugin === 'chrome' ? 'legacy-configuration-import.json' : 'legacy-configuration.json',
  )
  const input = { directory, floor }
  const inventory = async (): Promise<Record<string, unknown>> => {
    const rows: Record<string, unknown> = {}
    async function walk(path: string, relative: string) {
      const info = await stat(path)
      rows[relative] = { mode: info.mode, size: info.size, mtimeMs: info.mtimeMs }
      if (info.isDirectory())
        for (const name of (await readdir(path)).sort())
          await walk(join(path, name), relative + '/' + name)
      else
        rows[relative] = {
          ...(rows[relative] as object),
          bytes: (await readFile(path)).toString('hex'),
        }
    }
    await walk(join(legacy, 'profile-apply'), '')
    rows.account = (await readFile(data)).toString('hex')
    return rows
  }
  return {
    root,
    legacy,
    home,
    installId,
    directory,
    floor,
    data,
    marker,
    input,
    import: () => subject.importLegacyConfiguration(home, input),
    consumed: async () => {
      const value = JSON.parse(await readFile(marker, 'utf8'))
      return value.revision ?? (value.consumedRevision as number)
    },
    inventory,
  }
}

export async function connectWhatsappSubject() {
  const f = await whatsappSubject()
  const { createToolServer } = await vi.importActual<{
    createToolServer(options: unknown): {
      connect(transport: unknown): Promise<void>
      close(): Promise<void>
    }
  }>('../../../plugins/whatsapp/src/shared/toolServer')
  const server = createToolServer({ name: 'whatsapp', version: 'fictional', tools: f.tools })
  const client = new Client({ name: 'fictional-current-host', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await server.connect(right)
  await client.connect(left)
  connections.push(
    () => server.close(),
    () => client.close(),
  )
  return { ...f, client }
}

// Input construction only: historical committed files are immutable. Replace their directory
// entry before a scenario starts, never relax permissions or mutate them during current import.
export async function replaceHistoricalInput(path: string, bytes: string) {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
  await writeFile(path, bytes, { mode: 0o400 })
}
