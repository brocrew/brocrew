import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HOOK_NAME, fillHoles, selectorsIn } from '../lib/tab-flow.mjs'

/**
 * 🔴 **420 §5 · every hook a live script addresses is a hook the renderer still draws.**
 *
 * ## ⛔ The gate hole this closes, named exactly
 *
 * `417` deleted the launcher's settings block. **`pnpm run ci` went green over three broken
 * instruments**: fifty-four steps of `ui-live-smoke.mjs`, every step of `resume-live-smoke.mjs`
 * after its first, and four steps of `packaged-smoke.mjs`. The readiness gates in two of them
 * waited on `provider-select`, so they did not fail — they burned their budget and then reported
 * the app.
 *
 * ⚠️ **A guard for this already existed and structurally could not see it.**
 * `apps/desktop/test/conversation-chrome.test.ts` collected the hooks the scripts CLICK
 * (`CLICK('x')`, `clickWhenReady(cdp, 'x')`) and checked those against the components. Every hook
 * `417` removed is reached by `SET_VALUE` or a raw `querySelector` — **a read, never a click** —
 * and that exclusion was deliberate and documented: *"a read can legitimately address something
 * that is not there: a step asserts an ABSENCE."* ⛔ **That reasoning is sound for one hook and
 * wrong for the set.** `create-session` is checked for precisely because the launcher must not
 * offer it; `provider-select` was being WRITTEN TO. This file separates the two by asking the
 * question the other one could not: not *is it clicked*, but **does anything in the renderer draw
 * it** — with an explicit, named roster for the handful of reads that are assertions of absence.
 *
 * ⚑ **That describe is retired in the same commit** rather than left beside this one. Two
 * spellings of one rule is the drift this repo keeps paying for, and the weaker spelling is the
 * one that goes.
 *
 * ## ⛔ Two derivations, and they are genuinely two
 *
 * `a-test-that-plants-and-finds-with-one-derivation` is the trap here. The two sides read
 * different languages for different things:
 *
 *  - **The script side** parses CSS *selectors and helper calls* — `[data-cy=…]`,
 *    `SET_VALUE('x', …)`, `CLICK('x')`, `clickWhenReady(cdp, 'x')`. It reuses
 *    {@link selectorsIn}, {@link fillHoles} and {@link HOOK_NAME} from `scripts/lib/tab-flow.mjs`
 *    — **the live walk's own grammar**, on purpose. A second regex for `[data-cy=…]` would be free
 *    to disagree with the walk about which reads exist at all, and `hook-reach.test.mjs` already
 *    states the rule: *"this repo has already paid for that shape once."*
 *  - **The renderer side** parses Vue *declarations* — `data-cy="x"`, `:data-cy="'x'"`,
 *    ``:data-cy="`x-${…}`"``, and the `cy:` fields of a `<script setup>` table that a bound
 *    expression reads. It shares nothing with the script side but {@link HOOK_NAME}'s character
 *    class.
 *
 * 🔴 **The one derivation that IS shared is family-head extraction** — the script side takes the
 * head of a `^=` scan, the renderer side takes the head of a template literal — and §4's planted
 * pair is what stops that from being a rule agreeing with itself.
 *
 * ## ⚠️ Three shapes that were got wrong on the way here, kept as fixtures in §4
 *
 *  1. **Substring matching.** `ui-live-smoke.mjs:13710` reads `[data-cy=cwd-choose]`. The renderer
 *     draws `project-cwd-choose` and `new-project-cwd-choose` — different hooks that merely
 *     CONTAIN the string. A `components.includes(cy)` census reports it alive. ⛔ It is dead:
 *     `417` deleted `data-cy="cwd-choose"` from the launcher. The renderer side matches **whole
 *     names**.
 *  2. **A bound expression that is a bare identifier.** `SessionPanel.vue:192` is
 *     `:data-cy="section.cy"`, and `panel-permissions` / `panel-questions` / `panel-agents` /
 *     `panel-workflows` are `cy:` fields in its `<script setup>`. A template-only census reports
 *     four phantom deaths.
 *  3. **A multi-line binding.** `UserInputCard.vue:371` opens `:data-cy="` on one line and puts
 *     both template literals on continuation lines. A regex anchored to ``:data-cy="` `` misses
 *     the `user-input-answer-` family entirely.
 *
 * ⚑ **And comments are stripped before anything is asserted** — `profile-input` and
 * `compaction-entry` survive in `ui-live-smoke.mjs` only inside `//` lines describing reads that
 * were retired. A census that read prose would report two more phantom deaths
 * (`a-source-census-must-strip-prose-before-it-asserts`).
 */

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..')
const RENDERER = join(SCRIPTS, '../apps/desktop/src/renderer/src')

const script = (name) => readFileSync(join(SCRIPTS, name), 'utf8')

/* ── the roster ───────────────────────────────────────────────────────────────────────────── */

/**
 * **Every `.mjs` directly under `scripts/` that addresses a `data-cy` hook at all.**
 *
 * ⛔ **Derived, not listed** — `hook-reach.test.mjs`'s own ruling: *"A hardcoded list is the defect
 * one level up."* ⚠️ **And deliberately wider than the three instruments `420` repairs**: the
 * probes below were at zero dead hooks then, so covering them costs one filter and nothing else,
 * while naming three would leave `session-info-probe.mjs` (18 hooks) exactly as dark as the three
 * were before `417`.
 *
 * ⚑ **Derived AND pinned**, which is not a contradiction. The derivation does the covering; the
 * equality below makes a script joining or leaving the set a red somebody acknowledges in a diff.
 */
const DRIVERS = readdirSync(SCRIPTS)
  .filter((name) => name.endsWith('.mjs'))
  .filter((name) => /\[\s*data-cy/.test(script(name)))
  .sort()

/* ── the script side ──────────────────────────────────────────────────────────────────────── */

/**
 * What a `${…}` becomes here. ⛔ **Deliberately not hook-shaped** — see {@link addressedBy}. The
 * character is outside {@link HOOK_NAME}'s class, so a filled hole can never be mistaken for a
 * name, and a head ending in one is a family rather than an element.
 */
const HOLE = '\u2205'

/** The house convention for *this line is code, not prose*, shared with `builtHookViolations`. */
const isProse = (line) => {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')
}

/**
 * The four helpers that take a **bare hook name** rather than a selector.
 *
 * ⚠️ Their own bodies build `[data-cy="${sel}"]`, so {@link selectorsIn} sees the definitions and
 * not the call sites. Without this the ninety-odd `SET_VALUE('provider-select', …)` writes — which
 * is exactly what `417` broke — are invisible to a selector-only census.
 *
 * ⛔ **The optional first argument is ANY identifier, not `cdp`.** `clickWhenReady` takes the
 * connection first and `ui-live-smoke.mjs` routinely drives its own-instance steps through
 * `ownCdp` / `secondCdp` / `sweepCdp`; a pattern spelled `cdp2?` — which this was — would have
 * left the first click of every own-app step silently unguarded. Found by an adversarial pass
 * over `420`'s own diff, while no call site had yet exercised it.
 *
 * 🔴 **`showToldTab` joined the list at `583`, and the reason is this census's own subject.**
 * ⛔ That dispatch made the agent's instructions sheet a TAB STRIP — one owner's rows in the
 * document at a time — so five live steps now press `told-tab-<owner>` before they read anything,
 * through a helper that takes the hook by name exactly as {@link clickWhenReady} does. ⚠️ **Four
 * of those five names are ALSO written as selectors** in the readiness read that follows each
 * press, and are covered either way; `told-tab-not-read` is named nowhere else, so without this
 * arm the one tab whose whole content is *what BroBot would not read* could be renamed with
 * nothing going red until a live run eight minutes in. ⚑ A helper that takes a bare hook name is
 * the shape this list is FOR, and the cost of admitting one is one alternative.
 */
const BY_NAME =
  /\b(SET_VALUE|CLICK|clickWhenReady|showToldTab)\(\s*(?:[A-Za-z_$][\w$]*,\s*)?'([^']*)'/g

/**
 * What one script addresses: `{ exact, scanned }`.
 *
 * `exact` is a hook it names outright — a promise that the renderer draws that hook. `scanned` is
 * a `^=` prefix read (`[data-cy^=open-session-]`), which is a promise about a FAMILY.
 */
function addressedBy(source) {
  const exact = new Set()
  const scanned = new Set()
  for (const raw of source.split('\n')) {
    if (isProse(raw)) continue
    // ⛔ **Node-side `${…}` holes are already filled by the time the page sees them** — the walk's
    // own substitution, reused through {@link fillHoles} so the brace-and-quote counting has one
    // implementation. ⚠️ **But NOT with the walk's placeholder.** `asEvaluated` fills a hole with
    // a hook-shaped `x`, which is right for *"would this read be legal?"* and useless here: a
    // census asking *"does the renderer draw this?"* must tell a filled hole apart from a name
    // somebody wrote, and `x` is a legal hook name. {@link HOLE} cannot be one.
    const line = fillHoles(raw, HOLE)
    for (const selector of selectorsIn(line)) {
      const value = selector.value
      const at = value.indexOf(HOLE)
      if (at === 0) continue // the whole name is built — `hook-reach.test.mjs` owns that rule
      // ⚑ **A hole after a literal head is a FAMILY reference**, `[data-cy=open-session-${id}]`,
      // and is checked as one. Treating it as an exact hook would report every per-row element in
      // the app as missing; ignoring it would make the commonest read in these scripts invisible.
      const head = at < 0 ? value : value.slice(0, at)
      if (!HOOK_NAME.test(head)) continue
      if (at >= 0 || selector.scan) scanned.add(head)
      else exact.add(head)
    }
    for (const m of line.matchAll(BY_NAME)) if (HOOK_NAME.test(m[2])) exact.add(m[2])
  }
  return { exact: [...exact], scanned: [...scanned] }
}

/* ── the renderer side ────────────────────────────────────────────────────────────────────── */

/** Every `.vue` and `.ts` under the renderer, read once. */
function rendererSources() {
  return readdirSync(RENDERER, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(vue|ts)$/.test(name))
    .map((name) => withoutProse(readFileSync(join(RENDERER, name), 'utf8')))
}

/**
 * ⛔ **Prose is stripped on BOTH sides, and the second half was missing.**
 *
 * The script side has always dropped comment lines — without it `profile-input` and
 * `compaction-entry` read as phantom deaths. ⚠️ **The renderer side did not**, and the asymmetry
 * fails in the direction that matters: `R1` matches `data-cy="…"` inside a docblock, so a hook
 * DELETED from a template while a comment still quotes its declaration reads as alive. That is
 * the `cwd-choose` class — a dead hook reported as drawn — arriving from the other side of the
 * same test. ⚑ There is one such quotation in the tree today (`RuntimeScreen.vue` names
 * `session-error` in prose), harmless only because `ConversationPane.vue` really draws it.
 *
 * ⚠️ Block comments AND line comments, because a Vue `<!-- … -->` and a JS `/* … *\/` both hold
 * hook names in this tree, and a line-only stripper would leave both.
 */
function withoutProse(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/**
 * **What the renderer draws: the exact hooks, and the family heads.**
 *
 * Four rules, each for a spelling that exists in the tree today:
 *
 *  - **R1** a static attribute, `data-cy="x"`. ⛔ The lookbehind is load-bearing: without it the
 *    same pattern matches inside `:data-cy="…"` and turns every binding's body into an exact hook.
 *  - **R2** any bound binding, `:data-cy="…"`, body captured whole with `[\s\S]*?` so a
 *    **multi-line** one is seen (`UserInputCard.vue:371`). Inside the body: a template literal
 *    with a hole is a FAMILY (its literal head); one without is exact; and every quoted literal is
 *    exact, which is what sees a single-line ternary of two names (`PersonsQueue.vue:242`).
 *  - **R3** a body that is a bare identifier or member expression — `:data-cy="section.cy"` — means
 *    the names live in `<script setup>`, so the file's `cy: '…'` fields are harvested too.
 *
 * ⚠️ **Reads are excluded by construction, not by a list.** `CapabilitiesSheet.vue:244`'s
 * ``querySelector(`[data-cy="capability-${key}-input"]`)`` and the two `[data-cy='…']` CSS rules
 * are selectors, not declarations, and none of R1–R3 matches a `[`.
 */
function drawnByTheRenderer() {
  const exact = new Set()
  const families = new Set()
  for (const source of rendererSources()) {
    for (const m of source.matchAll(/(?<![:\w-])data-cy="([^"]*)"/g)) exact.add(m[1]) // R1
    for (const m of source.matchAll(/:data-cy="([\s\S]*?)"/g)) {
      const body = m[1]
      for (const lit of body.matchAll(/`([^`]*)`/g)) {
        const head = /^([A-Za-z0-9][A-Za-z0-9_./:-]*)/.exec(lit[1])?.[1]
        if (head === undefined) continue
        if (lit[1].includes('${'))
          families.add(head) // R2a
        else exact.add(lit[1]) // R2b
      }
      for (const lit of body.matchAll(/'([^']*)'/g)) exact.add(lit[1]) // R2c
      if (/^\s*[A-Za-z_$][\w.$]*\s*$/.test(body)) {
        for (const field of source.matchAll(/\bcy:\s*'([^']*)'/g)) exact.add(field[1]) // R3
      }
    }
  }
  return { exact, families }
}

const DRAWN = drawnByTheRenderer()

/**
 * Whether the renderer draws this hook.
 *
 * ⛔ **A family match needs a NON-EMPTY suffix.** `open-session-` is a family; the bare head
 * `open-session-` is not an element anybody renders, and admitting it would make every family a
 * wildcard over its own prefix.
 */
const drawn = (hook) =>
  DRAWN.exact.has(hook) ||
  [...DRAWN.families].some((head) => hook.startsWith(head) && hook.length > head.length)

/**
 * 🔴 **The reads that are assertions of ABSENCE — and there are NONE. That is the finding.**
 *
 * ⛔ `conversation-chrome.test.ts` excluded every READ from its census to make room for this
 * class, and documented the reason: *"a step asserts an ABSENCE (`create-session` is checked for
 * precisely because the launcher must not offer a second start path)."* ⚑ That bought four
 * exemptions at the price of eighty-odd unchecked WRITES — and the writes are what `417` broke.
 *
 * ⚑ **`420` found the class is empty, and made it stay empty rather than carrying a list.** The
 * one live step that really does assert an absence — `ui-live-smoke.mjs` step 13, *"the front
 * door asks nothing"* — reads `[...el.querySelectorAll('[data-cy]')].map((n) => n.dataset.cy)`
 * and decides in Node against a list beside the assertion. ⛔ It has to be written that way
 * anyway: `'[data-cy=' + cy + ']'` is the exact shape 097's walk refuses
 * (`scripts/lib/tab-flow.mjs`'s `unreadableSelectorIn`), so the house idiom and this census agree
 * — a step asking whether a hook is THERE must name it, and a step asserting it is not must not.
 *
 * ⚠️ **If one is ever genuinely needed**, the shape is a `Record<hook, why>` checked both ways:
 * the hook is named by some script, AND it really is absent from the renderer. Both halves,
 * because an exemption list rots in one direction — a name stays on it after the read that needed
 * it is gone, and then it silently exempts a hook nobody mentions.
 */

/* ── the tests ────────────────────────────────────────────────────────────────────────────── */

describe('420 §5 · the live scripts address hooks the renderer still draws', () => {
  it('⛔ the roster is derived, non-empty, and is exactly the scripts that address a hook', () => {
    expect(
      DRIVERS,
      'no script under scripts/ addresses a data-cy hook — the derivation found nothing',
    ).not.toEqual([])
    expect(DRIVERS).toEqual([
      // ⚑ 744 · types into the launcher's `prompt-input` on the built app, kills or quits it, and
      // reads the same box back after the relaunch (R100).
      'draft-survives-a-restart-probe.mjs',
      // ⚑ 455 · the first script in this repository to measure the safety lane in a PHYSICAL
      // window. It walks to `rail-team`, waits for `team-workspace`, then presses `team-open-*`
      // or `team-create` to get an overlay open, because every `OverlayHost` is behind a `v-if`.
      // ⚠️ **It addressed `rail-agents`, `rail-agent-*` and `rail-new-agent` until `570`**, when
      // `EXT-008` §4.4 took that section out of the rail. ⛔ **The fallback is the load-bearing
      // half and the move made it stronger**: a fresh install has no identity row, and
      // `New agent` is drawn on the page's header whether or not the identities read has landed.
      'lane-geometry-probe.mjs',
      // The update rehearsal's Mac lane: the menu's Check and Download, and the launcher's draft.
      'mac-update-test.mjs',
      'packaged-smoke.mjs',
      // Drives the built app's recovery window by its hooks: the verdict, history and controls.
      'recovery-real-entry-check.mjs',
      'resume-live-smoke.mjs',
      'session-info-probe.mjs',
      'ui-live-smoke.mjs',
      // ⚑ Types an unsent draft into `prompt-input` on a released beta, then checks the candidate
      // installed over it still holds it.
      'upgrade-path.mjs',
      'window-controls-probe.mjs',
      // The update rehearsal's Windows lane: the menu's Check, Download, Restart to update and its
      // automatic-check switch.
      'windows-update-test.mjs',
    ])
  })

  it('⛔ the renderer side really read the renderer', () => {
    // ⛔ **The floors are the address, not the answer** (`hook-reach.test.mjs`). An empty
    // `DRAWN.exact` is what a deleted component tree looks like AND what a path typo looks like,
    // and with it every assertion below would report the whole repo as dead.
    expect(DRAWN.exact.size, 'no static hooks were read at all').toBeGreaterThan(400)
    expect(DRAWN.families.size, 'no hook families were read at all').toBeGreaterThan(50)
    // …and the three spellings the brief's own census got wrong, each named.
    expect(DRAWN.exact.has('panel-permissions'), 'R3 did not reach SessionPanel’s cy: fields').toBe(
      true,
    )
    expect(DRAWN.families.has('user-input-answer-'), 'R2 did not see a multi-line binding').toBe(
      true,
    )
    expect(DRAWN.exact.has('persons-queue-you'), 'R2c did not see a ternary of two literals').toBe(
      true,
    )
  })

  it.each(DRIVERS)('%s addresses no hook the renderer has stopped drawing', (name) => {
    const { exact } = addressedBy(script(name))
    // ⛔ **Non-vacuity per file, not once for the set.** A regex that stopped matching in ONE
    // script would report that script clean, and the `it.each` above would still be eight greens.
    expect(exact.length, `${name} was read and no hook came out of it`).toBeGreaterThan(0)
    const missing = exact.filter((hook) => !drawn(hook)).sort()
    expect(missing, `${name} addresses hooks nothing renders: ${missing.join(', ')}`).toEqual([])
  })

  it.each(DRIVERS)('%s scans no hook FAMILY the renderer has stopped drawing', (name) => {
    // ⚠️ **A weak positive, and said so.** `[data-cy^=open-session-]` promises a family, not a
    // member, so all this can hold is that the head still resolves — to a declared family, or to
    // any exact hook that begins with it. ⛔ What it catches is the case that actually happened:
    // `suggestion-` in `ui-live-smoke.mjs:7348`, a prefix scan whose whole family `417` deleted.
    const { scanned } = addressedBy(script(name))
    // ⚑ **Three ways a scan's head can resolve, and the third is the commonest.** A script
    // routinely scans a prefix LONGER than the declared family — `[data-cy^=attention-att]`
    // against `` `attention-${item.id}` ``, `[data-cy^=palette-row-agent-]` against
    // `` `palette-row-${row.id}` `` — because it is selecting a subset of one family by the shape
    // of the ids in it. ⛔ A check that only looked for a family starting with the head reports
    // every one of those as orphaned, which is a guard that fails correct steps.
    const resolves = (head) =>
      [...DRAWN.families].some((family) => family.startsWith(head) || head.startsWith(family)) ||
      [...DRAWN.exact].some((hook) => hook.startsWith(head))
    const orphaned = scanned.filter((head) => !resolves(head)).sort()
    expect(orphaned, `${name} scans families nothing renders: ${orphaned.join(', ')}`).toEqual([])
  })

  it('⛔ no script asserts an absence by NAMING a hook — the exemption class is empty', () => {
    // ⚑ **The claim the paragraph above makes, checked rather than asserted in prose.** The day a
    // step needs to name a dead hook, this goes red and somebody has to add the exemption
    // deliberately — which is the whole difference between a list and a hatch.
    //
    // ⚠️ Both halves of the one legitimate absence-assertion, so this cannot pass because the step
    // was deleted: the step is there, and it does the census the safe way.
    const smoke = script('ui-live-smoke.mjs')
    expect(smoke, 'step 13 no longer asserts the front door asks nothing').toContain(
      'const FRONT_DOOR_ASKS_NOTHING = [',
    )
    expect(smoke).toContain("[...el.querySelectorAll('[data-cy]')].map((node) => node.dataset.cy)")
    // …and the names it decides against are NOT reachable as selectors, which is what keeps them
    // out of every census above.
    const named = new Set(DRIVERS.flatMap((name) => addressedBy(script(name)).exact))
    // ⚠️ **`provider-select` and `model-input` left this list at `435`** — not because a script
    // started addressing them, but because the reason they were on it stopped being true. ⛔ **A
    // name is on this list because the renderer does not draw it**; both are drawn again (HO-025
    // §5), so asserting they are unreachable would be asserting something about a live control.
    // ⚑ **The two that stay are still gone**: `cwd-input` is the folder field `424` answered with
    // BroBot's own workspace, and `create-session` is the form-submit `013` replaced with the
    // composer. ⚠️ **No script addressed the two that came back either**, and `435` deliberately did
    // not make one: the instruments' front door is a whitelist that carries a prompt and nothing
    // else, and converting a placement to it is the instrument owner's call (`435 §6`) — which
    // `738` made for `provider-select` alone (below).
    // ⚑ **UI-012 (R-3) · and the three are gone again, into ONE control** — the model picker, whose
    // list names the provider and holds the effort. ⛔ So they are back on this list, for its own
    // reason: the renderer does not draw them.
    for (const dead of ['cwd-input', 'create-session']) {
      expect(named, `${dead} is addressed as a selector again`).not.toContain(dead)
    }
    for (const gone of ['provider-select', 'model-input', 'reasoning-effort-select']) {
      expect(drawn(gone), `${gone} is what UI-012 folded into the model picker`).toBe(false)
      expect(named, `${gone} is addressed as a selector again`).not.toContain(gone)
    }
    // ⚑ **738 · the front door's provider IS driven, by one instrument and for one reason** — the
    // instrument owner's call `435 §6` left open. `packaged-smoke.mjs` step 5 picks Codex there,
    // because since `433` the front door runs BroBot on its seeded Claude once the identity exists,
    // and the missing-binary message it measures is Codex's (`680` F12). ⚑ UI-012 · it picks a Codex
    // MODEL in the picker now, the provider select being gone. ⛔ Pinned to that one file, so a
    // second driver is a decision somebody makes, not a drift.
    expect(drawn('model-picker-face'), 'the front door draws the model picker').toBe(true)
    expect(
      DRIVERS.filter((name) => addressedBy(script(name)).exact.includes('model-picker-face')),
    ).toEqual(['packaged-smoke.mjs'])
  })
})

describe('…and the guard can actually go red', () => {
  /**
   * ⛔ **The plant-and-find half.** On its own it proves only the DETECTOR; the floors and the
   * per-file non-vacuity above are what prove the real files were opened. Two plants per rule
   * wherever a walk could stop at its first match.
   */
  it('⛔ a deleted hook is caught — by its whole name, never by a substring', () => {
    const planted = addressedBy(`await cdp.evaluate(SET_VALUE('cwd-choose', dir))`)
    expect(planted.exact).toEqual(['cwd-choose'])
    expect(drawn('cwd-choose')).toBe(false)
    // 🔴 **The trap in reverse.** `agent-slug-folded` is drawn (`NewAgent.vue`) and CONTAINS
    // `slug-folded`, which `NewProject.vue` drew until D-016 deleted it; a substring census calls
    // the dead hook alive. ⚠️ Re-pointed at D-016: `project-cwd-choose` and `new-project-cwd-choose`
    // were the two drawn hooks that contained `cwd-choose`, and both went with projects.
    expect(DRAWN.exact.has('agent-slug-folded')).toBe(true)
    expect(drawn('slug-folded'), 'a substring match is reporting a deleted hook as alive').toBe(
      false,
    )
    // …and a second plant, so a detector that refuses everything does not read as a working one.
    // 🔴 **`provider-select` stood here until `435` and it is DRAWN again** (HO-025 §5: *"the front
    // door asks nothing and OFFERS EVERYTHING"*), so it cannot be the dead example any more.
    // ⛔ **Re-pointed rather than deleted**: `profile-select` is what HO-023 §2 left deleted — a new
    // conversation is BroBot, and every other session is placed from the roster (`423`) — so it is a
    // hook that is genuinely gone and is expected to stay gone.
    expect(drawn('profile-select')).toBe(false)
    // ⚑ **And the one that came back — and went again — is asserted as such**, so this file
    // records the change rather than merely stopping to mention it: UI-012 (R-3) folded the
    // provider choice into the model picker.
    expect(drawn('provider-select'), 'UI-012 folded the provider choice into the picker').toBe(
      false,
    )
    expect(drawn('model-picker-face'), 'the model picker is what holds it now').toBe(true)
    expect(
      drawn('prompt-input'),
      'a hook that IS drawn must pass, or nothing above means anything',
    ).toBe(true)
  })

  it('⛔ a family admits its members and NOT its bare head', () => {
    // The one derivation both sides share. A head admitted as a member would make
    // `[data-cy^=open-session-]` self-justifying: the scan proves the family and the family
    // proves the scan.
    expect(drawn('open-session-sess_1')).toBe(true)
    expect(drawn('open-session-')).toBe(false)
    expect(drawn('drawer-tab-events')).toBe(true)
  })

  it('⛔ prose is stripped, and code is not — both directions', () => {
    const source = [
      `// the old read was [data-cy=compaction-entry], retired at 245`,
      ` * and \`SET_VALUE('profile-input', name)\` with it`,
      `await cdp.evaluate(CLICK('send-prompt'))`,
    ].join('\n')
    const { exact } = addressedBy(source)
    expect(exact).toEqual(['send-prompt'])
    // …and the stripper has not eaten the code: the same three lines uncommented yield all three.
    expect(addressedBy(source.replace(/^\/\/ |^ \* /gm, '')).exact.sort()).toEqual([
      'compaction-entry',
      'profile-input',
      'send-prompt',
    ])
  })

  it('⛔ a node-side ${…} hole is a BUILT name, and a hole after a head is a family', () => {
    // Measured at 345 with this substitution removed: 17 reports across three instruments, every
    // one of them wrong. ⛔ Three shapes, because the middle one is the one a placeholder of `x`
    // gets silently wrong.
    expect(addressedBy('document.querySelector(`[data-cy="${cy}"]`)')).toEqual({
      exact: [],
      scanned: [],
    })
    expect(addressedBy('document.querySelector(`[data-cy=open-session-${id}]`)')).toEqual({
      exact: [],
      scanned: ['open-session-'],
    })
    expect(addressedBy("document.querySelector('[data-cy=send-prompt]')")).toEqual({
      exact: ['send-prompt'],
      scanned: [],
    })
  })

  it('⛔ the renderer side strips prose too — the asymmetry that would report a dead hook alive', () => {
    // 🔴 **The `cwd-choose` class, from the other side.** A hook deleted from a template while a
    // docblock still quotes its declaration would read as drawn. Both directions, or the
    // stripper proves nothing: the declaration survives, the quotation does not.
    const planted = [
      '/** The old read was data-cy="a-hook-nobody-draws-any-more", retired at 245. */',
      '<!-- and one in a template comment: data-cy="another-hook-nobody-draws" -->',
      '// a line comment: data-cy="a-third-hook-nobody-draws"',
      '<div data-cy="a-hook-that-is-really-drawn" />',
    ].join('\n')
    const stripped = withoutProse(planted)
    expect(stripped).toContain('a-hook-that-is-really-drawn')
    for (const gone of [
      'a-hook-nobody-draws-any-more',
      'another-hook-nobody-draws',
      'a-third-hook-nobody-draws',
    ]) {
      expect(planted, `${gone} is not in the fixture — this control proves nothing`).toContain(gone)
      expect(stripped, `${gone} survived the stripper`).not.toContain(gone)
    }
  })

  it('⛔ …and a helper called on a connection that is not `cdp` is still seen', () => {
    // ⚠️ `ui-live-smoke.mjs` drives its own-instance steps through `ownCdp` / `secondCdp`. A
    // pattern spelled `cdp2?` left the first click of every one of those unguarded.
    expect(addressedBy(`await clickWhenReady(ownCdp, 'toggle-session-panel')`).exact).toEqual([
      'toggle-session-panel',
    ])
    expect(addressedBy(`await clickWhenReady(secondCdp, 'close-session')`).exact).toEqual([
      'close-session',
    ])
  })

  it('⛔ …and a hook a TAB helper presses is seen — the strip 583 put in front of the sheet', () => {
    // 🔴 **The arm `583` added, planted and found.** ⛔ Both call shapes, because the helper is
    // written with the connection first like `clickWhenReady` and a pattern that only matched a
    // bare `showToldTab('x')` would have covered none of the five real call sites.
    expect(addressedBy(`await showToldTab(cdp, 'told-tab-not-read')`).exact).toEqual([
      'told-tab-not-read',
    ])
    expect(addressedBy(`await showToldTab(ownCdp, 'told-tab-learned')`).exact).toEqual([
      'told-tab-learned',
    ])
    // …and the family those names belong to is one the renderer really draws, so the arm is
    // pointed at a live hook rather than at a spelling nothing would ever have.
    expect(DRAWN.families.has('told-tab-'), 'the sheet draws no tab family').toBe(true)
    expect(drawn('told-tab-not-read')).toBe(true)
    // ⚠️ **The negative control for the widening**: admitting a fourth helper must not admit
    // every call that happens to take a quoted first argument.
    expect(addressedBy(`await notAHookHelper(cdp, 'told-tab-learned')`).exact).toEqual([])
  })

  it('⛔ …and a hook a helper writes to is seen — which is the whole of what 417 broke', () => {
    // 🔴 The class `conversation-chrome.test.ts` could not see: not a click, a WRITE. Both helper
    // spellings, because `clickWhenReady` takes the connection first and `SET_VALUE` does not.
    expect(
      addressedBy(`await cdp2.evaluate(SET_VALUE('provider-select', provider))`).exact,
    ).toEqual(['provider-select'])
    expect(addressedBy(`await clickWhenReady(cdp, 'new-conversation')`).exact).toEqual([
      'new-conversation',
    ])
  })
})
