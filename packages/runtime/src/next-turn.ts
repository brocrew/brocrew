/**
 * A session setting the user can change mid-conversation, which takes effect **from the next turn**
 * (076, generalising 034).
 *
 * 034 established the shape for the approval mode and wrote down why the delay is the honest floor
 * rather than a limitation we could engineer away: neither provider can change what an in-flight
 * turn already decided, so between a user's click and their next message the session is RUNNING
 * under one value while another is QUEUED. Both values are real and a UI needs both — one to
 * disclose ("this conversation is asking about commands") and one to promise ("from your next
 * message it will not").
 *
 * 076 added three more settings with exactly that shape — model, reasoning effort and plan mode —
 * and the reason this is one class rather than four pairs of fields is that the *invariant* is what
 * matters, not the values. {@link adopt} is called once per turn, by the adapter, in the same step
 * that writes the turn; anything that read {@link effective} before that call and anything the
 * provider is told after it therefore agree by construction. Four hand-rolled copies of that would
 * be four chances for one of them to publish a value the provider was never told about.
 *
 * ⚠️ **`effective` is not "what the provider is running", it is "what the last turn we sent asked
 * for".** For a session that has never sent a turn the two are different: the launch value is what
 * the provider has, and it is what this is seeded with. Where a provider REPORTS its own value —
 * Codex does, Claude does not — that report is the fact and this is only our request. Nothing here
 * may be presented as a provider confirmation; see `AgentInfo.reasoningEffortReported`.
 */
export class NextTurnSetting<T> {
  protected _effective: T
  protected _requested: T

  constructor(initial: T) {
    this._effective = initial
    this._requested = initial
  }

  /** What the session is running under RIGHT NOW. Every disclosure is built from this one. */
  get effective(): T {
    return this._effective
  }

  /** What it will run under from its next turn. Equal to {@link effective} when nothing is pending. */
  get requested(): T {
    return this._requested
  }

  /**
   * True while a requested change has not been adopted yet — i.e. the UI owes the user a "from your
   * next message".
   *
   * ⚠️ **`undefined` compares equal to itself, which is what makes "nobody chose" a usable value**
   * — `ProviderRuntimeContext.model` preserves that state on purpose, so an untouched session must
   * never report a change as pending.
   *
   * `Object.is` rather than `!==` is a nicety and not a fix: for the `string | undefined` and
   * `boolean` settings this class is instantiated with the two are exactly equivalent
   * (`undefined !== undefined` is already `false`). It is used because this is a GENERIC over an
   * arbitrary `T`, and `Object.is` is the total equality — it does not surprise on `NaN`, which
   * `!==` would report as perpetually pending. Stated rather than implied, because a comment
   * claiming this was load-bearing for `undefined` would be a false one.
   */
  get pending(): boolean {
    return !Object.is(this._effective, this._requested)
  }

  /** Record what the user asked for. */
  request(value: T): void {
    this._requested = value
  }

  /**
   * Adopt the requested value as the effective one. Called at the START of a turn, by the adapter,
   * in the same step that sends the turn — so what the provider is told and what our own disclosures
   * claim can never disagree.
   */
  adopt(): T {
    this._effective = this._requested
    return this._effective
  }

  /**
   * Un-adopt: the turn that was going to carry the new value never started, so put
   * {@link effective} back to what it was before {@link adopt}.
   *
   * {@link adopt} runs BEFORE the turn is written, which is the safe direction while a turn is
   * genuinely in flight, but it is only tolerable because the overstatement self-corrects on the
   * NEXT turn. A `turn/start` that failed leaves no next turn to correct it, so the session would
   * keep claiming a value the provider was never told about.
   *
   * {@link requested} is deliberately untouched: the user still wants the change, and the turn they
   * send after the failure re-sends the whole set.
   */
  rollback(previous: T): void {
    this._effective = previous
  }

  /**
   * **The PROVIDER decided, not the user — so both projections move at once** (150).
   *
   * {@link request} + {@link adopt} is the user's path: they ask, and the next turn carries it. This
   * one is for a change that has ALREADY happened somewhere we do not own, and the distinction is
   * the whole reason it exists rather than being spelled as those two calls. Claude's plan mode ends
   * when the user answers the model's own `ExitPlanMode` card, inside the SDK; by the time we hear
   * about it the provider is already out. Recording that as "requested, effective from your next
   * turn" would leave {@link pending} true and have the UI promise a change that is in the past,
   * and leaving {@link requested} behind would make the very next {@link adopt} put it back.
   *
   * ⚠️ **So this is not a general setter and must not become one.** Every caller has to be able to
   * say what already moved underneath it. A user gesture that goes through here would skip the
   * turn boundary the rest of this class exists to hold.
   */
  settle(value: T): void {
    this._effective = value
    this._requested = value
  }
}
