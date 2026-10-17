import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CODEX_MEMORY_SETTINGS,
  mergeCodexMemoryConfig,
  SUPPORTED_PROVIDERS,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import {
  CLAUDE_SDK_OPTIONS,
  CODEX_THREAD_START_CLAIMS,
  readProviderConfig,
  type SdkOptionClaim,
} from '../src/main/runtime/provider-config'

/**
 * ⛔ **The config block is user-facing prose about the code, and prose does not compile** (308).
 *
 * ## What was wrong
 *
 * The Claude line said *"MCP servers, tools and prompt are passed as SDK query() options"*. Tools
 * and the prompt are. **MCP servers are not** — `optionsFor` in `claude-runtime.ts` has no
 * `mcpServers` member, and `307` proved it the expensive way: to measure whether the option would
 * work it had to inject one at the `QueryFactory` seam, because the adapter's options object has
 * nowhere to put it. ⚠️ `strictMcpConfig: true` then excludes file and project config as well, so a
 * Claude session here gets MCP servers from **nowhere** — and the one sentence a user reads to find
 * out where to add one told them the app already handled it. That is HO-002 §5 acceptance #7
 * (*nothing unwired implies a working state*) failing inside a criterion reported closed.
 *
 * ## ⚑ Why this file is not a pair of string literals
 *
 * `306`'s shape: state the rule once and DERIVE it, so the next drift is covered without anybody
 * remembering. Here that means both sides are read at run time — the disclosure from
 * `provider-config.ts`, the truth from the adapter's own source — and the claim is a **typed table**
 * (`CLAUDE_SDK_OPTIONS`) rather than a sentence, with the sentence rendered from it.
 *
 * 🔴 **Checked in BOTH directions**, which is the half that survives Slice 3: an `absent` row whose
 * option the adapter has begun to pass fails just as loudly as a `passed` row it never sets. When
 * the tools slice wires MCP up, this test goes red, the author flips one row, and the sentence
 * rewrites itself. **Nobody edits a fixture to match the code.**
 *
 * ## ⚠️ What this check CANNOT see, said out loud
 *
 *  - **Conditionally-spread options are invisible.** The scan takes top-level keys of the
 *    `const options: Options = {…}` literal plus `options.x =` assignments. `effort` arrives as
 *    `...(effort ? { effort } : {})` and is therefore NOT in the derived set — a claim about it
 *    would fail wrongly. No claim makes one today; adding one means teaching the scan first.
 *  - **It is textual.** It proves `optionsFor` sets a member of that name. It cannot prove the SDK
 *    reads it, or that the value is any good. `301`'s `fixture:check` is the shape for that, and it
 *    is a different instrument.
 *  - **{@link namesMcp} is prose-shaped.** It catches the WORD in any casing or punctuation, which
 *    is what a reworded sentence keeps. A sentence that said "tool servers" instead would escape it,
 *    and nothing here can fix that — the controls below say exactly how wide it is.
 *  - ⛔ **This bullet used to say *"nothing here checks the Codex `config.toml` prose against
 *    behaviour — this app never writes or reads that file; the binary does"*. It went false at
 *    314**, which is when the app became a WRITER of that file: `ensureCodexMemoryConfig` merges
 *    four memory keys into it on provisioning and on every launch. So the Codex half now has a
 *    binding of its own, below — and it is a stronger one than the Claude half, because the keys
 *    are read out of a real merge rather than scanned out of source.
 *  - ⚠️ **What is still nobody's to check here is the MCP half of that sentence.** This app does
 *    not write MCP servers into `config.toml`; Codex reads them from it. That clause is verified
 *    against the Codex CLI's own documented shape, by a person, and that is all it is.
 *  - ⛔ **The ENGLISH around a label is not checked, and cannot be.** The table is held to the
 *    adapter and the sentence is held to name every member of the table — so a row cannot go
 *    unmentioned and a mention cannot be invented. What survives is a sentence that names
 *    `mcpServers` and describes its stance wrongly. `308 M12` is that mutation, recorded as an
 *    expected survivor rather than left for somebody to discover.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '../../..')
const read = (relative: string): string => readFileSync(join(REPO, relative), 'utf8')

/** Which source is the authority for each provider's launch. Exhaustive over `Provider`. */
const ADAPTER: Record<Provider, string> = {
  claude: 'packages/runtime/src/claude/claude-runtime.ts',
  codex: 'packages/runtime/src/codex/codex-runtime.ts',
}

/**
 * Every `Options` member `optionsFor` sets, read out of the adapter's source.
 *
 * ⚠️ **Scoped to `optionsFor` and then to its object literal**, not to the file: `claude-runtime.ts`
 * builds `Options` elsewhere too — `listOptionsFor` for the model probe, and `resumeOptions`, which
 * spreads this one — and a key found in the probe would answer a question nobody asked. The
 * literal's top-level keys sit at exactly six spaces and its comments all begin `//`, so an
 * indentation-anchored scan reads keys and not prose — which the roster assertion below re-proves
 * rather than assumes, and which `308 M10` is the row for.
 */
function optionsPassedBy(source: string): Set<string> {
  const start = source.indexOf('  private optionsFor(')
  if (start < 0) throw new Error('optionsFor is gone from the Claude adapter')
  const body = source.slice(start, source.indexOf('\n  }\n', start))
  // ⚑ W4.189 · typed as `Options` with its `settings` the object form, so `start` merges onto it.
  const literalStart = body.search(
    /const options: (?:Options|Omit<Options, 'settings'> & \{ settings: Settings \}) = \{/,
  )
  if (literalStart < 0) throw new Error('optionsFor no longer builds an Options literal')
  const literal = body.slice(literalStart, body.indexOf('\n    }\n', literalStart))
  return new Set([
    ...[...literal.matchAll(/^ {6}([A-Za-z_$][\w$]*)\s*[:,]/gm)].map((m) => m[1]!),
    ...[...body.matchAll(/\boptions\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1]!),
  ])
}

const PASSED = optionsPassedBy(read(ADAPTER.claude))

/**
 * Where the disclosure and the adapter disagree — pure, so the controls below can feed it a Slice 3
 * table and a Slice 3 adapter without either existing yet.
 */
function disagreements(
  claims: readonly SdkOptionClaim[],
  passed: ReadonlySet<string>,
): readonly string[] {
  return claims
    .filter((claim) => (claim.stance === 'absent') === passed.has(claim.option))
    .map((claim) =>
      claim.stance === 'absent'
        ? `${claim.option}: the block says it is NOT passed, and optionsFor sets it`
        : `${claim.option}: the block says it is ${claim.stance}, and optionsFor never sets it`,
    )
}

/**
 * Does this sentence talk about MCP at all?
 *
 * ⚠️ **Word-bounded and case-insensitive, and both halves are load-bearing.** Case-insensitive
 * because a rewording will not keep the capitalisation; word-bounded because `strictMcpConfig` is a
 * pin this adapter really does set and must NOT read as a claim about servers. `308`'s brief carried
 * that exact mistake in the other direction — *"`mcp` appears zero times in `claude-runtime.ts`"* was
 * literally true and substantively false, because `Mcp`/`MCP` appears eight times.
 */
const namesMcp = (text: string): boolean => /\bmcp\b/i.test(text)

/** Every camelCase word in a piece of prose — the shape an SDK option name has. */
const camelWords = (text: string): string[] =>
  text.match(/\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g) ?? []

/**
 * camelCase words the Claude block uses that are NOT SDK options.
 *
 * ⚠️ **An escape hatch that fails in the safe direction**: a new one makes the test RED (somebody
 * adds a word, the test asks them to declare it), never green. The control below refuses any entry
 * the options literal has heard of, so it cannot be used to hide a real option.
 */
const NOT_AN_OPTION = ['macOS']

const claudeBlock = readProviderConfig('claude', '/nowhere')
const CLAUDE_PROSE = [
  claudeBlock.model,
  claudeBlock.authNote ?? '',
  ...claudeBlock.files.map((file) => file.note),
]

describe('the provider disclosure answers to the adapter (308)', () => {
  it('⛔ every option the Claude block names as passed is set, and every one it calls absent is not', () => {
    expect(
      disagreements(CLAUDE_SDK_OPTIONS, PASSED),
      'the config block is telling the user something about this session that the adapter does ' +
        'not do. Correct the row in `provider-config.ts` — the sentence is rendered from it.',
    ).toEqual([])
    // …and the sentence really is the table's, rather than a second copy that drifted from it
    // (169 §1). Without this, replacing the render with a hand-written string — the exact shape the
    // defect had — leaves every assertion here passing about a table nobody reads.
    for (const claim of CLAUDE_SDK_OPTIONS) {
      expect(claudeBlock.model, `the sentence stopped naming ${claim.option}`).toContain(
        claim.label,
      )
    }
  })

  it('⚑ and the roster is real — the scan read an options block, not an empty file (193)', () => {
    // ⛔ **Both sides of the comparison, because either can go empty.** An emptied
    // `CLAUDE_SDK_OPTIONS` passes the rule above over nothing — the MCP rule below happens to catch
    // that today, and relying on another test's side effect is how a guard quietly stops guarding.
    // `mcpServers` specifically: Slice 3 flips its STANCE, never its existence.
    expect(CLAUDE_SDK_OPTIONS.length).toBeGreaterThan(0)
    expect(CLAUDE_SDK_OPTIONS.map((claim) => claim.option)).toContain('mcpServers')
    // Without this, an `optionsPassedBy` that derived to `{}` would pass the rule above over
    // nothing, and would ALSO pass the `absent` half of it for every option in the SDK.
    expect([...PASSED].sort()).toEqual(
      expect.arrayContaining([
        'canUseTool',
        'cwd',
        'env',
        'hooks',
        'model',
        'permissionMode',
        'settingSources',
        'settings',
        'strictMcpConfig',
        'systemPrompt',
        'tools',
      ]),
    )
    // ⛔ **And it can say NO**, which is the half the `absent` rows rest on. `forwardSubagentText`
    // is the honest control: the adapter names it in a comment, at length, explaining that it is
    // deliberately not set — so a scan that matched prose instead of keys would find it here.
    expect(
      read(ADAPTER.claude),
      'the control moved: this asserts the scan can say NO about a word that IS in the adapter, ' +
        'and the word it uses has been deleted. Pick another one the adapter names but never sets.',
    ).toContain('forwardSubagentText')
    expect(PASSED.has('forwardSubagentText')).toBe(false)
    // The conditional spread, stated as a measurement rather than a belief (see the header).
    expect(PASSED.has('effort')).toBe(false)
  })

  it('🔴 no camelCase word in the Claude block names something the adapter does not pass', () => {
    const undeclared = CLAUDE_PROSE.flatMap(camelWords)
      .filter((word) => !PASSED.has(word) && !NOT_AN_OPTION.includes(word))
      .sort()
    expect(
      [...new Set(undeclared)],
      'the block spells an SDK option the adapter never sets. If it is not an option at all, add ' +
        'it to NOT_AN_OPTION with a reason.',
    ).toEqual([])
    // ⛔ **The escape hatch, held shut from both sides.** Writing `mcpServers` into `NOT_AN_OPTION`
    // would make the rule above pass over the exact word it exists to catch, and neither the rule
    // nor the roster would notice. So: it may not name anything the options literal has heard of,
    // and it may not name anything the disclosure itself claims.
    const source = read(ADAPTER.claude)
    const body = source.slice(source.indexOf('  private optionsFor('))
    const claimed = CLAUDE_SDK_OPTIONS.map((claim) => claim.option)
    for (const word of NOT_AN_OPTION) {
      expect(body.slice(0, body.indexOf('\n  }\n')).includes(word), `${word} is not prose`).toBe(
        false,
      )
      expect(claimed, `${word} is an option this very block makes a claim about`).not.toContain(
        word,
      )
    }
    // Non-vacuity (193), and deliberately WITHOUT naming today's two pins: the extractor is proved
    // on a synthetic line, and the real block is only asked to have something to extract. Naming
    // `settingSources` here would be a fixture Slice 3 has to edit to change a pin.
    expect(camelWords('the adapter pins settingSources: [] and strictMcpConfig: true')).toEqual([
      'settingSources',
      'strictMcpConfig',
    ])
    expect(CLAUDE_PROSE.flatMap(camelWords).length).toBeGreaterThan(0)
  })

  it('⛔ MCP is named in exactly one Claude string, and it is the one the table renders', () => {
    // 169 §1: one rule in two places drifts. The MCP fact is stated where it is checked, and a
    // second copy in a file note — the shape the old defect had — fails here.
    expect(
      CLAUDE_PROSE.filter(namesMcp),
      'a Claude disclosure string names MCP outside the sentence rendered from CLAUDE_SDK_OPTIONS, ' +
        'so nothing checks it against the adapter.',
    ).toEqual([claudeBlock.model])
  })

  it('⚠️ each provider block names the env var its own adapter pins to the provider home', () => {
    const pins = (homeEnv: string, source: string): boolean =>
      new RegExp(String.raw`\b${homeEnv}\s*:\s*[\w.]*[pP]roviderHome\b`).test(source)
    for (const provider of SUPPORTED_PROVIDERS) {
      const block = readProviderConfig(provider, '/nowhere')
      expect(
        pins(block.homeEnv, read(ADAPTER[provider])),
        `${provider}: the block tells the user to set ${block.homeEnv}, and the adapter does not ` +
          'point that variable at the provider home',
      ).toBe(true)
      // …and the matcher is capable of saying no, on the same source (193).
      expect(pins(`${block.homeEnv}_NOT_A_REAL_VAR`, read(ADAPTER[provider]))).toBe(false)
    }
  })

  it('⚠️ the Codex block names the files the code names', () => {
    // Weaker than the Claude rule and deliberately so: these are filenames the Codex binary owns,
    // and the only thing this repo can answer for is that it spells them the same way.
    // ⚑ 736 · R95 — and the two files a choice that outlives one conversation is kept in.
    const owners =
      read('packages/runtime/src/internal/auth.ts') +
      read('packages/runtime/src/codex/stale-permission-config.ts') +
      read('packages/runtime/src/codex/kept-tool-approvals.ts') +
      read('packages/runtime/src/codex/codex-runtime.ts')
    const files = readProviderConfig('codex', '/nowhere').files
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) expect(owners).toContain(`= '${file.name}'`)
  })
})

/**
 * 🔴 **The check held to what it says it does** (§3 of the dispatch).
 *
 * ⚠️ Being right about today's tree covers the rule going red when the disclosure lies. It does not
 * cover the rule quietly asking for less — and every assertion above would still pass if
 * {@link namesMcp} only ever matched the one literal the original defect happened to use.
 */
describe('…and the check is as wide as it claims (308 §3)', () => {
  /**
   * The extractor's contract, on a source small enough to read — a nested key before the literal, a
   * nested key inside it, and a nested key in the `systemPrompt` object AFTER it. All three sit at
   * the same six-space indentation as a real top-level key, so a scan that lost its scoping picks
   * them up and this assertion is the thing that says so.
   */
  const SYNTHETIC = [
    '  private optionsFor(handle: H): Options {',
    '    const earlier: Other = {',
    '      notAnOption: 1,',
    '    }',
    '    const options: Options = {',
    '      cwd,',
    '      tools: [...VOCABULARY],',
    '      hooks: {',
    '        Stop: nested,',
    '      },',
    '    }',
    '    options.systemPrompt = {',
    "      type: 'preset',",
    "      preset: 'claude_code',",
    '    }',
    '    return options',
    '  }',
    '',
  ].join('\n')

  it('⛔ the scan takes top-level Options keys and nothing else', () => {
    expect([...optionsPassedBy(SYNTHETIC)].sort()).toEqual([
      'cwd',
      'hooks',
      'systemPrompt',
      'tools',
    ])
  })

  it('⛔ catches a rewording, not the literal the defect happened to use', () => {
    expect(namesMcp('MCP servers, tools and prompt are passed as SDK query() options')).toBe(true)
    expect(namesMcp('mcp servers are forwarded to the child')).toBe(true)
    expect(namesMcp('MCP-server config is handed over at launch')).toBe(true)
    expect(namesMcp('add an Mcp server here')).toBe(true)
  })

  it('⚠️ and does NOT fire on the pin, which is where the casing trap lives', () => {
    expect(namesMcp('the adapter pins settingSources: [] and strictMcpConfig: true')).toBe(false)
    expect(namesMcp('file settings here are ignored by design')).toBe(false)
  })

  it('⚑ the Slice 3 flip HAPPENED, and the census is what agrees it did (347)', () => {
    // ⚑ **308 wrote this pair as a rehearsal of a flip that had not happened yet, and 347 is the
    // dispatch that performed it.** The two directions below are the same two 308 rehearsed, with
    // the adapter now on the other side of them — so what used to be *"a Slice 3 disclosure goes
    // green the moment the adapter passes the option"* is now the plain reading of today's source.
    expect(CLAUDE_SDK_OPTIONS.find((claim) => claim.option === 'mcpServers')?.stance).toBe('passed')
    expect(PASSED.has('mcpServers')).toBe(true)
    // 🔴 **516 · the option carries TWO things now, and the sentence a person reads says both.**
    // ⛔ This surface exists to answer *where does this session's config come from*, so a label
    // naming only the in-process server would answer it with half the truth the moment a person
    // registers an external one and grants it — standing rule 8 on the one screen whose whole job
    // is disclosure. ⚠️ The stance did NOT move: it was `passed` before and it is `passed` now.
    expect(CLAUDE_SDK_OPTIONS.find((claim) => claim.option === 'mcpServers')?.label).toContain(
      'external servers granted to it',
    )
    // ⛔ **A positive assertion must differ from the default**: `disagreements` returning `[]` is
    // also what it returns for an empty table, so the two lines above pin that the row and the
    // source member both really exist before this one calls them agreed.
    expect(disagreements(CLAUDE_SDK_OPTIONS, PASSED)).toEqual([])
  })

  it('🔴 and the disclosure goes red if the adapter STOPS passing them behind its back', () => {
    // ⛔ **The direction that matters now is the mirror of the one 308 guarded.** Before 347 the
    // hazard was code moving ahead of prose; after it, the hazard is code moving BACK — an adapter
    // that quietly drops `mcpServers` (a refactor, a merge, a resume path that forgets it) while the
    // config block goes on promising a person that their agent's tools are handed over at launch.
    // ⚠️ That failure is silent in the product: a child with no tools and a model that simply never
    // calls them look identical from outside.
    expect(
      disagreements(
        CLAUDE_SDK_OPTIONS,
        new Set([...PASSED].filter((option) => option !== 'mcpServers')),
      ),
    ).toEqual(['mcpServers: the block says it is passed, and optionsFor never sets it'])
  })

  it('⚠️ and a table that flipped the row back would be caught by the same rule', () => {
    // The other half of the pair, kept because a wrong table and a wrong adapter are different
    // defects with different fixes, and 308's whole design is that the census names which it is.
    const reverted: SdkOptionClaim[] = CLAUDE_SDK_OPTIONS.map((claim) =>
      claim.option === 'mcpServers' ? { ...claim, stance: 'absent' as const } : claim,
    )
    expect(disagreements(reverted, PASSED)).toEqual([
      'mcpServers: the block says it is NOT passed, and optionsFor sets it',
    ])
  })
})

/**
 * 🔴 **…and the CODEX block answers to the writer** (314 §2.3).
 *
 * ## Why this half did not exist until now
 *
 * 308's header said, in as many words, *"this app never writes or reads that file; the binary
 * does"* — and while that was true there was nothing here for a test to hold. 314 made the app a
 * writer: `ensureCodexMemoryConfig` merges four memory keys into every Codex home's `config.toml`,
 * on provisioning and on every launch. The sentence a user reads about that file now makes a claim
 * about **our own** behaviour, which is exactly the shape of the defect 308 was written about.
 *
 * ## ⚑ Why this binding is stronger than the Claude one
 *
 * The Claude half scans the adapter's SOURCE for keys, and its own header lists what a textual scan
 * cannot see. This half does not read source at all: it runs the real merge on an empty config and
 * reads the keys **out of the file that comes back** — so what is compared against the disclosure is
 * what a provider home would actually contain.
 *
 * ⚠️ **The reader below is a second implementation on purpose.** Using the module's own scanner
 * would make this a test of one function against itself; a bug that dropped a key would produce a
 * file missing it and a claim missing it, and agree.
 *
 * ## ⚠️ What this still cannot see, said out loud
 *
 *  - ⛔ **It cannot prove the four keys DO anything.** 312 measured Codex's TOML parser silently
 *    accepting `[memories] not_a_real_field = true`, so a file is never the oracle for a capability.
 *    The oracle is the four `memories__*` names in a real child's inventory, and it lives in
 *    `packages/runtime/smoke/codex-memory-config.smoke.ts`.
 *  - ⚠️ **The MCP clause of the same sentence is still nobody's here** — see the header.
 */
describe('the Codex disclosure answers to the writer (314)', () => {
  /** Table-aware, and deliberately not the merge module's own scanner. */
  const keysIn = (text: string): string[] => {
    const found: string[] = []
    let table = ''
    for (const line of text.split('\n')) {
      const header = /^\[([A-Za-z0-9_-]+)\]\s*$/.exec(line.trim())
      if (header) {
        table = header[1]!
        continue
      }
      const assign = /^([A-Za-z0-9_-]+)\s*=/.exec(line)
      if (assign && table !== '') found.push(`${table}.${assign[1]!}`)
    }
    return found
  }

  const merged = mergeCodexMemoryConfig(null)
  const WRITTEN = merged.kind === 'merged' ? keysIn(merged.text) : []
  const codexBlock = readProviderConfig('codex', '/nowhere')

  it('⛔ every key the block names is one the writer really writes, and every one it writes is named', () => {
    expect(
      WRITTEN.slice().sort(),
      'the config block names a different set of memory keys than the merge writes. Correct ' +
        '`CODEX_MEMORY_SETTINGS` — both the sentence and the file’s comments are rendered from it.',
    ).toEqual(CODEX_MEMORY_SETTINGS.map((one) => `${one.table}.${one.key}`).sort())
    for (const key of WRITTEN) {
      expect(codexBlock.model, `the sentence stopped naming ${key}`).toContain(key)
    }
  })

  it('⚑ …and the roster is real — the merge produced a file, not an empty string (193)', () => {
    // ⛔ **Both sides, because either can go empty.** A `CODEX_MEMORY_SETTINGS` emptied to `[]`
    // would satisfy the rule above over nothing, and so would a merge that refused.
    expect(merged.kind).toBe('merged')
    expect(CODEX_MEMORY_SETTINGS.length).toBeGreaterThan(0)
    // 312's measured positive, by name. `dedicated_tools` specifically: the feature gate alone put
    // NO tools in the child's inventory, so a table that lost this row would read as complete.
    expect(WRITTEN).toContain('features.memories')
    expect(WRITTEN).toContain('memories.dedicated_tools')
    // …and the reader can say more than the four it is asked about, on a file of the same shape.
    expect(keysIn('[features]\nmemories = true\nsomething_else = 1\n')).toEqual([
      'features.memories',
      'features.something_else',
    ])
    // ⛔ **And it can say NO.** A key outside any table is not a key in one, which is the shape a
    // scanner that had lost its table tracking would still report.
    expect(keysIn('loose = 1\n')).toEqual([])
  })

  it('🔴 the sentence names no memory key the writer does not write', () => {
    // The direction 308 exists for, in this half: the code stops writing something and the prose
    // goes on promising it. Every `table.key`-shaped token in the Codex prose must be one we write.
    const prose = [
      codexBlock.model,
      codexBlock.authNote ?? '',
      ...codexBlock.files.map((file) => file.note),
    ].join(' ')
    const dotted = prose.match(/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\b/g) ?? []
    const undeclared = dotted.filter(
      (word) => !WRITTEN.includes(word) && !codexBlock.files.some((file) => file.name === word),
    )
    expect(
      [...new Set(undeclared)],
      'the Codex block spells a config key the app does not write into config.toml.',
    ).toEqual([])
    // Non-vacuity: the extractor really does find these tokens, proved on a synthetic line so the
    // real sentence is only asked to have something to extract (193).
    expect(
      'features.memories and memories.use_memories'.match(/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\b/g),
    ).toEqual(['features.memories', 'memories.use_memories'])
    expect(dotted.length).toBeGreaterThan(0)
  })

  it('⚠️ the block no longer says an absent config.toml means built-in defaults', () => {
    // ⛔ **That sentence went false at 314 and the reason is the whole dispatch**: the app creates
    // this file when a home has none, so for any profile that has been opened or prepared the state
    // it described no longer occurs. Asserted rather than deleted, because the next person to
    // shorten this note would put it back.
    const notes = codexBlock.files.map((file) => file.note).join(' ')
    expect(notes).not.toContain('absent means built-in defaults')
  })
})

/**
 * 🔴 **A panel that names ONE provider goes false the day the other grows the feature** (317).
 *
 * ## What was wrong
 *
 * `SessionInstructions.vue` labelled the agent's memory row *"written by the agent, loaded by Claude
 * itself"*. Both halves were measured and both were true at `165`. **`314` made the second half a
 * half-fact** by switching Codex's memory on for every profile — after which the panel was naming
 * one provider for a thing both of them do, and every Codex session reported no memory at all.
 *
 * ⚑ **This is `308`'s defect in the renderer instead of the main process**, so it gets `308`'s
 * remedy: the prose answers to something. Here there is no option table to derive from — the
 * sentence is about provenance, not about a call — so what is checked is the shape of the mistake
 * rather than the content of the claim. **A user-visible string on this panel may not name a
 * provider.**
 *
 * ## ⚠️ What this CANNOT see, said out loud
 *
 *  - **It is textual and it is a negative.** It proves no provider NAME survives in a rendered
 *    string; it cannot prove the sentence that replaced it is true. `instructions.dom.test.ts` holds
 *    the positive — that the row still says the agent wrote it and the provider loaded it.
 *  - **Comments are exempt, deliberately.** The reasoning above every label names both providers on
 *    purpose, and a check that forbade that would push the argument out of the file it belongs in.
 *    ⛔ The exemption is why the CONTROL below exists: it plants the old sentence back in a string
 *    and requires this to catch it.
 *  - **A synonym escapes it.** *"loaded by the CLI"*, or a product name spelled differently, passes.
 *    Same limit `namesMcp` has one section up, and the same answer: the width is stated, not
 *    assumed.
 */
const PANEL = 'apps/desktop/src/renderer/src/components/SessionInstructions.vue'

/**
 * The user-visible half of a single-file component: no comments, no `<style>`.
 *
 * ⚠️ **Block comments first, then line comments**, because a `//` inside a `/* … *\/` would
 * otherwise truncate the block at the wrong place and hide what follows from the scan.
 */
function renderedStrings(source: string): string {
  return source
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** Word-bounded and case-insensitive, for the reason `namesMcp` is: a rewording keeps neither. */
const namesAProvider = (text: string): string[] =>
  SUPPORTED_PROVIDERS.filter((provider) => new RegExp(`\\b${provider}\\b`, 'i').test(text))

describe('the instructions panel names no provider (317)', () => {
  it('⛔ no string a user reads on this panel names Claude or Codex', () => {
    // ⚑ The roster comes from `SUPPORTED_PROVIDERS`, so a third provider widens this check the day
    // it is added rather than the day somebody remembers.
    expect(namesAProvider(renderedStrings(read(PANEL)))).toEqual([])
  })

  it('⚑ …and the scan really reads this file — the roster is not empty (193)', () => {
    // Without this, a `PANEL` path that had moved would make the assertion above pass over nothing.
    const rendered = renderedStrings(read(PANEL))
    expect(rendered).toContain('agent memory — written by the agent, loaded by the provider')
    expect(rendered).toContain('a note the agent was asked to write')
    expect(SUPPORTED_PROVIDERS.length).toBeGreaterThan(1)
  })

  it('🔴 …and it CATCHES the sentence that actually shipped, not a literal it was tuned to', () => {
    // ⛔ The control. `314`'s label is planted back into a label map — the exact shape and the exact
    // place — and this check must find it. A rewording is caught too, because the test is about the
    // NAME rather than about the sentence around it.
    const shipped = read(PANEL).replace(
      "'agent memory — written by the agent, loaded by the provider'",
      "'agent memory — written by the agent, loaded by Claude itself'",
    )
    expect(namesAProvider(renderedStrings(shipped))).toEqual(['claude'])
    // …and the same trap with the other provider's name, so this is not one hard-coded word.
    const other = read(PANEL).replace(
      'a note the agent was asked to write',
      'a note Codex was asked to write',
    )
    expect(namesAProvider(renderedStrings(other))).toEqual(['codex'])
  })

  it('⚠️ …and does NOT fire on the reasoning, which names both on purpose', () => {
    // The paired negative for the comment exemption. The file's own comments discuss Claude and
    // Codex by name — that is the argument, and it belongs beside the code it explains.
    const source = read(PANEL)
    expect(namesAProvider(source).sort()).toEqual(['claude', 'codex'])
    expect(namesAProvider(renderedStrings(source))).toEqual([])
  })
})

/**
 * 🔴 **348 · the Codex block's OTHER claim: what rides on `thread/start`.**
 *
 * ⛔ **Acceptance #9 has two directions, and this is the second one.** `308` built the Claude table
 * because a sentence promised an option the adapter never passed. This is the mirror hazard: the
 * adapter passes something a person would look for in a file, and the block said nothing — so a
 * Codex user reading it would have gone to `config.toml` looking for five tools that are not there.
 */
describe('the Codex disclosure answers to thread/start (348)', () => {
  const codexBlock = readProviderConfig('codex', '/nowhere')
  const adapter = read(ADAPTER.codex)

  /** Does `threadStartParams` really set this field? Assignment-shaped, not a bare mention. */
  const sets = (field: string): boolean =>
    new RegExp(String.raw`\bparams\.${field}\s*=(?!=)`).test(adapter)

  it('⛔ every field the block claims is one the adapter really puts on thread/start', () => {
    expect(CODEX_THREAD_START_CLAIMS.length).toBeGreaterThan(0)
    for (const claim of CODEX_THREAD_START_CLAIMS) {
      expect(claim.stance, `${claim.option} is claimed but not passed`).toBe('passed')
      expect(
        sets(claim.option),
        `the block claims ${claim.option} and the adapter never sets it`,
      ).toBe(true)
      expect(codexBlock.model, `the sentence stopped naming ${claim.label}`).toContain(claim.label)
    }
  })

  it('⚑ …and the matcher can say no, on the same source (193)', () => {
    // Without this, the rule above would pass over a regex that matched everything.
    expect(sets('dynamicToolsNotARealField')).toBe(false)
    expect(sets('model')).toBe(true)
  })

  it('🔴 the block does not claim the tools are in the file, because they are not', () => {
    // ⛔ `348`'s brief expected this dispatch to write `[mcp_servers]` into `config.toml` and warned
    // that the file sentence would then become a promise. Nothing is written there — so the sentence
    // must keep saying the tools are NOT in that file, and a future dispatch that starts writing
    // them has to come here and say so.
    expect(codexBlock.model).toContain('not in that file')
    // ⚠️ **Both halves, and the second one is why this test exists.** `not in that file` alone is
    // satisfied by a sentence that then says *"they are declared in that file"* two clauses later —
    // a contradiction the reader has to catch, which is the mutation `M31` puts back. The clause
    // that says where they ARE is the one carrying the fact.
    expect(codexBlock.model).toContain('declared on the wire')
    expect(codexBlock.model).not.toMatch(/declared in that file/)
    const configFile = codexBlock.files.find((one) => one.name === 'config.toml')
    expect(configFile, 'the Codex block still names config.toml').toBeDefined()
    expect(configFile!.note).not.toContain("this session's own tools")
  })
})
