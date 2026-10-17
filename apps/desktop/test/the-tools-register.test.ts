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
import {
  EXTERNAL_MCP_EVERYONE,
  EXTERNAL_MCP_NONE_YET,
  EXTERNAL_MCP_RESTRICTED,
} from '../src/shared/external-mcp'
import type { ExternalMcpServerReach, ExternalMcpServerRow } from '../src/shared/external-mcp'
import type { AgentIdentities, AgentIdentity } from '../src/shared/runtime-ipc'
import type { ProviderCapabilityMap } from '../src/shared/runtime-ipc'
import { proseSpans } from './lib/prose-spans'
import { visibleCopy } from './lib/visible-copy'

/**
 * 🔴 **566 · the Tools register, everywhere it is decided but not drawn** (`564`'s first slice,
 * `EXT-008` §4.1).
 *
 * ## ⛔ What is HERE and what is in the dom suite, because the split is the design
 *
 * ⚑ **`the-tools-register.dom.test.ts` owns everything a person can see** — the two planted worlds,
 * the empty install, the provider block and `566` §5.3's measured ink. ⛔ **This file owns the
 * derivation and the censuses**: a fold with no renderer in it (`468` — *"a derivation written
 * inside an SFC is reachable by no mutation row and by no test that is not a render"*) and the
 * source-level questions a rendered page cannot ask, such as *does any surface still say the thing
 * `HO-048` §1 withdrew*.
 *
 * ## ⚠️ Every source census below reads CODE, never prose
 *
 * ⛔ **This file's own docblocks quote the sentences it forbids.** `526`'s rule, learned twice:
 * *"a raw-file census counts docblock words as code"* — and `562`'s census read `NAME_SHAPED` out of
 * the module it was censusing. ⚑ {@link code} blanks every comment through `prose-spans.ts`'s
 * parser rather than a regex, so a `/*` inside a string cannot become a comment
 * (`a-source-census-must-strip-prose-before-it-asserts`).
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '../src')
const COMPONENTS = join(SRC, 'renderer/src/components')

const read = (path: string): string => readFileSync(join(SRC, path), 'utf8')

/**
 * ⛔ **The file with every comment blanked, newlines kept** — see the header for why a regex will
 * not do. ⚑ Blanked rather than deleted so a later reader adding a line-numbered assertion is not
 * given a file whose lines have moved.
 */
function code(file: string, source: string): string {
  let out = source
  for (const span of proseSpans(file, source)) {
    out = out.replace(span.text, span.text.replace(/[^\n]/g, ' '))
  }
  return out
}

/* ─────────────────────────────────────────────────────────────── fixtures */

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
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  externalMcpServerIds: granted,
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
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

/* ─────────────────────────────────────────────────────────────────────────────
   §1 · 564's "adapter for safe fields"
   ───────────────────────────────────────────────────────────────────────────── */

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
    // ⛔ **The whole object is compared, both rows, so a SEVENTH field cannot be added here without
    // this line moving** — which is `564`'s own worry stated as a rail: the registry has five
    // columns, and a description, a transport, a tool standing and a conversation link are four
    // things v2.10 draws that this product would have to invent.
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
        // ⚠️ **The load-bearing fixture**: this identity holds a grant for the EVERYONE row, which
        // `0033`'s backfill really did leave behind. ⛔ A count taken over it would answer `1` for
        // a question that does not apply, and answer `0` on a clean install — two wrong numbers
        // from one reading.
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
    // ⚑ Paired with the surface that separates them: the dom suite asserts `tools-loading` and
    // `tools-none` are two different renderings of these two facts.
    expect(registeredServers(world([]))).toEqual([])
  })

  it('⚠️ a reach this build cannot read draws the NARROW words, never the default’s', () => {
    // ⛔ The store folds on the way out (`foldExternalMcpReach`), so this value cannot arrive from
    // it — and that is exactly why the arm is driven here: a fold that stopped folding would make
    // this reachable, and the page must then say the narrow thing rather than the wide one.
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

/* ─────────────────────────────────────────────────────────────────────────────
   §2 · 566 §4.2 — said once, and said by the provider
   ───────────────────────────────────────────────────────────────────────────── */

describe('566 §2 · what each provider does with a registered server', () => {
  it('🔴 every sentence is the capability table’s OWN bytes — this app composes none of them', () => {
    const declared = allProviderCapabilities() as unknown as ProviderCapabilityMap
    const standings = whatEachProviderDoesWithThem(declared)
    expect(standings.length).toBeGreaterThan(1)
    for (const standing of standings) {
      const status = declared[standing.provider].externalMcpServers
      // ⛔ **Byte equality with the table, per provider** — the whole of `566` §4.2's answer. `524`
      // refused to restate this fact in `shared/external-mcp.ts` because *"a second copy of
      // `HO-042` §3's sentence is a second authority on it"*; this asserts there is still one.
      expect(standing.says).toBe(status.state === 'available' ? status.note : status.reason)
      expect(standing.handsThemOver).toBe(status.state === 'available')
    }
  })

  // 🔴 **RE-AIMED at `605`, and the re-aim is the point of the row.** ⛔ This asserted that the
  // SHIPPED table disagrees about `handsThemOver` — true while Codex was `unwired`, and `605`
  // moved it, so the assertion would have gone GREEN-and-meaningless the moment it was deleted and
  // RED the moment it was not. ⚑ Rule 26: strip AND re-aim. The non-vacuity it was buying —
  // *this fold really does distinguish its two arms* — is bought from a PLANTED pair instead,
  // which is where it should always have come from: a fixture that cannot be changed by a
  // capability decision is the only one that keeps measuring across one.
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
    // ⛔ **And each arm carried ITS OWN sentence across**, which is what makes the booleans above a
    // measurement of the fold rather than of two literals.
    expect(standings.find((one) => one.handsThemOver)?.says).toBe('the wired arm’s own sentence')
    expect(standings.find((one) => !one.handsThemOver)?.says).toBe(
      'the held-back arm’s own sentence',
    )
  })

  it('⛔ the product’s declared table really does say DIFFERENT things per provider', () => {
    const declared = allProviderCapabilities() as unknown as ProviderCapabilityMap
    const standings = whatEachProviderDoesWithThem(declared)
    // ⚠️ **Non-vacuity against the SHIPPED table, on the axis that still differs.** ⛔ Both
    // providers hand these over since `605`, so *some hands them over and some does not* is no
    // longer a fact about the product — but `566` §4.2's actual worry was a page that *"said one
    // thing twice"*, and that is measured here: two providers, two sentences, and neither is the
    // other's.
    expect(standings.length).toBeGreaterThan(1)
    expect(new Set(standings.map((one) => one.says)).size).toBe(standings.length)
    // ⚑ And every sentence is words a person can read, not a state word.
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
    // ⛔ **`039`'s rule, checked where `provider-neutrality.test.ts` cannot.** That census refuses a
    // provider literal in CODE and its own docblock records the hole: *"it does not start flagging
    // DISPLAY TEXT that happens to mention a provider"*. ⚑ So a hand-written *Codex cannot reach
    // external tools* would have passed the gate — this is the assertion that refuses it.
    const page = read('renderer/src/components/ToolsRegister.vue')
    const fold = read('renderer/src/lib/the-servers-this-app-registered.ts')
    for (const [file, source] of [
      ['ToolsRegister.vue', page],
      ['the-servers-this-app-registered.ts', fold],
    ] as const) {
      const bare = code(file, source)
      expect(bare, `${file} names a provider outside a comment`).not.toMatch(/\b(claude|codex)\b/i)
    }
    // ⚠️ **Non-vacuity, both ways, because a stripper that returned `''` would pass the loop
    // above and measure nothing.** ⛔ The stripped text still holds the code it is about, and no
    // longer holds a token that exists ONLY in this file's prose — so `code()` is proven to strip
    // and proven not to strip everything, on the two files the loop reads.
    expect(code('ToolsRegister.vue', page)).toContain('whatEachProviderDoesWithThem')
    expect(page).toContain('EXT-008')
    expect(code('ToolsRegister.vue', page)).not.toContain('EXT-008')
    expect(code('the-servers-this-app-registered.ts', fold)).toContain('registeredServers')
    expect(fold).toContain('HO-048')
    expect(code('the-servers-this-app-registered.ts', fold)).not.toContain('HO-048')
  })
})

/* ─────────────────────────────────────────────────────────────────────────────
   §3 · one sentence for an empty register, and the false one is gone
   ───────────────────────────────────────────────────────────────────────────── */

describe('566 §3 · the sentence HO-048 §1 withdrew, and the three surfaces that said it', () => {
  /** Every string a person can read, from every renderer component and every shared module. */
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
    // ⚑ **Non-vacuity first, and it is not a formality**: this reader is an AST parser over three
    // trees, and a walk that found nothing would make the assertion below true of silence.
    expect(strings.length).toBeGreaterThan(400)
    expect(strings.some((one) => one.text.includes('unless you register it as restricted'))).toBe(
      true,
    )

    const false_ones = strings.filter((one) => /grants? nobody/i.test(one.text))
    // 🔴 **`524` corrected the rail and the test comment and missed the registration sheet.** The
    // sheet's own empty state read *"it grants nobody until you tick it on an agent's own sheet"*
    // under a pre-selected *available to every identity* radio eight lines below it.
    expect(false_ones.map((one) => `${one.file} :: ${one.text}`)).toEqual([])
  })

  it('⛔ the empty-register sentence is ONE constant, rendered and never retyped', () => {
    const said = EXTERNAL_MCP_NONE_YET
    expect(said).toContain('unless you register it as restricted')
    // ⚠️ **And it carries no pointer**, which is what makes it sayable on a page whose entrance is
    // above and in a sheet whose form is below — the clause that kept `516`'s two copies apart.
    expect(said).not.toMatch(/\babove\b|\bbelow\b/)

    for (const file of ['ExternalMcpRegistry.vue', 'ToolsRegister.vue']) {
      const source = read(`renderer/src/components/${file}`)
      expect(code(file, source), `${file} does not render the constant`).toContain(
        'EXTERNAL_MCP_NONE_YET',
      )
    }
    // ⛔ **The paired negative**: neither surface also keeps a typed copy of the words.
    const typed = everyVisibleString().filter((one) =>
      one.text.includes('No external MCP servers yet'),
    )
    expect(typed.map((one) => one.file)).toEqual(['shared/external-mcp.ts'])
  })
})

/* ─────────────────────────────────────────────────────────────────────────────
   §4 · the destination, declared in every place that decides one
   ───────────────────────────────────────────────────────────────────────────── */

function fakeStore(): { live: ComputedRef<SessionRecord[]>; get: (id: string) => null } {
  const rows = ref<SessionRecord[]>([])
  return { live: computed(() => rows.value), get: () => null }
}

describe('the Tools entry opens the Tools tab of Settings', () => {
  it('the older Tools place resolves to Settings rather than the launcher', async () => {
    const surface = useSurface(fakeStore())
    await nextTick()
    surface.place.value = 'tools'
    // ⛔ **This is the assertion that fails on `main`.** `RESERVED_PLACES` did not hold the word, so
    // `projectId` answered `'tools'` and the precedence chain reached `'project'` — the exact trap
    // `useSurface.ts:77` writes down: *"anything not on this list is treated as a project id, so a
    // new destination that forgot to say so would open the project workspace."*
    // ⚠️ **D-016 took `projectId` and the project fallback** — a word no place answers to draws the
    // launcher now — so what stays is the surface this word names.
    expect(surface.surface.value).toBe('settings')
  })

  it('⚑ …and a place genuinely called something else is not the Tools surface', async () => {
    const surface = useSurface(fakeStore())
    await nextTick()
    surface.place.value = 'toolbox'
    // ⚠️ **The paired positive**: reserving a word narrows routing, and a narrowing is safe only
    // where everything it newly refuses was already wrong (standing rule 24). `toolbox` is the
    // control that proves it refused exactly one word. ⚑ **D-016** — it routed as a project until
    // projects went; a word no place answers to draws the launcher now.
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

  it('🔴 every file that decides a destination names this one — the 537-shaped wiring census', () => {
    const sites: { file: string; holds: string; why: string }[] = [
      {
        file: 'renderer/src/composables/useSurface.ts',
        holds: "tools: 'settings'",
        why: 'the old Tools destination resolves to Settings',
      },
      {
        file: 'renderer/src/components/RuntimeScreen.vue',
        holds: "destination === 'tools'",
        why: 'the palette opens Settings at its Tools tab',
      },
      {
        file: 'renderer/src/components/SideRail.vue',
        holds: 'data-cy="rail-settings"',
        why: 'the shared Settings destination a person presses',
      },
      {
        file: 'renderer/src/lib/command-palette.ts',
        holds: "place: 'tools'",
        why: 'the palette row, and the widened action arm beside it',
      },
    ]
    const missing = sites.filter(({ file, holds }) => {
      const name = file.slice(file.lastIndexOf('/') + 1)
      return !code(name, read(file)).includes(holds)
    })
    expect(missing.map((one) => `${one.file} — ${one.why}`)).toEqual([])

    // ⛔ **The census is proven by violating it** (standing rule 20's closure): a string no file
    // holds must be reported, or a green run above says nothing about the reader.
    const invented = sites.filter(({ file }) =>
      code(file.slice(file.lastIndexOf('/') + 1), read(file)).includes(
        "place: 'tools-that-is-not'",
      ),
    )
    expect(invented).toEqual([])
    expect(code('SideRail.vue', read('renderer/src/components/SideRail.vue'))).not.toContain(
      'data-cy="rail-toolbox"',
    )
  })
})

/* ─────────────────────────────────────────────────────────────────────────────
   §5 · what left the rail, and what still points at it
   ───────────────────────────────────────────────────────────────────────────── */

describe('566 §5 · the rail is destinations only, for this subject', () => {
  it('⛔ the list, the count, the + and the sentence are all out of the navigation column', () => {
    const rail = code('SideRail.vue', read('renderer/src/components/SideRail.vue'))
    // ⚑ Non-vacuity: the rail still draws this subject, as a destination.
    expect(rail).toContain('data-cy="rail-settings"')
    expect(rail).not.toContain('data-cy="rail-tools"')
    // ⛔ `EXT-008` §1's four, each by name — *the section is gone* is a claim four separate
    // elements could falsify on their own.
    for (const gone of [
      'data-cy="rail-external-tools"',
      'data-cy="external-tools-count"',
      'data-cy="rail-new-external-mcp"',
      'data-cy="rail-external-tools-empty"',
      'openExternalMcp',
    ]) {
      expect(rail, `${gone} is still in the rail`).not.toContain(gone)
    }
  })

  it('🔴 the only door to the registry is still open, and it is on the page now', () => {
    const screen = code('RuntimeScreen.vue', read('renderer/src/components/RuntimeScreen.vue'))
    // ⚠️ **`RuntimeScreen` is the only site in the repo that opens this overlay kind**, so a move
    // that dropped the listener without adding one would remove the product's only registration
    // door and no test would have said so.
    expect(screen).toContain("overlays.open({ kind: 'externalMcpServers' })")
    expect(screen).toContain('@add-server=')
    expect(screen).not.toContain('@open-external-mcp=')
  })
})
