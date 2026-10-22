import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The renderer may not decide anything by recognising a provider's name (039).
 *
 * Normalize provider differences in the backend. The UI displays neutral plan, thinking, and
 * todo data consistently for Claude Code and Codex rather than interpreting provider-specific
 * shapes itself.
 *
 * **A rule without a gate decays**, and this one decays in a particular way: it costs one line to
 * break and the line always looks reasonable at the time. `planAvailable` was
 * `provider.value === 'claude'` for four tasks, and it was RIGHT — Claude's plan mode was the only
 * one wired. The problem was never that line; it was that the next five features each had an equally
 * reasonable version of it, and by then the architecture would be gone with no single commit to
 * blame.
 *
 * So this is a census, not a taste test: **every** provider literal in the renderer must have
 * an explicit permit, and none may be a comparison. The registry now supplies the default,
 * display names and usage windows, so no permits remain. The right way to add one is almost
 * never to edit the allowlist — it is to add an entry to `ProviderCapabilities` and
 * ask the backend.
 *
 * ⚠️ **What it does NOT cover, said out loud so a green run is not read as more than it is.**
 *
 * The review of this task demonstrated the first gap rather than arguing about it: a
 * `canPlan(p) { return p === 'claude' }` dropped into `src/shared/runtime-ipc.ts` and imported by
 * the launcher ran the comparison at runtime and left the census at a clean `3 allowlisted, 0
 * logic`. So `src/shared` is scanned too now — it is one file, it held nothing, and a documented
 * bypass is a bypass.
 *
 * What remains uncatchable is anything that assembles the name instead of writing it:
 * `'cl' + 'aude'`, a unicode escape, a computed key. This is a guard against DRIFT — the reasonable
 * line someone adds without thinking about the architecture — not against someone determined to
 * route around it. `SUPPORTED_PROVIDERS[0]` is in the pattern below because it is the one indirect
 * form that is genuinely tempting; the rest are not, and pretending otherwise would make this file
 * claim more than it can do.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '../src')
/**
 * Both trees the renderer's own code can live in.
 *
 * `shared/` is here because the renderer imports it. It belongs to main as well — and naming a
 * provider is ordinary work in main — but nothing in `src/shared` may branch on one either, because
 * a helper there is reachable from a component, which is precisely how the bypass was demonstrated.
 */
const SCANNED_ROOTS = ['renderer', 'shared']

/** One place a provider is named in the renderer. */
interface ProviderLiteralSite {
  /** Renderer-relative, POSIX-separated, so the allowlist reads the same on every machine. */
  readonly file: string
  readonly line: number
  /** The whole line, trimmed — what the allowlist matches on, and what a failure prints. */
  readonly code: string
  /** Whether the literal is being COMPARED against, which is the shape the rule is really about. */
  readonly comparison: boolean
}

/**
 * Blank a span while keeping its newlines, so every line number this file reports is the line number
 * in the file you are about to open.
 */
function blank(span: string): string {
  return span.replace(/[^\n]/g, '')
}

/**
 * COMMENTS ARE STRIPPED FIRST, and that is not a nicety.
 *
 * The renderer is FULL of legitimate prose naming both providers — `DEFAULT_PROVIDER`'s "Codex
 * because that is the quota dogfooding can spend", the launcher's history of what 030 got wrong
 * about Codex. A check that fires on its own documentation is a check people learn to silence, and
 * `import-codex.test.ts`'s safety scan already had to learn this: its first version flagged
 * `workspace.ts` for a comment explaining a risk we deliberately do NOT take.
 *
 * `<!-- -->` is in here because half the renderer is `.vue`, and template comments survive into the
 * SSR output — they are the single densest source of provider prose in the app.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

/**
 * A provider named in code, in the three shapes that name one.
 *
 *  - `'claude'` — quoted, and EXACTLY, so the `claude-haiku-4-5-20251001` in the model tooltip is
 *    not a hit. Model ids are the provider's vocabulary, not a decision about capability.
 *  - `claude:` — a bare object key. This one was added because the test below caught the scanner
 *    missing it: `{ claude: 'propose', codex: '' }[provider]` is a per-provider branch containing no
 *    quoted literal at all, and it is exactly what someone reaches for after a `===` is refused.
 *  - `.claude` — the same map, read the other way.
 *  - `SUPPORTED_PROVIDERS` — the runtime's own exported array, whose value is `['claude','codex']`.
 *    `provider.value === SUPPORTED_PROVIDERS[0]` is a provider comparison with no provider name in
 *    it, and it is the one indirect form a reasonable person might actually reach for. The review
 *    of this task found it; the name is flagged wherever it appears in these trees, which is also
 *    correct on its own terms — it is a runtime VALUE, and the renderer does not import those.
 *
 * Measured before widening: **no renderer file matches the last two today**, so this closes an
 * evasion without inheriting a backlog.
 *
 * Case-INSENSITIVE, also measured: `/i` adds zero hits to the current tree, and without it
 * `<option value="Codex">` would walk straight past. It does not start flagging DISPLAY TEXT that
 * happens to mention a provider, because the quote has to sit against the name — `SideRail`'s
 * *"Conversations from here, and from Claude's and Codex's own folders"* is the live example, and
 * naming two providers in one sentence is not a decision about either.
 *
 * ⚠️ **The example this paragraph used to cite is gone, and it was the launcher's yolo tooltip:**
 * `title="…and Codex also drops its sandbox."`. `367` replaced it with the clause that is true of
 * both providers, because the differing half now renders on the page — so the sentence is corrected
 * here rather than left pointing at a string no reader can find.
 */
const PROVIDER_LITERAL =
  /(['"`])(claude|codex)\1|\b(claude|codex)\s*:|\.(claude|codex)\b|\bSUPPORTED_PROVIDERS\b/gi

/** `=== 'claude'`, `!= "codex"`, `case 'claude':`, `[...].includes('codex')`. */
const COMPARES_BEFORE =
  /(?:[=!]==?\s*|\bcase\s+|\b(?:includes|startsWith|endsWith|indexOf)\s*\(\s*)$/
/** `'claude' === provider` — the same test written the other way round. */
const COMPARES_AFTER = /^\s*[=!]==?/

/**
 * Every provider literal in one file, with its shape.
 *
 * Exported so the tests below can run it over sources they wrote themselves. A scanner that has only
 * ever been pointed at code that passes is a scanner nobody has proved fires.
 */
export function providerLiteralSites(file: string, source: string): ProviderLiteralSite[] {
  const code = stripComments(source)
  const lines = code.split('\n')
  const sites: ProviderLiteralSite[] = []
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(PROVIDER_LITERAL)) {
      const at = match.index
      sites.push({
        file,
        line: index + 1,
        code: line.trim(),
        comparison:
          COMPARES_BEFORE.test(line.slice(0, at)) ||
          COMPARES_AFTER.test(line.slice(at + match[0].length)),
      })
    }
  }
  return sites
}

/** Every provider literal the renderer can reach, in file order. */
function scanRenderer(): { sites: ProviderLiteralSite[]; scanned: number } {
  const sites: ProviderLiteralSite[] = []
  let scanned = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (!/\.(ts|vue)$/.test(entry.name)) continue
      scanned += 1
      const file = relative(SRC, child).split(sep).join('/')
      sites.push(...providerLiteralSites(file, readFileSync(child, 'utf8')))
    }
  }
  for (const root of SCANNED_ROOTS) walk(join(SRC, root))
  return { sites, scanned }
}

/**
 * The legitimate ones — and the whole list, because anything not here is a failure.
 *
 * Both kinds are the same kind underneath: **naming a provider to offer it is fine; naming one to
 * decide something is not.** A default has to be one of them, and a display-name table is keyed by
 * one. Neither reads a provider's name and concludes something about what it can do.
 *
 * ## ⚑ 417 (HO-022 §2) removed two entries, and both were the PICKER's
 *
 * `<option value="codex">codex</option>` and `<option value="claude">claude</option>`, in
 * `renderer/src/components/NewConversation.vue`, allowlisted as *"the picker — you must be able to
 * choose a provider"*. ⛔ **You could not, for three dispatches**: *"Opening a new conversation opens
 * a conversation with BroBot. That is all."* — the `provider-select` went with every other question
 * the front door asked, and the launcher ran on `RuntimeScreen.DEFAULT_PROVIDER`, which is the entry
 * below.
 *
 * ⚠️ **This is a narrowing of the census, not a weakening of it.** The rule 039 guards is that no
 * renderer file DECIDES by recognising a name; two fewer allowlisted lines means two fewer permits,
 * and `logic: 0` is untouched.
 *
 * ## 🔴 `435` put the picker back and this file did NOT go red — which is the census working
 *
 * ⛔ **`417` wrote here that *a provider picker put back anywhere would fail this file*, and that
 * was wrong about its own rule.** HO-025 §5 put `provider-select` back on the front door and the
 * count below did not move, because the control is built from the `PROVIDER_NAME` TABLE —
 * `Object.keys(PROVIDER_NAME) as Provider[]`, labelled with `providerName(each)` — and writes no
 * provider literal at all.
 *
 * ⚑ **That is the difference this file exists to draw.** What it refuses is a renderer that NAMES a
 * provider; offering a person a choice between whatever providers exist is not naming one, and a
 * picker that has to grow the allowlist is a picker that typed a literal instead of reading the
 * table. ⚠️ **So the two permits `417` removed are still gone and should stay gone** — the shape
 * they allowed is the shape `435` did not need.
 */
const ALLOWED: readonly { readonly file: string; readonly code: string; readonly why: string }[] =
  []

const isAllowed = (site: ProviderLiteralSite): boolean =>
  ALLOWED.some((ok) => ok.file === site.file && ok.code === site.code)

const describeSite = (site: ProviderLiteralSite): string =>
  `${site.file}:${site.line} — ${site.code}`

describe('the renderer never decides a capability by recognising a provider (039)', () => {
  it('catches the exact line 039 removed', () => {
    // What `NewConversation.vue` said before this task. If this scanner cannot see THIS, it is
    // decoration — so it is the first thing asserted, before any claim about the real tree.
    const sites = providerLiteralSites(
      'x.vue',
      "const planAvailable = computed(() => provider.value === 'claude')",
    )
    expect(sites).toHaveLength(1)
    expect(sites[0]?.comparison, 'a comparison must be recognised as one').toBe(true)
  })

  it('catches the other shapes the same decision can be written in', () => {
    // Someone who wanted the old behaviour back would not retype the old line — they would write one
    // of these. Every one is the same rule broken, so every one has to be SEEN; whether it is also
    // classified as a comparison is secondary, and the last two are the reason why. They branch on
    // the provider without comparing anything, which is why the census is the primary gate and the
    // comparison flag is only there to make the failure message accurate.
    const shapes = [
      { code: "if (session.provider !== 'codex') showThinkingText()", comparison: true },
      { code: "switch (p) { case 'claude': return true }", comparison: true },
      { code: "const canPlan = allowed.includes('claude')", comparison: true },
      { code: "const flag = 'claude' === provider", comparison: true },
      { code: 'const label = { claude: "propose", codex: "" }[provider]', comparison: false },
      { code: "const canPlan = ['claude', 'codex'].indexOf(p) === 0", comparison: false },
      // Found by the review: the same comparison with the name fetched instead of typed. It is a
      // comparison, and the flag says so, because the operator is right there.
      { code: 'const canPlan = provider.value === SUPPORTED_PROVIDERS[0]', comparison: true },
      // Capitalised, which the gate was blind to until it was made case-insensitive. A picker option
      // is where this would really appear.
      { code: '<option value="Codex">Codex</option>', comparison: false },
    ]
    for (const shape of shapes) {
      const sites = providerLiteralSites('x.ts', shape.code)
      expect(sites.length, `unseen: ${shape.code}`).toBeGreaterThan(0)
      expect(
        sites.some((site) => site.comparison),
        shape.code,
      ).toBe(shape.comparison)
    }
  })

  it('does not fire on prose about providers — the comment stripping', () => {
    // The failure mode that would make this test hated. Every one of these is real renderer text or
    // a close paraphrase of it.
    const prose = [
      "// Codex because that is the quota dogfooding can spend — 'codex' is the default",
      '/* 030 said Codex has no plan mode. It has one: `ModeKind = "plan" | "default"`. */',
      '<!-- CLAUDE ONLY. A greyed-out control would say "you cannot have this here". -->',
      "<!--\n  provider === 'claude' was the leak this task removed.\n-->",
    ]
    for (const line of prose) {
      expect(providerLiteralSites('x.vue', line), line).toEqual([])
    }
  })

  it('…and the stripping is not quietly eating real code', () => {
    // The other side of it: a check that stripped too much would pass everything and mean nothing.
    // Code AFTER a comment, and code on the same line as a trailing one, both stay visible.
    const source = [
      '/* a block comment mentioning claude */',
      "const leak = provider === 'claude' // and a trailing comment about codex",
      '<!-- a template comment about codex -->',
      "const other = p === 'codex'",
    ].join('\n')
    const sites = providerLiteralSites('x.vue', source)
    expect(
      sites.map((s) => s.line),
      'line numbers must survive stripping',
    ).toEqual([2, 4])
    expect(sites.every((s) => s.comparison)).toBe(true)
    // A URL is not a comment. `^[ \t]*//` is anchored for this reason.
    expect(providerLiteralSites('x.ts', "const url = 'https://x/y' + p === 'codex'")).toHaveLength(
      1,
    )
  })

  it('every provider literal the renderer can reach is one `ALLOWED` argues for', () => {
    const { sites, scanned } = scanRenderer()
    // Non-vacuity: a scanner pointed at nothing reports nothing, and `> 20` against a tree of ~63
    // would let a walk that had quietly lost two thirds of it still pass. Close to the real number,
    // so shrinking the tree is a deliberate edit here rather than a silent one.
    //
    // ⚠️ RAISED WITH THE TREE (037: 63 → 67 files). This number is a floor that only does its job
    // while it stays close to the count, and the failure mode is silent in the other direction:
    // every task that adds a renderer file and leaves the floor alone widens the gap a lost
    // subdirectory could hide in. Move it when you add files, not only when you remove them.
    expect(
      scanned,
      `the walk of ${SCANNED_ROOTS.join(' + ')} must find the whole tree`,
    ).toBeGreaterThan(60)

    // Asserted BEFORE the count, so that the message a developer actually hits when they break this
    // is the one that tells them what to do instead of "expected 4 to be 3".
    expect(
      sites.filter((site) => !isAllowed(site)).map(describeSite),
      'a file the renderer can reach names a provider. Ask the backend what the session SUPPORTS — ' +
        'add an entry to ProviderCapabilities (packages/runtime/src/capabilities.ts) rather than ' +
        'widening this list',
    ).toEqual([])
    // Every permit must still name a live site. The registry removed the last permits;
    // synthetic scanner checks above continue to prove that provider literals are seen.
    expect(
      ALLOWED.filter((ok) => !sites.some((s) => s.file === ok.file && s.code === ok.code)).map(
        (ok) => ok.file,
      ),
      'an allowlisted site is no longer found — the scanner has stopped seeing it, or it moved',
    ).toEqual([])
  })

  it('…and the census fires on a leak added to a real renderer file', () => {
    /**
     * The end-to-end proof the dispatch asks for, run in-process rather than by editing a file and
     * remembering to put it back.
     *
     * The three synthetic tests above prove the SCANNER fires. This proves the assembled thing does:
     * a real component's real source, plus the exact line 039 removed, goes through the same scan
     * and the same allowlist and comes out as a reportable failure. Without it, the scanner could be
     * perfect and the allowlist could still be matching so loosely that everything passes.
     */
    const name = 'renderer/src/components/SessionLibrary.vue'
    const real = join(SRC, name)
    const leaked = `${readFileSync(real, 'utf8')}\n<script lang="ts">\nconst can = (p: string) => p === 'claude'\n</script>\n`

    const clean = providerLiteralSites(name, readFileSync(real, 'utf8'))
    expect(clean, 'the file this is built on must be clean to begin with').toEqual([])

    const sites = providerLiteralSites(name, leaked)
    expect(sites.filter((site) => !isAllowed(site)).map(describeSite)).toHaveLength(1)
    expect(sites[0]?.comparison).toBe(true)
  })

  it('…and the top bar has no permits, including for its former provider rows', () => {
    const name = 'renderer/src/composables/useUsageCells.ts'
    const real = readFileSync(join(SRC, name), 'utf8')
    const clean = providerLiteralSites(name, real)
    expect(clean).toEqual([])
    expect(ALLOWED).toEqual([])
    for (const third of [
      "  claude: ['5-hour', 'weekly'],",
      "  codex: ['weekly'],",
      "const LABELS = { codex: 'weekly only' }",
      "const hide = (p: string) => p === 'codex'",
      // The same key with another value is another line, and is not permitted.
      "  codex: ['5-hour', 'weekly'],",
    ]) {
      const sites = providerLiteralSites(name, `${real}\n<script lang="ts">\n${third}\n</script>\n`)
      expect(
        sites.filter((site) => !isAllowed(site)).map((site) => site.code),
        third,
      ).toEqual([third.trim()])
    }
  })

  it('none of them is a comparison — an allowlist is not a way to smuggle one in', () => {
    // Belt and braces. Editing the allowlist is a deliberate act; editing it to re-admit a
    // comparison would be the failure this whole file exists to prevent, wearing a permit.
    const { sites } = scanRenderer()
    expect(sites.filter((site) => site.comparison).map(describeSite)).toEqual([])
  })

  it('the renderer has zero allowlisted provider lines and zero provider logic', () => {
    // Display names, defaults and usage windows now come from the registry.
    const { sites } = scanRenderer()
    expect({
      allowlisted: new Set(sites.filter((s) => !s.comparison).map(describeSite)).size,
      logic: sites.filter((s) => s.comparison).length,
    }).toEqual({ allowlisted: 0, logic: 0 })
  })
})
