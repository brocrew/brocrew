import type { ModelChoice, ReasoningEffort } from '../../src/shared/runtime-ipc'

/**
 * ⛔ **The corpus BOTH ends of "what this launch asks for" are checked against** (274 §3, from `272`
 * finding 2).
 *
 * ## The bug this exists to prevent
 *
 * The launcher showed one thing and sent another, and each end was tested alone and was right alone.
 * ⛔ **`417` deleted both browser readers** (HO-022 §2 removed the Fine-tune fold), and for three
 * dispatches this corpus had one end left: the main-side host test.
 *
 * ⚑ **`435` gave it a browser end again, and UI-012 took it away**: the model picker offers only the
 * drafted model's own levels (`model-lists.ts`' `theDraftEffort`), so there is no held rung left to
 * carry to a model without it. ⚠️ The columns that end read — the rung held, the option shown and
 * the sentence said — went with it; each row's `why` still says the launcher state it came from.
 *
 * The control's own tests asserted what the MENU offered (`dom/effort-menu.dom.test.ts`, `179`); the
 * header's asserted what a payload PRODUCES (`agent-rows.test.ts`, `179`). ⚠️ **Nothing carried a
 * launcher state through to the sentence it ends up printing**, so a launcher that offered nothing
 * and sent `medium` satisfied both suites at once — measured live: model `haiku`, the words *"there
 * is nothing to choose — this conversation will run with the provider's own setting"* on screen, and
 * `reasoningEffort: 'medium'` in the payload behind them.
 *
 * ⚑ **Same shape as `fixtures/profile-names.ts`** (169 §1): one list, read by a real-browser test of
 * the CONTROL (`dom/effort-asked.dom.test.ts`) and by a main-side test of the HOST
 * (`reasoning-asked.test.ts`) — with every verdict **written down here by hand** rather than
 * computed. A corpus that asked the launcher what it intends to send would agree with anything the
 * launcher came to believe.
 *
 * ⚠️ **`asks` is the load-bearing column and `undefined` is a real value in it**, not a gap: the
 * whole stack reads an ABSENT `reasoningEffort` as *"we asked for nothing, each provider keeps its
 * own default"*, which `runtime-ipc.ts` is explicit is **a different fact from choosing the middle
 * rung, and is reported differently**. That difference is the `header` column.
 */
export interface EffortLaunchCase {
  /** A short name for the state, used in the test titles. */
  name: string
  /** Why it is in the list — printed in the failure message. */
  why: string
  /**
   * What the provider answered about its models for this case.
   *
   * ⛔ **`null` is "nobody has answered", and it is NOT an edge case** — it is the state every
   * launcher mounts in, for as long as the model probe takes, and the state a launcher stays in
   * for a profile whose probe failed.
   */
  models: ModelChoice[] | null
  /** What is typed in the model box. */
  model: string
  /**
   * The rung this launch must ask for — **`undefined` means the field must be ABSENT from the
   * payload**, which is not the same as `''` and not the same as omitting this column.
   */
  asks: ReasoningEffort | undefined
  /** The reasoning row the header reads afterwards, before any provider has reported anything. */
  header: string
}

/**
 * Claude's catalogue as measured — `pnpm run probe:model-effort`, and re-measured live for `274`:
 * `opus` and `sonnet` report five levels each and **`haiku` reports no effort fields at all**. The
 * absent `efforts` key is the shape that matters and is why it is written out rather than `[]`.
 */
export const MEASURED_CLAUDE: ModelChoice[] = [
  {
    id: 'opus',
    label: 'Opus',
    efforts: [
      { id: 'low', label: 'low' },
      { id: 'medium', label: 'medium' },
      { id: 'high', label: 'high' },
      { id: 'xhigh', label: 'xhigh' },
      { id: 'max', label: 'max' },
    ],
  },
  { id: 'haiku', label: 'Haiku' },
]

export const EFFORT_LAUNCH_CASES: readonly EffortLaunchCase[] = [
  // ── nobody has answered: silence narrows nothing (179 §4), so the held rung stands — and shows ──
  {
    name: 'no catalogue, a rung held',
    why: 'every launcher mounts here; dropping the rung would make the launch depend on probe timing',
    models: null,
    model: '',
    asks: 'medium',
    header: 'medium (requested)',
  },
  {
    name: 'no catalogue, nothing held',
    why: 'the paired negative: with no rung held there is nothing to offer and nothing to ask for',
    models: null,
    model: '',
    asks: undefined,
    header: '…',
  },
  // ── the provider answered, and its answer is the authority ──
  {
    name: 'listed for this model',
    why: 'the paired positive: an ordinary launch is untouched by 274',
    models: MEASURED_CLAUDE,
    model: 'opus',
    asks: 'medium',
    header: 'medium (requested)',
  },
  {
    name: 'the model reports no levels',
    why: '🔴 272 finding 2, exactly: the control offered nothing and the launch asked for medium',
    models: MEASURED_CLAUDE,
    model: 'haiku',
    asks: undefined,
    header: '…',
  },
  {
    name: 'the model reports no levels, carrying a different rung',
    why: 'the same state reached from a rung nobody pre-selects — so this is not a fact about medium',
    models: MEASURED_CLAUDE,
    model: 'haiku',
    asks: undefined,
    header: '…',
  },
  {
    name: 'listed, but not this rung',
    why: 'measured live: `ultra` chosen on Codex and carried to Claude, where no row lists it',
    models: MEASURED_CLAUDE,
    model: 'opus',
    asks: undefined,
    header: '…',
  },
  {
    name: 'not this rung, and the box names an id the catalogue never mentioned',
    why: 'the POOLED path: naming this model in the sentence would attribute a catalogue-wide absence to a row the provider never described (177 §4)',
    models: MEASURED_CLAUDE,
    model: 'claude-sonnet-4-5',
    asks: undefined,
    header: '…',
  },
  {
    name: 'provider default, chosen on purpose',
    why: 'the discriminating case: the same screen as a held-back rung, and NOTHING is said about it',
    models: MEASURED_CLAUDE,
    model: 'opus',
    asks: undefined,
    header: '…',
  },
]
