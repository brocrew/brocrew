import type { Provider } from '@brobot2/shared'
import { NextTurnSetting } from './next-turn'
import type { ApprovalMode } from './runtime'

/**
 * What a session prompts for, and what it will prompt for next (034).
 *
 * Both providers apply approval mode at conversation launch. A requested mid-conversation change is supported, but takes effect at a later turn boundary:
 *
 *  - **Codex** takes `approvalPolicy`/`sandboxPolicy` on `turn/start`, documented as "for this turn
 *    and subsequent turns". Measured (034 probe, live app-server): a `thread/settings/update` sent
 *    MID-TURN is accepted, echoes back a `thread/settings/updated` with the new profile — and the
 *    very next command in the SAME turn still prompted. The following turn did not. The reverse
 *    direction behaves identically. The in-flight turn keeps the profile it started with, full stop.
 *  - **Claude** — 🔴 **OURS, chosen, and this bullet said otherwise for two dispatches**
 *    (499 §3.2). It read *"Claude bakes the mode into the `Options` of a query that lives for the
 *    whole session: `permissionMode`, `allowDangerouslySkipPermissions`, and the PreToolUse guard
 *    hooks are all fixed when the query is built"* — true when `034` wrote it, and **every one of
 *    those three clauses has since stopped being true**. ⛔ `076`/`140` dropped
 *    `bypassPermissions` from the launch, so `permissionModeFor` carries the PLAN bit and nothing
 *    else; `allowDangerouslySkipPermissions` is now assigned nowhere in `src/`; and `050` made the
 *    guard hooks unconditional and mode-READING — `promptGuardHooks` is handed
 *    `() => handle.approval.effective` and consults it per tool call, as does
 *    `ClaudeSessionHandle.handleCanUseTool`. ⚡ **So nothing on Claude captures the mode at turn
 *    start, and an immediately-adopted change would be picked up by the running turn's very next
 *    tool call.** ⛔ The delay on Claude is this class, deliberately — exactly as
 *    `runtime.ts`'s `setModel` note already says of its own sibling setting — **and the reason is
 *    the one below, not a provider limit.**
 *
 * So the contract is the same on both — ⛑ on Codex because the provider says so, on Claude because
 * we hold it there — and it is the honest floor rather than the best either could manage: **a change
 * applies from the next turn.** A control that meant "now" on one provider and "soon" on the other
 * would be a control that lies half the time — and the dangerous direction is the one that would
 * lie. {@link effective} is what the session is ACTUALLY running under and is what every disclosure
 * must be built from; {@link requested} is what the user asked for.
 *
 * Turning yolo OFF is subject to the same delay, which is worth stating plainly rather than
 * special-casing: the in-flight turn cannot be re-sandboxed, and the honest way to stop it now is to
 * interrupt it.
 *
 * ⚠️ **The next-turn machinery now lives in {@link NextTurnSetting} and this class is the one
 * SUBCLASS that narrows it** (076). Three more settings grew this exact shape — model, effort, plan
 * mode — and four hand-rolled copies of "effective vs requested, adopted at the turn boundary" would
 * have been four chances for one of them to drift. What survives here is the only thing genuinely
 * specific to approvals, and it is the safety-critical half: {@link request} coerces by exact match,
 * so the dangerous value is reachable only by asking for it by name. A generic setting must NOT do
 * that — "nobody chose a model" is a value the other three preserve deliberately — which is exactly
 * why the coercion is an override here rather than a parameter there.
 */
export class ApprovalModeSwitch extends NextTurnSetting<ApprovalMode> {
  /** Absent resolves to `'ask'` — the same fail-safe direction as {@link isAutoApprove}. */
  constructor(initial: ApprovalMode | undefined) {
    super(initial === 'auto' ? 'auto' : 'ask')
  }

  /** Record what the user asked for. Exact-match opt-in (078): only `'auto'` turns approvals off. */
  override request(mode: ApprovalMode): void {
    super.request(mode === 'auto' ? 'auto' : 'ask')
  }
}

/** The pair, as the app and the UI see it. */
export interface ApprovalModeState {
  /** What the session is running under right now. */
  effective: ApprovalMode
  /** What it will run under from its next turn — the same value unless a change is pending. */
  requested: ApprovalMode
}

/**
 * 🔴 **D-038 · what stands between an act PAST a conversation's folder and that act running with
 * nobody asked** — per provider and mode, read off the adapters (F050).
 *
 * ## ⛔ The question this exists to answer, and why it is a table and not the mode's NAME
 *
 * Compare protections left in place rather than protections removed from each provider's baseline. Claude auto and Codex auto have the same reach even though only Codex removes a sandbox; a cross-provider give must not be refused merely because their baselines differ.
 *
 * ⚠️ **Today its verdicts are the ones a comparison of the two WORDS would give** — refused exactly
 * when an `ask` giver would start an `auto` conversation — and that agreement is a fact about the
 * adapters, not about the words: `ask` keeps something past its folder on both providers and `auto`
 * nothing on either, which is what this table says and a test binds.
 *
 * ⛔ **It is not ready for a third mode.** It models no read, and no Codex sandbox confines one
 * (`366`), so a mode that kept a sandbox and no card — the third mode the roadmap writes down —
 * would keep something here, and {@link whatTheChildWouldLack} would give it to an `ask` giver,
 * though the roadmap (§11) says that mode must never be reached for to let a spawned session run
 * without prompts. ⚠️ Such a mode owes a ruling on that rule before it owes a row in this table.
 *
 * ## ⚑ What each posture keeps past its folder, from the adapters
 *
 * *Past its folder*: a write outside its folder and the temporary folders, or a command that
 * reaches the network or that a sandbox refuses. ⚠️ **Not a read, and not an external server's
 * tool** — the ⏸ section says what each `ask` does with those.
 *
 *  - **Claude `ask`: the card.** `permissionModeFor` asks for `'default'` and never
 *    `bypassPermissions`, so the CLI's own engine decides each call: it asks before a write, an
 *    `rm`, a `WebFetch` and every server tool (`728`), and what it asks about reaches
 *    `handleCanUseTool`'s card. There is no sandbox in either mode.
 *  - **Claude `auto`: nothing.** `handleCanUseTool` allows whatever the CLI asks about on
 *    `isAutoApprove` — except while planning, which is a conversation's state and not a posture it
 *    hands down.
 *  - **Codex `ask`: the card AND a sandbox.** `APPROVAL_PROFILES.ask` sends `on-request` and
 *    `workspace-write` (since `736`, R96) on `thread/start`, `thread/resume` and every
 *    `turn/start`: Seatbelt refuses a write or a command past the folder unless a person approves
 *    stepping out.
 *  - **Codex `auto`: nothing.** `never` and `danger-full-access`, which applies no sandbox at all.
 *
 * ⚑ **The two notes a person reads beside the yolo control say the same** (`367`): *"On Claude
 * nothing is sandboxed in either mode. What this mode removes is the card"*, and *"On Codex this mode
 * takes the sandbox off"*.
 *
 * ## ⏸ What it does not compare, and why that is a ruling's to change
 *
 * ⚠️ **Where the two `ask`s differ, Codex `ask` acts with nobody asked.**
 *
 *  - **In its folder** it writes and runs commands with no card, inside its sandbox; Claude `ask`
 *    asks before a write and before a command its CLI cannot tell is harmless.
 *  - **Outside its folder** it reads with no card, and no Codex sandbox confines a read (`366`);
 *    Claude `ask` asks before that read (`721`).
 *  - **A server's tool its server marks read-only**, or destroying nothing and reaching nothing
 *    outside, runs with no card (`723`) and no sandbox: the server is declared by its URL and runs
 *    in its own process. Claude `ask` asks before every server tool (`728`).
 *  - **An identity's `config.toml`** may widen Codex's sandbox.
 *
 * So a Claude `ask` giver's Codex `ask` helper is literally wider in reach, and it is given, as it
 * was before D-038: ⛔ **a new refusal is a ruling's, never a table's** (D-038 R1), and that pair is
 * held for one (F-A).
 *
 * ## ⚑ One table, read twice
 *
 * 🔴 **The rail reads it as reach** ({@link whatTheChildWouldLack}). **The disclosure reads it as
 * what `auto` takes off its own provider's `ask`** — this table's `ask` row less its `auto` row: the
 * card on Claude, the card and the sandbox on Codex — which is what `YOLO_MEANS_FOR_AGENTS_IT_STARTS`
 * and the two notes say. `a-mode-a-child-inherits.test.ts` holds the rail's reading at the door and
 * censuses the disclosure's against the prose in both directions, so neither can drift alone.
 *
 * ## ⛔ Why it lives here and is bound by a TEST rather than imported from the adapters
 *
 * ⚠️ **`codex-runtime.ts` imports {@link ApprovalModeSwitch} from this file**, so deriving the
 * Codex row from `APPROVAL_PROFILES` at runtime would be a cycle. ⚑ **The binding is therefore a
 * test that imports both** — `APPROVAL_PROFILES` is exported for exactly that reader and for no
 * other — and it asserts, per mode, that the card is in the Codex row **iff** that profile's
 * `approvalPolicy` is not `never`, and the sandbox **iff** its `sandbox` is not
 * `danger-full-access`. ⛔ **A census over a docblock would not have done**: the Codex row is
 * derived from a VALUE, and the Claude row is a negative whose search shape is stated in the test.
 *
 * ## 🔴 It is TOTAL, and the type is what makes it so
 *
 * ⛔ **`Record<Provider, Record<ApprovalMode, …>>`, never a loop over a literal variant list.** A
 * third provider or a third mode is a compile error here, at the one place that decides whether a
 * child may inherit — which is the point of `a-loop-over-a-literal-variant-list-is-not-exhaustive`
 * and the reason {@link whatTheChildWouldLack} takes a provider it cannot default.
 */
export const PROTECTIONS = [
  /**
   * ⛔ **A person approves before a consequential act runs.** On Claude it is the CLI's own engine
   * asking and `handleCanUseTool`'s card; on Codex it is `approvalPolicy: 'on-request'` on the wire.
   */
  'the-card-before-an-act',
  /**
   * ⛔ **An OS confinement around what it runs.** Codex `ask` only, and it is real rather than
   * nominal: `160` measured `ps` and `top` exiting 0 under `dangerFullAccess` where any Seatbelt
   * policy refuses them. ⚠️ **Claude has none in either mode** — see this file's table.
   */
  'the-sandbox-around-an-act',
] as const

export type Protection = (typeof PROTECTIONS)[number]

/** A conversation's approval posture: the mode, and the provider that decides what the mode means. */
export interface ApprovalPosture {
  readonly provider: Provider
  readonly approvalMode: ApprovalMode
}

/**
 * ⛔ **What each (provider, mode) keeps between an act past its folder and that act running with
 * nobody asked.** ⚠️ **Absolute, and that is the point**: two conversations are compared on what
 * each really has, never on what each mode took off its own provider's `ask`.
 */
export const WHAT_STANDS_PAST_ITS_FOLDER: Readonly<
  Record<Provider, Readonly<Record<ApprovalMode, readonly Protection[]>>>
> = {
  claude: { ask: ['the-card-before-an-act'], auto: [] },
  codex: { ask: ['the-card-before-an-act', 'the-sandbox-around-an-act'], auto: [] },
}

/**
 * 🔴 **What the giver keeps past its folder that the child would not** — the empty array is *no
 * wider*, and every other answer names what the giver still has (`HO-036`'s *never wider than it*,
 * decided ONCE).
 *
 * ⛔ **Any against none, and not a set difference**, because that keeps every give that passed
 * before D-038 passing (D-038 R1): a child is wider only when it keeps NOTHING past its folder and
 * its giver keeps something. ⚠️ A set difference would refuse a Codex `ask` giver its Claude `ask`
 * helper for the missing sandbox, although that helper is asked before everything the sandbox
 * stopped; that pair was given before D-038, and a new refusal is a ruling's (F-D).
 *
 * 🔴 **It does not hold the sandbox to be worth the card.** Today the two never come apart —
 * whatever keeps the sandbox keeps the card too — but a posture that kept the sandbox alone would
 * pass here under an `ask` giver, and the roadmap forbids that give: see this file's table.
 *
 * ⚑ **Ordered by {@link PROTECTIONS}**, so the refusal's detail reads the same whatever order the
 * table's rows are written in.
 */
export function whatTheChildWouldLack(
  child: ApprovalPosture,
  parent: ApprovalPosture,
): readonly Protection[] {
  const keeps = ({ provider, approvalMode }: ApprovalPosture): readonly Protection[] =>
    WHAT_STANDS_PAST_ITS_FOLDER[provider][approvalMode]
  if (keeps(child).length > 0) return []
  const kept = keeps(parent)
  return PROTECTIONS.filter((one) => kept.includes(one))
}
