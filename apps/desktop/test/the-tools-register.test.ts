import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computed, nextTick, ref, type ComputedRef } from 'vue'
import { describe, expect, it } from 'vitest'
import { allProviderCapabilities } from '@brobot2/runtime'
import type { SessionRecord } from '../src/renderer/src/lib/session-record'
import { RESERVED_PLACES, useSurface } from '../src/renderer/src/composables/useSurface'
import { buildCommands } from '../src/renderer/src/lib/command-palette'
import {
  A_PROVIDER_THAT_SAID_ONLY_YES,
  grantedWords,
  registeredServers,
  registeredWords,
  whatEachProviderDoesWithThem,
} from '../src/renderer/src/lib/the-servers-this-app-registered'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { EXTERNAL_MCP_EVERYONE, EXTERNAL_MCP_RESTRICTED } from '../src/shared/external-mcp'
import type { ExternalMcpServerReach, ExternalMcpServerRow } from '../src/shared/external-mcp'
import type { AgentIdentities, AgentIdentity } from '../src/shared/runtime-ipc'
import type { ProviderCapabilityMap } from '../src/shared/runtime-ipc'
import { proseSpans } from './lib/prose-spans'
import { visibleCopy } from './lib/visible-copy'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '../src')
const COMPONENTS = join(SRC, 'renderer/src/components')

const read = (path: string): string => readFileSync(join(SRC, path), 'utf8')

function code(file: string, source: string): string {
  let out = source
  for (const span of proseSpans(file, source)) {
    out = out.replace(span.text, span.text.replace(/[^\n]/g, ' '))
  }
  return out
}

const server = (
  name: string,
  url: string,
  reach: ExternalMcpServerReach,
  registeredAt = 1_700_000_000_000,
): ExternalMcpServerRow => ({ id: `ems:${name}`, name, url, registeredAt, reach })

const identity = (slug: string, granted: readonly string[] = []): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName: null,
  createdAt: 1_700_000_000_000,
  createdBy: null,
  provider: null,
  externalMcpServerIds: granted,
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {
    maxDepth: 'default',

    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

const world = (
  servers: readonly ExternalMcpServerRow[],
  identities: readonly AgentIdentity[] = [],
): AgentIdentities => ({
  identities,
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: servers,
})

describe('566 §1 · the adapter 564 said the registry was missing', () => {
  it('🔴 two servers of different reach come back with what each one IS, and nothing invented', () => {
    const rows = registeredServers(
      world(
        [
          server('kibana', 'http://127.0.0.1:4000/demo-logs/mcp', 'everyone'),
          server('browser', 'http://localhost:3070/mcp', 'restricted'),
        ],
        [identity('pm', ['ems:browser']), identity('scout')],
      ),
    )
    expect(rows.map((row) => row.name)).toEqual(['kibana', 'browser'])
    expect(rows[0]).toEqual({
      id: 'ems:kibana',
      name: 'kibana',
      url: 'http://127.0.0.1:4000/demo-logs/mcp',
      reach: 'everyone',
      reachSays: EXTERNAL_MCP_EVERYONE,
      registeredAt: 1_700_000_000_000,
      grantedTo: null,
    })
    expect(rows[1]).toEqual({
      id: 'ems:browser',
      name: 'browser',
      url: 'http://localhost:3070/mcp',
      reach: 'restricted',
      reachSays: EXTERNAL_MCP_RESTRICTED,
      registeredAt: 1_700_000_000_000,
      grantedTo: 1,
    })
  })

  it('⛔ an everyone row is not asked how many were granted it, and that is not zero', () => {
    const [everyones, restricted] = registeredServers(
      world(
        [
          server('kibana', 'http://127.0.0.1:1/mcp', 'everyone'),
          server('browser', 'http://127.0.0.1:2/mcp', 'restricted'),
        ],
        [identity('pm', ['ems:kibana'])],
      ),
    )
    expect(everyones?.grantedTo).toBeNull()
    expect(restricted?.grantedTo).toBe(0)
  })

  it('⚑ the words for a count spell the singular, and zero says what zero means', () => {
    expect(grantedWords(0)).toBe('Granted to nobody yet')
    expect(grantedWords(1)).toBe('Granted to 1 identity')
    expect(grantedWords(2)).toBe('Granted to 2 identities')
  })

  it('⚠️ the order is the store’s and is not re-sorted here', () => {
    const rows = registeredServers(
      world([
        server('zulu', 'http://127.0.0.1:1/mcp', 'everyone', 2),
        server('alpha', 'http://127.0.0.1:2/mcp', 'everyone', 1),
      ]),
    )
    expect(rows.map((row) => row.name)).toEqual(['zulu', 'alpha'])
  })

  it('⛔ nobody has looked is an EMPTY roster here, and the surface draws the difference', () => {
    expect(registeredServers(null)).toEqual([])
    expect(registeredServers(world([]))).toEqual([])
  })

  it('⚠️ a reach this build cannot read draws the NARROW words, never the default’s', () => {
    const rows = registeredServers(
      world([server('odd', 'http://127.0.0.1:1/mcp', 'sideways' as ExternalMcpServerReach)]),
    )
    expect(rows[0]?.reachSays).toBe(EXTERNAL_MCP_RESTRICTED)
  })

  it('⚑ registered words are the house idiom, and they take the instant as an argument', () => {
    expect(registeredWords(1_000, 1_000 + 3 * 86_400_000)).toBe('Registered 3d ago')
    expect(registeredWords(1_000, 1_000)).toBe('Registered 0s ago')
  })
})

describe('566 §2 · what each provider does with a registered server', () => {
  it('🔴 every sentence is the capability table’s OWN bytes — this app composes none of them', () => {
    const declared = allProviderCapabilities() as unknown as ProviderCapabilityMap
    const standings = whatEachProviderDoesWithThem(declared)
    expect(standings.length).toBeGreaterThan(1)
    for (const standing of standings) {
      const status = declared[standing.provider].externalMcpServers
      expect(standing.says).toBe(status.state === 'available' ? status.note : status.reason)
      expect(standing.handsThemOver).toBe(status.state === 'available')
    }
  })

  it('⛔ the fold distinguishes its two arms — planted, so no capability decision can flatten it', () => {
    const planted = {
      claude: { externalMcpServers: { state: 'available', note: 'the wired arm’s own sentence' } },
      codex: {
        externalMcpServers: { state: 'unwired', reason: 'the held-back arm’s own sentence' },
      },
    } as unknown as ProviderCapabilityMap
    const standings = whatEachProviderDoesWithThem(planted)
    expect(standings.some((one) => one.handsThemOver)).toBe(true)
    expect(standings.some((one) => !one.handsThemOver)).toBe(true)
    expect(standings.find((one) => one.handsThemOver)?.says).toBe('the wired arm’s own sentence')
    expect(standings.find((one) => !one.handsThemOver)?.says).toBe(
      'the held-back arm’s own sentence',
    )
  })

  it('⛔ the product’s declared table really does say DIFFERENT things per provider', () => {
    const declared = allProviderCapabilities() as unknown as ProviderCapabilityMap
    const standings = whatEachProviderDoesWithThem(declared)
    expect(standings.length).toBeGreaterThan(1)
    expect(new Set(standings.map((one) => one.says)).size).toBe(standings.length)
    for (const one of standings) expect(one.says.length).toBeGreaterThan(20)
  })

  it('⚠️ nobody has asked the capability door is NOT “no provider hands them over”', () => {
    expect(whatEachProviderDoesWithThem(null)).toEqual([])
  })

  it('⛔ a provider the table did not answer for is OMITTED rather than guessed at', () => {
    const partial = { claude: {} } as unknown as ProviderCapabilityMap
    expect(whatEachProviderDoesWithThem(partial)).toEqual([])
  })

  it('⚑ an available entry that declared no note still says something', () => {
    const terse = {
      claude: { externalMcpServers: { state: 'available' } },
    } as unknown as ProviderCapabilityMap
    const [only] = whatEachProviderDoesWithThem(terse)
    expect(only?.says).toBe(A_PROVIDER_THAT_SAID_ONLY_YES)
    expect(only?.handsThemOver).toBe(true)
  })

  it('🔴 the page names no provider, so the sentence cannot go false when one is wired', () => {
    const page = read('renderer/src/components/ToolsRegister.vue')
    const fold = read('renderer/src/lib/the-servers-this-app-registered.ts')
    for (const [file, source] of [
      ['ToolsRegister.vue', page],
      ['the-servers-this-app-registered.ts', fold],
    ] as const) {
      const bare = code(file, source)
      expect(bare, `${file} names a provider outside a comment`).not.toMatch(/\b(claude|codex)\b/i)
    }
    for (const [file, source, anchor] of [
      ['ToolsRegister.vue', page, 'whatEachProviderDoesWithThem'],
      ['the-servers-this-app-registered.ts', fold, 'registeredServers'],
    ] as const) {
      const decorated = file.endsWith('.vue')
        ? source.replace('<template>', '<template>\n<!-- claude codex comment-only-provider -->')
        : '/* claude codex comment-only-provider */\n' + source
      expect(decorated).not.toBe(source)
      expect(decorated).toContain('comment-only-provider')
      expect(code(file, decorated)).not.toContain('comment-only-provider')
      expect(code(file, decorated)).not.toMatch(/\b(claude|codex)\b/i)
      expect(code(file, decorated)).toContain(anchor)
      const badCode = file.endsWith('.vue')
        ? source.replace('</script>', "const badProvider = 'codex'\n</script>")
        : "const badProvider = 'codex'\n" + source
      expect(badCode).not.toBe(source)
      expect(code(file, badCode)).toMatch(/\b(claude|codex)\b/i)
    }
  })
})

describe('566 §3 · the sentence HO-048 §1 withdrew, and the three surfaces that said it', () => {
  function everyVisibleString(): { file: string; text: string }[] {
    const found: { file: string; text: string }[] = []
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const child = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(child, `${prefix}${entry.name}/`)
          continue
        }
        if (!/\.(ts|vue)$/.test(entry.name)) continue
        for (const said of visibleCopy(entry.name, readFileSync(child, 'utf8'))) {
          found.push({ file: `${prefix}${entry.name}`, text: said.text })
        }
      }
    }
    walk(COMPONENTS, 'components/')
    walk(join(SRC, 'renderer/src/lib'), 'lib/')
    walk(join(SRC, 'shared'), 'shared/')
    return found
  }

  it('🔴 no surface tells a person a registration grants nobody — it grants everyone by default', () => {
    const strings = everyVisibleString()
    expect(strings.length).toBeGreaterThan(400)
    expect(strings.some((one) => one.text.includes('unless you register it as restricted'))).toBe(
      true,
    )

    const false_ones = strings.filter((one) => /grants? nobody/i.test(one.text))
    expect(false_ones.map((one) => `${one.file} :: ${one.text}`)).toEqual([])
  })
})

function fakeStore(): { live: ComputedRef<SessionRecord[]>; get: (id: string) => null } {
  const rows = ref<SessionRecord[]>([])
  return { live: computed(() => rows.value), get: () => null }
}

describe('the Tools entry opens the Tools tab of Settings', () => {
  it('the older Tools place resolves to Settings rather than the launcher', async () => {
    const surface = useSurface(fakeStore())
    await nextTick()
    surface.place.value = 'tools'
    expect(surface.surface.value).toBe('settings')
  })

  it('⚑ …and a place genuinely called something else is not the Tools surface', async () => {
    const surface = useSurface(fakeStore())
    await nextTick()
    surface.place.value = 'toolbox'
    expect(surface.surface.value).toBe('launcher')
  })

  it('⛔ the word is reserved, which is the half the precedence chain cannot do alone', () => {
    expect([...RESERVED_PLACES]).toContain('settings')
  })

  it('⚑ the palette offers it, with the sentence the rail row deliberately does not carry', () => {
    const rows = buildCommands({
      conversations: [],
      activeId: null,
      agent: null,
    })
    const tools = rows.find((row) => row.id === 'go-tools')
    expect(tools?.action).toEqual({ kind: 'go', place: 'tools' })
    expect(tools?.title).toBe('Tools')
    expect(tools?.detail).toContain('registered on this machine')
  })
})
