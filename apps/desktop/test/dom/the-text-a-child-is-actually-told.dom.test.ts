import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import type { SessionInstructions } from '../../src/shared/runtime-ipc'
import { mount, toldProps, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **377 · what a PERSON sees of the text a child was told.**
 *
 * ⛔ **In the DOM project, because none of this can be asked of a string.** The main-process suite
 * asks what the compiler produces and what the publisher refuses; only a real engine can answer
 * whether the refusal reaches a screen — which is the half HO-016 named: *"the refusal is SURFACED
 * TO A PERSON, not only logged."*
 *
 * ⚠️ **`renderer/` tests are SSR-only and pass vacuously**, so every negative here is paired with a
 * positive drawn from the same mount.
 *
 * ## 🔴 583 · re-aimed, because the sheet became a TAB STRIP — every claim below survives the move
 *
 * Only one owner tab is in the DOM. `profile-instructions` and `profile-memory` are on
 * `factory` and `learned`; `repository-conventions` is on `the-place`; refusal content has a
 * conditional `not-read` tab. Each test reaches its subject through {@link press} and proves
 * selection, preventing an empty landing-tab query from passing vacuously.
 *
 * ⚑ **The per-kind hooks are gone.** `injected-<kind>` is retired; every row is `told-block`
 * carrying `data-kind` and `data-whose`, and the provenance sentence that used to sit in `.meta`
 * text at rest now lives behind the row's own press, in `told-block-label` — 163's rule that the
 * attribute is the answer and the word is for the person. ⛔ **So a claim about what a row SAYS
 * now opens the row first**, and a claim about which tab a row is under reads `data-whose` rather
 * than parsing a heading.
 */

afterEach(unmountAll)

const EMPTY: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: false,
  composed: null,
}

/**
 * ⚑ **The block on its own since `527`, rather than the whole drawer on the Info tab.** It
 * emitted `<dt>`/`<dd>` fragments into `SessionInfo`'s `<dl>` until this dispatch and had no root
 * of its own to mount — `525`'s named refactor cost, paid by `HO-050` §1.1's split.
 */
function openInfo(over: Partial<SessionInstructions>): Mounted {
  return mount(AgentInstructionsSheet as never, toldProps({ ...EMPTY, ...over }), { width: 760 })
}

/**
 * 🔴 **Press one tab, and prove the strip took the press** (583).
 *
 * ⛔ **The `aria-selected` assertion is not decoration.** Only one tab's panel is in the DOM, so
 * every query after this call is conditional on the press having landed; a click on a button that
 * had stopped being a tab would leave the next `querySelector` returning `null` and the failure
 * would read as *the hook is gone* rather than *the strip is broken*.
 */
async function press(m: Mounted, key: string): Promise<void> {
  const tab = m.q(`told-tab-${key}`)
  tab.click()
  await nextTick()
  expect(tab.getAttribute('aria-selected'), `the ${key} tab did not take the press`).toBe('true')
}

/**
 * One `told-block` of the given kind, on whichever tab is currently on screen — asserted
 * singular, so a row drawn twice fails here instead of quietly satisfying the first
 * `querySelector` (`an-assertion-can-be-satisfied-by-a-neighbouring-element`).
 */
function block(host: HTMLElement, kind: string): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>('[data-cy="told-block"]')].filter(
    (el) => el.dataset.kind === kind,
  )
  expect(found.length, `exactly one told-block of kind ${kind} on the tab on screen`).toBe(1)
  return found[0]!
}

/** Open one block. The path, the `told-block-label` provenance and the paper are all behind this. */
async function openBlock(el: HTMLElement): Promise<void> {
  el.querySelector<HTMLButtonElement>('[data-cy="told-block-toggle"]')!.click()
  await nextTick()
}

const within = (el: HTMLElement, cy: string): HTMLElement | null =>
  el.querySelector<HTMLElement>(`[data-cy="${cy}"]`)

/** The compiled bundle's own text, shared between the fixture and the section that tiles it. */
const PROFILE_TEXT = '# Your instructions\n\n- Put the files you create in your working directory.'

describe('§1 · the app’s own instructions are a row of their own', () => {
  const rows: SessionInstructions['injected'] = [
    {
      kind: 'profile-instructions',
      path: '/homes/claude/brobot-instructions.md',
      // ⚑ **`497` · a real common rule, not the withdrawn one.** This is a SAMPLE of the leaf the
      // app publishes, and it quoted *"Never merge, and never modify production"* — a sentence
      // HO-035 withdrew. Nothing here asserts the text, so the swap costs the test nothing; what a
      // fixture quoting a retired sentence costs is the next reader who greps for it.
      text: PROFILE_TEXT,
      bytes: 64,
      truncated: false,
      // 🔴 **583 · the bundle carries a MAP now** (`InjectedInstruction.sections`), and without one
      // this row would draw whole under `told-unsplit` rather than under an owner's tab — `438`'s
      // fail-closed path, not the split one this test is about. ⛔ **One section, covering the
      // whole file**, tagged `factory`: the sample rule inside it ("work inside your working
      // directory") is exactly what `HO-009` §2 calls factory — shipped with the app, editable by
      // nobody here. The offsets tile `text` exactly, which `whose-text-is-this.test.ts` holds as
      // the shared contract this fixture leans on.
      sections: [{ whose: 'factory', heading: null, start: 0, end: PROFILE_TEXT.length }],
    },
    {
      kind: 'profile-memory',
      path: '/homes/claude/CLAUDE.md',
      text: '# What I have learned',
      bytes: 21,
      truncated: false,
    },
  ]

  it('🔴 draws both, and the two are told apart in words rather than by their paths', async () => {
    // ⛔ **086's rule at its sharpest.** The two files are one directory apart with opposite owners:
    // the APP overwrites the first every launch and the AGENT writes the second. A person who read
    // them as one thing would put a durable rule in the file that is about to be regenerated over it.
    //
    // ⚑ **583 · the two rows are two OWNERS now, not two rows of one panel.** `WHOSE_FILE` sends
    // `profile-instructions`'s one section to `factory` and `profile-memory` to `learned` (`HO-009`
    // §2's opposite-owner pair, read back as two tabs); the provenance words this test used to find
    // at rest, in `.meta`, are behind each row's own press now, in `told-block-label` (163's rule).
    // ⛔ **So "told apart in words" is now a claim about two PRESSES**, one per owner, and it is the
    // stronger form of the same claim: a person cannot even see the two rows without choosing which
    // owner's tab to open, which is 086's distinction drawn as a control rather than as a sentence.
    const m = openInfo({ injected: rows })

    await press(m, 'factory')
    const instructions = block(m.host, 'profile-instructions')
    expect(instructions.dataset.whose).toBe('factory')
    await openBlock(instructions)
    expect(within(instructions, 'told-block-label')?.textContent).toContain(
      'profile instructions — written by BroCrew at this launch',
    )

    await press(m, 'learned')
    const memory = block(m.host, 'profile-memory')
    expect(memory.dataset.whose).toBe('learned')
    await openBlock(memory)
    expect(within(memory, 'told-block-label')?.textContent).toContain('profile memory')
  })

  it('⚠️ …and its own row names no provider, which is this panel’s standing rule', async () => {
    // `317`: no string a user reads on this panel names Claude or Codex. The source census in
    // `disclosure-answers-to-the-code.test.ts` is the enforcement; this is the same claim about
    // what a mount actually paints, so a name arriving through an interpolated value is caught too.
    //
    // ⚑ **583 · the labels are spread across three tabs and gated behind a press.** `.meta` is
    // gone — the provenance sentence moved into `told-block-label`, drawn only once a `told-block`
    // is opened — and the refusal sentence lives on its own `not-read` tab. ⛔ **So the sweep now
    // presses each tab the two rows and the refusal landed on, opens every block it finds, and
    // reads the same two classes the words always lived in** (`.label`, `.refused`) — never `.path`,
    // which is the one place a name legitimately appears, unchanged from before.
    const m = openInfo({
      injected: rows,
      // ⚑ A path that names a provider is the one place a name legitimately appears — it is the
      // user's own directory — so the assertion is about the LABELS beside it.
      refused: [{ path: '/homes/codex/AGENTS.override.md', reason: 'unmanaged-override' }],
    })
    const said: string[] = []
    for (const key of ['factory', 'learned', 'not-read']) {
      await press(m, key)
      for (const toggle of m.all('told-block-toggle')) {
        toggle.click()
        await nextTick()
      }
      for (const el of m.host.querySelectorAll<HTMLElement>('.label, .refused')) {
        said.push(el.textContent ?? '')
      }
    }
    const labels = said.join(' ')
    expect(labels.toLowerCase()).not.toMatch(/\bclaude\b|\bcodex\b/)
    // The pair: the labels really were read, and they say something.
    expect(labels).toContain('written by BroCrew at this launch')
  })
})

describe('§2 · the refusal a person has to be able to act on', () => {
  it('🔴 an override BroBot did not write draws a row that says what to DO about it', async () => {
    // ⛔ **HO-016:** *"Someone put that file there on purpose; the app disagreeing with them
    // silently is the failure mode."* ⚠️ So the sentence carries three things: whose file won, what
    // the agent therefore did not get, and the gesture that changes it.
    //
    // ⚑ **583 · the row moved to its own `not-read` tab** — {@link press} names it before the row
    // is asked for anything, which is the address rather than a shorter assertion.
    const m = openInfo({
      refused: [{ path: '/homes/codex/AGENTS.override.md', reason: 'unmanaged-override' }],
    })
    await press(m, 'not-read')
    const row = m.q('refused-instruction')
    const said = row.textContent ?? ''
    expect(said).toContain('/homes/codex/AGENTS.override.md')
    expect(said).toContain('not written by BroCrew')
    expect(said).toContain('the agent did not get them')
    expect(said).toMatch(/Move or rename it/)
    // ⛔ **Not "not read: unmanaged-override".** The fall-through wording is honest for a reason
    // nobody has written a sentence for yet; this one has a sentence, and shipping the raw word
    // would be the silence the row exists to remove.
    expect(said).not.toContain('not read: unmanaged-override')
  })

  it('⛔ …and a launch that published cleanly draws no such row — the paired negative', () => {
    // ⚑ **583 · the absence moved from a row inside one panel to a TAB that is never built.** With
    // nothing refused, `tabs` never pushes `not-read` at all (`SessionInstructions.vue`'s own
    // guard: `if (props.instructions.refused.length > 0)`), so the stronger form of this claim is
    // that the tab itself does not exist — asserted first, before the row it would have carried.
    const m = openInfo({
      injected: [
        {
          kind: 'profile-instructions',
          path: '/homes/codex/AGENTS.override.md',
          text: '# Your instructions',
          bytes: 19,
          truncated: false,
        },
      ],
    })
    expect(m.host.querySelector('[data-cy="told-tab-not-read"]')).toBeNull()
    expect(m.host.querySelector('[data-cy="refused-instruction"]')).toBeNull()
    // ⛔ **The positive beside it is a READING, not a mount** (`556`, and its rail in
    // `a-mount-is-not-a-reading.test.ts` went red on the first draft of this very line). ⚠️ A
    // `not.toBeNull()` on the panel says the component rendered; it does not say this fixture's
    // own file reached the screen, which is the only thing that makes the absence above a
    // measurement rather than an empty mount.
    // ⚑ This fixture's bundle arrives with no `sections` map, so it is drawn by the fail-closed
    // path — whole, in no group, saying so. That IS the reading: the file reached the screen.
    expect(m.q('told-unsplit').textContent).toContain('AGENTS.override.md')
    expect(m.q('told-unsplit').textContent).toContain('did not get a map of this file')
  })
})

describe('§3 · the repository file both engines share', () => {
  it('⚠️ is named as shared, not as one engine’s', async () => {
    // The sample-api fixture has AGENTS.md but no CLAUDE.md. Describe its conventions
    // as shared by both engines, rather than implying a Claude-only source.
    //
    // ⚑ **583 · `repository-conventions` is `the-place`'s** (`HO-009` §3: *"the cwd hierarchy…
    // belongs to the place, not the agent"*) — a tab away from the landing tab, and the label this
    // test looks for is behind the row's own press now rather than at rest.
    const m = openInfo({
      injected: [
        {
          kind: 'repository-conventions',
          path: '/work/sample-api/AGENTS.md',
          text: '# Conventions\n\nConventional commits.',
          bytes: 36,
          truncated: false,
        },
      ],
    })
    await press(m, 'the-place')
    const conventions = block(m.host, 'repository-conventions')
    expect(conventions.dataset.whose).toBe('the-place')
    await openBlock(conventions)
    const said = conventions.textContent ?? ''
    expect(said).toContain('repository conventions — the file both engines share')
    expect(said).toContain('/work/sample-api/AGENTS.md')
  })
})
