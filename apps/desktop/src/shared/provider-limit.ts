import type { Provider } from '@brobot2/shared'
import { MAX_INSTANT } from './clock'
import { PROVIDER_NAME } from './runtime-ipc'

/**
 * 🔴 **A provider wall, read back out of the ledger and said as a consequence** (533, HO-052 §4).
 *
 * ## Preserve observed provider-limit conditions
 *
 * ⚠️ **Two real test runs, two days, both providers, and he saw neither:**
 *
 * | run | the event, verbatim, non-fatal | occurrences |
 * |---|---|---:|
 * | 2026-09-17 | `codex is approaching its rate limit — 99% of a 7-day window used; resets 2026-09-20T21:10:56.000Z` | 2 |
 * | 2026-09-18 | `claude is approaching its rate limit (seven_day); resets 2026-09-23T11:00:00.000Z` | 5 |
 *
 * ⛔ **Both providers hit a weekly wall inside two days of real use and the only place it was
 * recorded was a non-fatal `error` row in a transcript nobody was reading.** 🔴 The PO's ruling:
 * *"A provider limit that will stop his agents working is not a ledger event. It belongs where
 * everything else that needs him belongs — the queue."*
 *
 * ## ⚑ This module RECOGNISES and FOLDS. It does not measure.
 *
 * ⛔ **`normalize.ts` in both adapters already composes these sentences and they are the
 * providers' own facts** — a percentage against a window on Codex, a window name on Claude — and
 * `533` §3 puts both of those files out of bounds. ⚠️ **So nothing here re-derives a limit**: it
 * reads the line the adapter wrote, takes out the three facts a person needs (which provider, which
 * window, when it comes back), and says the consequence.
 *
 * 🔴 **The coupling is real and it is PINNED rather than hoped for.** A reword in either
 * `normalize.ts` would make {@link readProviderLimit} answer `null` for ever, silently — the exact
 * shape standing rule 27 names, *an instrument that can go quiet without saying so*. ⚑
 * `a-wall-he-finds-out-about.test.ts` §2 reads every rate-limit string literal out of both adapters,
 * renders their interpolations with a probe and requires this function to recognise each one, which
 * is `provider-error.test.ts`'s own device for `turn failed` one subject over.
 *
 * ## 🔴 A wall ENDS two ways, and until `586` this module knew only one of them
 *
 * Reading only errors leaves old walls standing until their reset or the lookback expires, even after successful work. Include successful provider activity so the UI does not keep claiming that work has stopped.
 *
 * > ⚑ **`HO-080` §1:** *"A successful turn on a provider retracts that provider's walls."*
 *
 * 🔴 **So {@link foldProviderLimits} takes a second list** — see {@link ProviderTakingWork} and
 * {@link retractedBy} for which records count and which walls they may end. ⛔ **The PO's argument
 * is an ASYMMETRY**: clearing too eagerly costs one refused turn and corrects itself, and clearing
 * too timidly states something false indefinitely.
 *
 * ## ⚠️ What it may NOT say
 *
 * ⛔ **`stopped` is only ever the PROVIDER's own word.** Claude says it when `rate_limit_info.status`
 * is `rejected`; Codex says it when the snapshot carries a `rateLimitReachedType` or
 * `spendControlReached`. ⚑ **A percentage never produces it** — 99% of a window is *about to stop*
 * and nothing else. 🔴 A sentence claiming work HAS stopped when it has not is `030`/`029`'s defect
 * with the subject changed, and {@link PROVIDER_LIMIT_SAYS} is the only place either word is
 * written.
 */

/**
 * 🔴 **How far back the read looks for a wall, ms** (533) — one month.
 *
 * ## ⛔ Derived from the windows both providers were measured reporting, not chosen
 *
 * An observation older than its reported reset window describes an expired wall, which {@link foldProviderLimits} drops. The observed maximum window is seven days; a month-wide lookback leaves headroom for longer reported windows.
 *
 * 🔴 **It is a bound on the SCAN and not a claim about a wall.** What decides whether a wall still
 * stands is its own reset; this decides how much of the database the five-second poll touches, and
 * without it the read is the whole `events` table — which is the cost the three partial indexes
 * beside `events_error_idx` exist to refuse.
 *
 * ⛔ **`WALK_COVERS['every-provider-wall-recently-recorded']` says *"the last month"* in words**, and
 * the two are pinned against each other rather than derived from one another: `questions.ts` cannot
 * import this module without a value cycle through `runtime-ipc.ts`.
 */
export const PROVIDER_WALL_LOOKBACK_MS = 31 * 24 * 60 * 60 * 1000

/**
 * ⛔ **How much of a person's work this wall has taken** — two words, and the provider chooses
 * which by what it reported rather than this app by a threshold.
 */
export type LimitStanding =
  /**
   * ⚠️ **The window is nearly spent and the provider is still answering** — Claude's
   * `allowed_warning`, Codex's *"N% of a window used"* past its own 90% floor, ⚑ and (F096) the
   * provider's own usage figure for a window at or past {@link USAGE_NEARS_ITS_LIMIT_AT}
   * ({@link wallsFromUsage}): the person asked to hear of it there. ⛔ Never `stopped`.
   */
  | 'about-to-stop'
  /**
   * 🔴 **The provider itself reported the wall** — Claude's `rejected`, Codex's
   * `rateLimitReachedType` or `spendControlReached`. ⛔ Never inferred from a number.
   */
  | 'stopped'

/**
 * 🔴 **One wall, as this app recorded a provider reporting it.**
 *
 * ⚠️ **It crosses the wire** — see `RuntimeBridge.limitsForAPerson` — so every field is a primitive
 * and there is nothing on it a window could not have been told twice.
 */
export interface ProviderLimitSeen {
  /** Which provider walled — read off the provider's own sentence, which opens with its name. */
  readonly provider: Provider
  /**
   * ⛔ **Which metered window, as a FOLD KEY and never as a word a person reads.**
   *
   * ⚠️ **The two providers spell it differently and neither spelling is ours to translate**:
   * Claude names a `rateLimitType` (`seven_day`), Codex names a duration (*"a 7-day window"*) and
   * may name its bucket (*"on the GPT-5.3-Codex-Spark limit"*). ⛔ Inventing a third vocabulary to
   * print would be exactly the re-measuring `533` §3 forbids, so this is opaque: it decides what is
   * ONE wall and the provider's own line is what a person reads underneath.
   */
  readonly window: string
  /** See {@link LimitStanding} — the provider's word, never a threshold of ours. */
  readonly standing: LimitStanding
  /**
   * ⛔ **When the window resets, epoch ms, or `null` because the provider did not say.**
   *
   * ⚑ **`null` is reported rather than guessed** (`086`): *"nothing said when it comes back"* is a
   * true sentence and *"it comes back in an hour"* over an absent field is the kind of reassurance
   * this project has already paid for once.
   */
  readonly resetsAt: number | null
  /** ⛔ **The provider's own line, verbatim** — the quiet half, so nothing is paraphrased away. */
  readonly said: string
  /** When this app recorded the row. Newest wins the fold; see {@link foldProviderLimits}. */
  readonly at: number
}

/**
 * ⛔ **The consequence, and it is the whole of what the PO ruled on** (533 §1.1).
 *
 * > ⚠️ ***approaching the seven-day limit, resets on the 23rd*** **is a fact.**
 * > ⚑ ***work on this provider will stop and here is when it comes back*** **is the sentence a
 * > person can act on.**
 *
 * 🔴 **Third time that instruction has been given** — it produced `quit:check`'s verdict word and
 * `529`'s tab name — so the pattern is followed rather than re-invented: **the clause a person acts
 * on comes first and the measurement is not in the sentence at all.** ⛔ The window, the percentage
 * and the provider's own phrasing are underneath, in {@link ProviderLimitSeen.said}.
 */
export const PROVIDER_LIMIT_SAYS: Readonly<Record<LimitStanding, string>> = {
  'about-to-stop': 'is about to stop',
  stopped: 'has stopped',
}

/**
 * ⚠️ **Which standing outranks which** — `stopped` is the stronger claim and the one a person acts
 * on. See {@link foldProviderLimits} on why a provider never says both at once.
 */
const STANDING_RANK: Readonly<Record<LimitStanding, number>> = { stopped: 0, 'about-to-stop': 1 }

/**
 * 🔴 **The three phrases either adapter composes, and what each one means.**
 *
 * ⛔ **What is load-bearing is the ANCHOR, not the order of this list.** Each phrase is matched as
 * a PREFIX of what follows the provider's own name, and the three are mutually exclusive there, so
 * reordering them changes nothing. ⚠️ **A looser match would be a different function**: Codex's wall
 * line is `codex is rate-limited (weekly) on the X limit — …` and its approach line is
 * `codex is approaching its rate limit — 99% of …`, and under `includes` a sentence like
 * *"claude reported that codex is rate-limited (weekly)"* would be read as a wall on the wrong
 * provider. ⛔ The prefix anchor is what makes the wall belong to the name that opens the line.
 *
 * ## ⚑ Exported, because the DATABASE reads it too
 *
 * ⛔ **`SessionStore.providerLimitsSeen` builds its `payload LIKE` prefilter out of this array.**
 * ⚠️ **One list and not a second spelling in SQL**: a filter written by hand beside a recogniser is
 * free to drift from it, and it would drift in the direction nobody can see —
 * `a-filter-can-blind-the-instrument-that-justifies-it`. 🔴 The prefilter decides only which rows
 * are worth parsing; {@link readProviderLimit} still decides what a wall is.
 */
export const PHRASES: readonly { readonly phrase: string; readonly standing: LimitStanding }[] = [
  // ⛔ **Claude's `rejected` and Codex's `rateLimitReachedType`, which share a spelling.**
  { phrase: 'is rate-limited', standing: 'stopped' },
  // ⚑ **Codex only, and it is a wall by the same measure**: the provider stopped answering and
  // named when it will start again. A person whose agents stop does not care which budget ran out.
  { phrase: 'has reached its spend control', standing: 'stopped' },
  { phrase: 'is approaching its rate limit', standing: 'about-to-stop' },
]

/**
 * ⛔ **Every provider this app has a name for**, so the recogniser's roster is the schema's rather
 * than a pair of strings typed here — a third provider arrives as a key of {@link PROVIDER_NAME}
 * and this walks it without being edited.
 */
const PROVIDERS = Object.keys(PROVIDER_NAME) as Provider[]

/** `; resets 2026-09-23T11:00:00.000Z` — the tail both adapters append when the field crossed. */
const RESETS_AT = /; resets (\S+)$/

/** `(seven_day)` / `(weekly)` — the parenthetical immediately after the phrase, when there is one. */
const IN_PARENTHESES = /^\s*\(([^)]+)\)/

/** ` on the GPT-5.3-Codex-Spark limit` — Codex's bucket, when naming it distinguishes something. */
const NAMED_BUCKET = / on the (.+?) limit\b/

/** `95% of a 5-hour window used` — Codex's own duration words for the window it is talking about. */
const WINDOW_USED = /\d+% of (.+?) used/

/**
 * 🔴 **Read one recorded `error` line as a provider wall, or `null` because it is not one.**
 *
 * ⛔ **`null` for every other error in the ledger**, which is nearly all of them: a model that does
 * not exist, a sandbox that would not start, a retry. ⚠️ The recognition is POSITIVE — a name this
 * app ships, then one of {@link PHRASES} — so a new kind of error never becomes a wall by accident,
 * and a wall whose phrasing changed becomes `null` and goes quiet, which §2 of this module's test
 * is what stops.
 */
export function readProviderLimit(said: string, at: number): ProviderLimitSeen | null {
  const provider = PROVIDERS.find((one) => said.startsWith(`${one} `))
  if (provider === undefined) return null
  const rest = said.slice(provider.length + 1)
  const found = PHRASES.find((one) => rest.startsWith(one.phrase))
  if (found === undefined) return null
  const after = rest.slice(found.phrase.length)
  // ⛔ **The reset is parsed from the adapters' own `toISOString()`**, and a string that will not
  // parse is `null` rather than `NaN`: `new Date(NaN)` sorts and compares as nothing, and a row
  // ordered by it would land wherever the comparator happened to put it.
  const stamped = RESETS_AT.exec(said)?.[1]
  const resetsAt = stamped === undefined ? null : Date.parse(stamped)
  return {
    provider,
    // ⚠️ **Three sources, first one that answers, and NONE of them is required.** A line carrying
    // no window at all folds under the empty key, which is one wall per provider — the honest
    // reading when the provider told us nothing to tell two of them apart by.
    window: [
      IN_PARENTHESES.exec(after)?.[1],
      NAMED_BUCKET.exec(after)?.[1],
      WINDOW_USED.exec(after)?.[1],
    ]
      .filter((one) => one !== undefined)
      .join(' '),
    standing: found.standing,
    resetsAt: resetsAt === null || Number.isNaN(resetsAt) ? null : resetsAt,
    said,
    at,
  }
}

/**
 * 🔴 **One moment a provider was taking work** — the record that can end a wall (586, `HO-080` §1).
 *
 * ## ⛔ Two sources, and they are not the same KIND of evidence
 *
 * | source | what it is | how precise |
 * |---|---|---|
 * | ⚑ a turn that COMPLETED | this app inferring the provider answered | the provider as a whole — {@link window} is `''` |
 * | 🔴 `provider_limit_clear` | **the provider's own word**, Claude's `status: 'allowed'` | the window it named |
 *
 * ⚠️ **The second exists because this module's rule for the other direction demanded it.**
 * {@link LimitStanding} says `stopped` is only ever the PROVIDER's own word and never a threshold
 * of ours; ⛔ a retraction resting only on *we got an answer* would hold the two directions to
 * different standards. ⚑ `HO-080` §1.3: *"it is the provider stating the thing we are asking
 * about."*
 *
 * ## ⚠️ `window: ''` is a WIDER claim here than it is on a wall, and that asymmetry is deliberate
 *
 * ⛔ On {@link ProviderLimitSeen} an empty window means *the provider told us nothing to tell two of
 * its windows apart by*, so it folds as one wall. ⚑ **Here it means *the provider as a whole was
 * answering*, which disproves every window at once** — and it is sound in that direction because a
 * provider that returned a completed turn was not refusing anything at that instant.
 */
export interface ProviderTakingWork {
  /** Which provider was answering. */
  readonly provider: Provider
  /**
   * ⛔ **Which metered window this record speaks for, or `''` for the provider as a whole.**
   *
   * ⚠️ **The same spelling {@link ProviderLimitSeen.window} carries**, because matching the two is
   * the whole of {@link foldProviderLimits}' retraction — Claude's `allowed` names the same
   * `rateLimitType` its `rejected` names, and `readProviderLimit` reads that word out of the
   * adapter's own parenthetical.
   */
  readonly window: string
  /** When it happened, epoch ms. ⛔ Only a record NEWER than a wall can retract it. */
  readonly at: number
}

/**
 * ⛔ **One wall** — the provider and the window, never the event. See {@link foldProviderLimits}.
 *
 * ## ⚠️ It stopped being the band's `:key` at `586`, and the docblock that said so is corrected here
 *
 * ⛔ **It was exported because the BAND rendered on it**: a second spelling of *what is one wall*
 * six files away is `169` §1, and `533` found that drift the expensive way — the two copies
 * differed by one invisible character and every test passed, because a key only has to be unique
 * to work. ⚑ **Since `HO-080` §2 the band draws ONE row per PROVIDER**, so
 * `ProviderCondition.key` is the provider's own name and this is no longer what a `v-for`
 * reconciles by.
 *
 * ⚠️ **So nothing outside this module spells it today, and that is stated rather than dressed up.**
 * ⛔ It stays exported for two reasons that are not *a caller needs it*: it is the module's answer
 * to *what is ONE wall*, which is the subject `HO-080` §1.2 rules on — *a wall must name what it
 * blocks precisely enough that a success can disprove it* — and un-exporting it would be a second
 * change riding on a behaviour change, which `533 M4` anchors on besides.
 */
export const providerLimitKey = (seen: ProviderLimitSeen): string =>
  `${seen.provider} ${seen.window}`

/**
 * 🔴 **Whether a later record disproves this wall** (586, `HO-080` §1).
 *
 * Successful provider work retracts its stopped walls. Clearing too early costs a refusal that corrects the record; retaining a contradicted wall indefinitely leaves a false stopped-work claim.
 *
 * ## ⛔ It retracts `stopped` and NOT `about-to-stop`, and that is derived rather than timid
 *
 * ⚠️ **The two standings make different claims and a success contradicts only one of them.**
 * {@link LimitStanding} writes `about-to-stop` as *"the window is nearly spent and the provider is
 * still answering"* — ⛔ **a completed turn is that sentence coming true, not evidence against it.**
 * 🔴 `stopped` says work HAS stopped, and a turn that completed afterwards is exactly the
 * contradiction `HO-080` ruled on.
 *
 * **⚠️ And the cost of the other reading is measured, not imagined.** ⛔ Claude emits
 * `allowed_warning` DURING a turn and that turn completes seconds later, so a rule that retracted
 * `about-to-stop` too would clear every approach warning within one turn of its arrival — leaving
 * it visible only while a turn is in flight, which is the one time nobody is reading the queue.
 * 🔴 **`533` §0 exists because both providers hit a weekly wall inside two days and the approach
 * warning was the thing nobody saw.** ⚑ Deleting it under the banner of a retraction would be this
 * dispatch re-committing the defect `533` was written to end.
 *
 * ## 🔴 The window is what makes the match honest (`HO-080` §1.2)
 *
 * > ⚑ ***"A wall must name what it blocks precisely enough that a success can DISPROVE it."***
 *
 * ⛔ **A provider-wide record (`window: ''`) retracts every wall of that provider**; a windowed one
 * retracts only the wall that names the same window. ⚠️ **So Claude's own `allowed (five_hour)`
 * leaves a `seven_day` wall standing**, which is the precision `HO-080` §1.2 asked for and which no
 * completed turn can offer.
 *
 * ⚠️ **What today's key still cannot say is MODEL.** `providerLimitKey` is `${provider} ${window}`
 * and the SDK's `rate_limit_info` carries no model, so *Opus is refused while Sonnet works* is
 * neither expressible as a wall nor disprovable as a success. ⛔ **That is a finding and not a hole
 * this function papers over** — the retraction is coarse in the direction `HO-080` §1.1 chose, and
 * the fix if it bites is a more specific WALL, never a more timid retraction.
 *
 * ## ⚑ STRICTLY newer, and the boundary is argued
 *
 * ⛔ **`at > wall.at`, not `>=`.** A wall and a clear stamped in the same millisecond are two frames
 * of one turn whose order this app did not observe, and reading the clear as the later of them
 * would let a `rejected` frame be erased by the `allowed` frame that preceded it in the same tick.
 * ⚑ The cost of being wrong here is one poll — five seconds — and the next record settles it.
 */
const retractedBy = (wall: ProviderLimitSeen, takingWork: readonly ProviderTakingWork[]): boolean =>
  wall.standing === 'stopped' &&
  takingWork.some(
    (one) =>
      one.provider === wall.provider &&
      one.at > wall.at &&
      (one.window === '' || one.window === wall.window),
  )

/**
 * 🔴 **Every wall still standing, one per provider-and-window** (533 §2.3).
 *
 * ## ⛔ Why the fold is on the WINDOW and not on the event
 *
 * ⚠️ **His run recorded the same claude sentence five times in one conversation**, and Codex's line
 * carries a percentage that climbs — so two frames about one wall are two different strings. ⛔
 * **One provider at one limit is ONE thing a person needs to know**, and the newest observation is
 * the one that is true: it carries the current percentage and the current reset.
 *
 * ## ⚠️ Two rules on top of the fold, and each one is about not saying something false
 *
 *  1. 🔴 **A wall that has already come back is not a wall.** A reset in the past is dropped —
 *     otherwise a limit observed last Tuesday stands in a person's queue for ever. ⛔ A row whose
 *     provider named no reset is kept, because *"nothing said when it comes back"* is a fact about
 *     now rather than a stale one; what bounds it is the read's own window (see
 *     `SessionStore.providerLimitsSeen`).
 *  2. ⛔ **`stopped` subsumes `about-to-stop`, per provider.** Codex spells its wall
 *     (`rate-limited (weekly)`) and its approach (*"a 7-day window"*) differently, so the two do
 *     not share a fold key — and drawing *"Work on Codex has stopped"* above *"Work on Codex is
 *     about to stop"* would be one card saying two things about one provider, which is `304`.
 *     ⚑ The stronger claim is the one that is true, and it is the only one kept.
 *
 *  3. 🔴 **A wall a provider has since worked through is not a wall** (586, `HO-080` §1) — see
 *     {@link retractedBy}, which is the rule this dispatch added and the reason the signature
 *     grew a second list.
 *
 * ⚠️ **Ordered strongest first, then by the soonest return** — a person reading a summons acts on
 * what has already stopped, and between two of those on the one that comes back first. ⛔ A row
 * with no reset sorts LAST among its equals and never through a `?? 0`, which is
 * `byBlockedSince`'s own ruling one surface over: an unknown return is not a distant one.
 */
export function foldProviderLimits(
  seen: readonly ProviderLimitSeen[],
  takingWork: readonly ProviderTakingWork[],
  now: number,
): readonly ProviderLimitSeen[] {
  const newest = new Map<string, ProviderLimitSeen>()
  for (const one of seen) {
    if (one.resetsAt !== null && one.resetsAt <= now) continue
    if (retractedBy(one, takingWork)) continue
    const held = newest.get(providerLimitKey(one))
    if (held === undefined || one.at >= held.at) newest.set(providerLimitKey(one), one)
  }
  const walled = new Set(
    [...newest.values()].filter((one) => one.standing === 'stopped').map((one) => one.provider),
  )
  return [...newest.values()]
    .filter((one) => one.standing === 'stopped' || !walled.has(one.provider))
    .sort(
      (left, right) =>
        STANDING_RANK[left.standing] - STANDING_RANK[right.standing] ||
        (left.resetsAt ?? Number.POSITIVE_INFINITY) -
          (right.resetsAt ?? Number.POSITIVE_INFINITY) ||
        left.provider.localeCompare(right.provider),
    )
}

/**
 * 🔴 **F096 — the share of a window at which a person is told it nears its limit**, in percent.
 * ⚑ The person's own rule was *"stop at 80% of the weekly limit"*, and nothing told them it had
 * come: the providers warn later (Claude at its own threshold, Codex at 90%).
 */
export const USAGE_NEARS_ITS_LIMIT_AT = 80

/** One usage reading, as {@link wallsFromUsage} reads it — the shape the host keeps. */
export interface UsageNearItsLimit {
  readonly window: string
  readonly usedPercent: number | null
  readonly resetsAt: number | null
  readonly at: number
}

/**
 * 🔴 **F096 — a window the provider's own figure puts at or past {@link USAGE_NEARS_ITS_LIMIT_AT},
 * as a wall about to stop**, beside the walls the providers reported, folded with them
 * ({@link foldProviderLimits}): one band, and one condition per provider.
 *
 * ⚑ **The line is BroBot's, from the provider's figure, in the adapters' own shape** — so the band
 * names the window the way it names any wall (*"Claude is near its weekly limit; it resets on 9
 * October"*), and the figure and the reading's time are on its title. ⛔ It says *"by its latest
 * reading"*, so nobody takes it for the provider's own warning.
 *
 * ⛔ **Nothing for a provider with a wall that stopped work** (that is the stronger claim), nothing
 * for a window a provider wall already names (its own line is better), and nothing for a reading
 * whose window has reset since it was taken. ⛔ **Nothing for a Codex bucket's window**
 * (`a 7-day window (GPT-5.3-Codex-Spark)`): the band's sentence names no bucket, so it would say
 * *"Codex is near its weekly limit"* of a model's limit while the account's own stood far from it —
 * Codex's own warning still says a bucket at its 90%, the bucket on its title.
 */
export function wallsFromUsage(
  usage: Readonly<Partial<Record<Provider, readonly UsageNearItsLimit[]>>>,
  walls: readonly ProviderLimitSeen[],
  now: number,
): readonly ProviderLimitSeen[] {
  const stopped = new Set(
    walls.filter((one) => one.standing === 'stopped').map((one) => one.provider),
  )
  const named = new Set(walls.map(providerLimitKey))
  // ⚑ One wall a key, from the fullest reading: Codex's two slots of a length it did not say are
  // both *this window*, as its own warning names the fuller of them.
  const near = new Map<string, { readonly wall: ProviderLimitSeen; readonly used: number }>()
  for (const provider of PROVIDERS) {
    if (stopped.has(provider)) continue
    for (const reading of usage[provider] ?? []) {
      const used = reading.usedPercent
      if (used === null || used < USAGE_NEARS_ITS_LIMIT_AT) continue
      if (
        reading.resetsAt !== null &&
        (reading.resetsAt <= now || reading.resetsAt > MAX_INSTANT)
      ) {
        continue
      }
      if (/\)\s*$/.test(reading.window)) continue
      const percent = `${String(Math.round(used))}%`
      const resets =
        reading.resetsAt === null ? '' : `; resets ${new Date(reading.resetsAt).toISOString()}`
      // ⚑ Claude names a window by a word (`seven_day`), Codex by a duration (`a 7-day window`) —
      // or, when it did not say the length, by its slot (`its primary window`), which Codex's own
      // warning calls *this window*: said here as that line says it, so the two share one key.
      const window = /^its (primary|secondary) window$/.test(reading.window)
        ? 'this window'
        : reading.window
      const line = /\s/.test(window)
        ? `${provider} is approaching its rate limit — ${percent} of ${window} used, by its latest reading${resets}`
        : `${provider} is approaching its rate limit (${window}) — ${percent} used, by its latest reading${resets}`
      const wall = readProviderLimit(line, reading.at)
      if (wall === null) continue
      const key = providerLimitKey(wall)
      if (named.has(key) || (near.get(key)?.used ?? -1) >= used) continue
      near.set(key, { wall, used })
    }
  }
  return [...near.values()].map((one) => one.wall)
}

/**
 * ⛔ **When work comes back, in words, or that the provider did not say** (533 §1.1's second half).
 *
 * ## ⚠️ Relative and not a date, decided rather than fallen into
 *
 * 🔴 **The thresholds are `agoWords`' own** — a minute, an hour, a day — because a person reading
 * this queue is already reading *"9 minutes ago"* three lines down and two granularities in one
 * card is a card that has to be read twice. ⛔ **The spelling is not `agoWords`'**: that one
 * abbreviates for a dense list of rows and this is a sentence.
 *
 * ⚑ **And the exact instant is not lost** — `PersonsQueue.vue` pairs this with `fullTime` on the
 * element's `:title`, which is what `526` and fourteen components before it do with a shortened
 * rendering. ⛔ **A formatted date could not be the sentence**: `Intl` renders in the machine's own
 * zone, so an assertion on one would be a test about the machine (standing rule 22).
 */
export function comesBackWords(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return 'Nothing said when it comes back.'
  return `It comes back ${comesBackIn(resetsAt - now)}.`
}

/**
 * ⚠️ **How long until it comes back, as a FRAGMENT** — `in 2 hours`, `in less than a minute`.
 *
 * ⛔ **Extracted rather than duplicated** (586). {@link providerReturnWords} has to put this
 * inside a longer clause when a provider has walled twice, and a second spelling of *how long is
 * that* is two answers to one question free to drift — `169` §1, which this module has already
 * paid for once in {@link providerLimitKey}.
 */
function comesBackIn(ms: number): string {
  if (ms < 60_000) return 'in less than a minute'
  const say = (count: number, noun: string): string =>
    `in ${count} ${count === 1 ? noun : `${noun}s`}`
  if (ms < 3_600_000) return say(Math.round(ms / 60_000), 'minute')
  if (ms < 86_400_000) return say(Math.round(ms / 3_600_000), 'hour')
  return say(Math.round(ms / 86_400_000), 'day')
}

/**
 * 🔴 **The one sentence a person reads off the band** — consequence first, then the return.
 *
 * ⛔ **It names the provider the way every other surface in this app names one**
 * ({@link PROVIDER_NAME}), and it carries no window, no percentage and no timestamp: those are the
 * measurement, and `HO-050` §3's instruction is to name the consequence instead. ⚑ The provider's
 * own line is drawn underneath, unedited, so nothing is hidden by being re-worded.
 */
export function providerLimitSays(seen: ProviderLimitSeen, now: number): string {
  return providerConditionSays(seen.provider, seen.standing, [seen.resetsAt], now)
}

/**
 * 🔴 **When work comes back when a provider has walled MORE THAN ONCE — at the confidence of the
 * WEAKEST record** (586, `HO-080` §2).
 *
 * > ⚑ **The PO, and the reasoning matters more than the wording:** ⛔ ***"if one wall has no known
 * > reset, knowing the other lifts at 04:10 does not tell a person Claude works at 04:10. Two
 * > sentences let them read the reassuring one."***
 *
 * ## ⛔ Four states, enumerated, because the fall-through here is a false all-clear
 *
 * | what is known | what it says | why |
 * |---|---|---|
 * | ⚑ every reset | *It comes back in 3 hours.* | the LATEST of them — work resumes when the last limit lifts, not the first |
 * | ⛔ no reset | *Nothing said when it comes back.* | {@link comesBackWords}' sentence, unchanged |
 * | ⚠️ some of each | *One limit comes back in 2 hours and another reported no reset time.* | the known one is stated AND the unknown is admitted in the same sentence |
 * | 🔴 nothing at all | `''` | unreachable — a condition exists because a wall does; see {@link providerConditions} |
 *
 * ⛔ **The LATEST reset and not the soonest, for the same reason the mixed row admits its unknown.**
 * ⚠️ A person told *it comes back in 20 minutes* while a second limit lifts in five hours has been
 * told something that will be false in twenty minutes — `an-unenumerated-state-counts-as-success`
 * one field over, and `030`'s defect: the reassuring reading of a partial fact.
 *
 * ⚑ **The count is spelled, never implied.** *another* and *2 others* are the same clause at two
 * sizes, and a reader counting commas is the failure `provider_commands` names one file over.
 */
function providerReturnWords(resets: readonly (number | null)[], now: number): string {
  const known = resets.filter((one): one is number => one !== null)
  const unknown = resets.length - known.length
  if (known.length === 0) return resets.length === 0 ? '' : comesBackWords(null, now)
  const last = Math.max(...known)
  if (unknown === 0) return comesBackWords(last, now)
  return (
    `One limit comes back ${comesBackIn(last - now)} and ` +
    `${unknown === 1 ? 'another' : `${unknown} others`} reported no reset time.`
  )
}

/**
 * 🔴 **The one sentence a person reads about one provider** — consequence first, then the return at
 * the weakest confidence (586, `HO-080` §2).
 *
 * ⛔ **{@link providerLimitSays} is this function with one reset**, which is what makes *the
 * sentence about one wall* and *the sentence about a provider that walled twice* one derivation
 * rather than two that agree today.
 */
function providerConditionSays(
  provider: Provider,
  standing: LimitStanding,
  resets: readonly (number | null)[],
  now: number,
): string {
  const returns = providerReturnWords(resets, now)
  return `Work on ${PROVIDER_NAME[provider]} ${PROVIDER_LIMIT_SAYS[standing]}.${returns ? ` ${returns}` : ''}`
}

/**
 * 🔴 **ONE condition per provider, which is the question a person actually has** (586, `HO-080` §2).
 *
 * > ⚑ **The PO: *keep both records; show one condition per provider, stated at the confidence of
 * > the weakest record.*** ⛔ **`585` is right that collapsing the RECORDS could hide a real second
 * > limit — so nothing is collapsed here.** ⚠️ {@link foldProviderLimits} still answers with every
 * > wall still standing; this groups them for the one surface that draws a sentence.
 *
 * ## Use one condition row per provider
 *
 * ⚠️ **His screenshot held two claude rows** (`585`): one `rate_limit_event` with `five_hour` and a
 * reset, and one assistant-level `error: 'rate_limit'` with no window and no reset. ⛔ They fold
 * under `claude five_hour` and `claude ` — two different keys, both `stopped`, both true — **and on
 * screen they read as one condition contradicting itself.** 🔴 The band even gave both rows the
 * same `data-cy`, because it was already written as though a provider had at most one.
 *
 * ## ⚑ The standing is the provider's, and the fold has already guaranteed it
 *
 * ⛔ **Every surviving row of one provider shares a standing.** {@link foldProviderLimits}' second
 * rule drops `about-to-stop` for a provider that has any `stopped`, so a group is all-stopped or
 * all-approaching and this reads the first. ⚠️ **It is an invariant of the input rather than a
 * choice made here**, which is why it is asserted in `a-success-retracts-a-wall.test.ts` rather
 * than defended with a rank comparison that could never fire.
 *
 * ⚑ **Order is the fold's order**, which is strongest first and then soonest return — a provider's
 * first row decides where its condition sits, so the list a person reads is ordered by the thing
 * they act on.
 */
export interface ProviderCondition {
  /** ⛔ **One PROVIDER** — the `:key` a `v-for` reconciles by, and now unique by construction. */
  readonly key: string
  /** Which provider, so a surface can mark the row without parsing the sentence. */
  readonly provider: Provider
  /** See {@link LimitStanding} — shared by every record in this group; see the note above. */
  readonly standing: LimitStanding
  /** 🔴 **The sentence** — {@link providerConditionSays}, at the weakest record's confidence. */
  readonly says: string
  /**
   * ⛔ **Every record's own line, verbatim and in fold order** — the quiet half, and it is a LIST
   * because `585` measured two of them about one provider. ⚑ Nothing is merged, deduplicated or
   * paraphrased: collapsing two provider sentences is exactly what `585` warned could hide a real
   * second limit.
   */
  readonly said: readonly string[]
  /**
   * ⚠️ **The instant {@link says} names, or `null` because it names none** — the LATEST known reset
   * in the group. ⛔ It is carried so `PersonsQueue.vue` can pair the relative sentence with the
   * exact moment on a `:title`, and it must be the instant the SENTENCE used: a title naming a
   * different one of the two resets would be the card disagreeing with itself.
   */
  readonly resetsAt: number | null
}

/** See {@link ProviderCondition}. Pure, and ordered by the fold it is given. */
export function providerConditions(
  walls: readonly ProviderLimitSeen[],
  now: number,
): readonly ProviderCondition[] {
  const byProvider = new Map<Provider, ProviderLimitSeen[]>()
  for (const wall of walls) {
    const held = byProvider.get(wall.provider)
    if (held === undefined) byProvider.set(wall.provider, [wall])
    else held.push(wall)
  }
  return [...byProvider.entries()].map(([provider, group]) => {
    const resets = group.map((one) => one.resetsAt)
    const known = resets.filter((one): one is number => one !== null)
    return {
      key: provider,
      provider,
      // ⛔ **The first row's**, and the group shares it — see this type's docblock.
      standing: group[0]!.standing,
      says: providerConditionSays(provider, group[0]!.standing, resets, now),
      said: group.map((one) => one.said),
      resetsAt: known.length === 0 ? null : Math.max(...known),
    }
  })
}
