import { wordsForACard } from '../src/words-on-a-card'

/**
 * ⚑ **709 · what `probe:codex-approval-reason` concludes, as pure functions a cheap gate can pin.**
 *
 * ⛔ A live rig's reading is the part nothing else checks — `pin-a-live-only-instrument-from-a-cheap-gate`.
 * So the probe only COLLECTS — per turn, the text the scripted model put in its call, the raw server
 * request Codex raised and the `reason` on it, every string the product's card carried, what the
 * model was told its call returned, and Codex's own ending beside the product's — and this decides.
 * `test/codex-approval-reason-evidence.test.ts` holds it to planted turns, each verdict beside the one
 * fact that moves it.
 *
 * ⚠️ **The answer moves with a Codex bump**, which is why it is a probe and not a note: who writes a
 * `reason`, and whether BroBot's profile offers the model `request_permissions` at all, are both the
 * bundled binary's to decide.
 */

/** One turn of the probe — a scripted model call, and what came of it. */
export interface AskSeen {
  readonly turn: string
  /** The text the scripted model wrote into its call, or `null` on a turn where it wrote none. */
  readonly modelWrote: string | null
  /** The server request Codex raised for this turn, or `null` when none arrived. */
  readonly method: string | null
  /** `reason` on that raw request: its value, `null`, or `undefined` when the key was ABSENT. */
  readonly rawReason: string | null | undefined
  /** ⚑ **720 · `command` on that raw request**, or `null` when it carried none — R73's tie. */
  readonly rawCommand: string | null
  /**
   * What the product's card carried: the field named for the agent, and every OTHER string on it —
   * the prompt, the disclosure, the summary, the scope lines — flattened, so a sentence that lands
   * anywhere but under its author is found wherever it landed. `null` when no card was published.
   */
  readonly card: {
    readonly agentReason: string | null
    /**
     * ⚑ **720 · R73 — the provider's own words, and what kind they are** (`providerReasonFrom`).
     * Absent reads as `null`: a planted turn that names neither carried neither.
     */
    readonly providerReason?: string | null
    readonly providerReasonFrom?: string | null
    readonly elsewhere: readonly string[]
  } | null
  /** What the model was told its call returned, or `null` when it was told nothing. */
  readonly toolAnswer: string | null
}

/**
 * ⚑ **Who wrote a raw request's `reason`** — decided by the one fact that can decide it: whether it
 * is, byte for byte, the text the scripted model put in its call.
 *
 * - `the-model` — it is;
 * - `absent` — the request carried no `reason` key, or `null`;
 * - `not-the-model` — some other text, which is then Codex's or somebody's, and not the agent's;
 * - `no-request` — Codex raised nothing for this turn.
 */
export type ReasonAuthor = 'the-model' | 'absent' | 'not-the-model' | 'no-request'

export function whoWroteIt(ask: AskSeen): ReasonAuthor {
  if (ask.method === null) return 'no-request'
  if (ask.rawReason === undefined || ask.rawReason === null) return 'absent'
  return ask.modelWrote !== null && ask.rawReason === ask.modelWrote ? 'the-model' : 'not-the-model'
}

/**
 * ⚑ **The model was not OFFERED the tool** — Codex's code-mode host answered the call itself, before
 * any server request: *"`tools.request_permissions` is not a function"*. ⛔ Read off what the model
 * was TOLD, never off an absence of requests: a request that simply did not arrive in time is a
 * silence, not a measurement (`absence-in-a-capture-is-not-absence`).
 */
const NOT_OFFERED = /tools\.request_permissions is not a function/

export function notOffered(ask: AskSeen): boolean {
  return ask.method === null && ask.toolAnswer !== null && NOT_OFFERED.test(ask.toolAnswer)
}

/**
 * ⚑ **The sandbox REFUSED the write** — `sandbox-denied`'s premise, read off what the model was told
 * as {@link notOffered} is (709's review): the command ran and failed, with the OS's own words for a
 * refused write. ⛔ A write that succeeded, or a script that failed for another reason, refused
 * nothing, so a missing request after it says nothing about whether Codex asks to retry.
 */
const FAILED = /"exit_code":\s*[1-9]/
const REFUSED = /Operation not permitted/

export function sandboxRefused(ask: AskSeen): boolean {
  return (
    ask.method === null &&
    ask.toolAnswer !== null &&
    FAILED.test(ask.toolAnswer) &&
    REFUSED.test(ask.toolAnswer)
  )
}

/**
 * 🔴 **R44 — are the model's words on a card carried under the agent's name, and nowhere else?**
 *
 * The turns, by name — the probe's arms:
 * - **`justified`** — an escalated command WITH a justification: the model writes `reason`, and the
 *   card carries it as `agentReason` and in no other field;
 * - **`bare`** — the same command WITHOUT one (the one-fact control): no `reason`, no `agentReason`;
 * - **`p-shipped`** — `request_permissions` on BroBot's profile as shipped: either the model is not
 *   offered the tool, or — if a Codex bump offers it — the same rule as `p-enabled` applies;
 * - **`p-enabled`** — the same call with Codex's `request_permissions_tool` feature on: the model
 *   writes `reason`, and the card carries it as `agentReason` and in no other field;
 * - **`compound`** — `justified` on a compound command (`a && b`): the same rule;
 * - **`rule-said`, `rule-silent`, `rule-justified`, `rule-escalated`** — commands an exec-policy
 *   `prompt` rule stops (with and without the rule's own justification; unescalated, with a model
 *   justification, and escalated with one): CODEX writes the `reason`, so the card carries it under
 *   no agent's name — and since `720` (R73), when it names the rule, as the PROVIDER's words,
 *   labelled `a-policy-rule`;
 * - **`sandbox-denied`** — an unescalated write OUTSIDE the arm's cwd and every temporary folder,
 *   which the `ask` sandbox (`workspace-write` since `736`, R96; `read-only` until then) refuses: whether Codex asks
 *   (*"retry without sandbox?"*, its own words) — and if it ever does, the same rule as a policy's.
 *
 * Verdicts:
 * - ⛔ `not-performed` — a turn is missing, or the one it measures did not happen (no request where
 *   one was needed, no card for a request);
 * - 🔴 `moved` — the premise changed under a Codex bump: the model no longer writes the `reason`
 *   this rule is about, or the control grew one. Re-measure; the rule may no longer apply;
 * - 🔴 `misattributed` — words the model did NOT write (Codex's, a policy's) carried as the agent's:
 *   R44's defect, inverted;
 * - 🔴 `unlabelled` — a model's words reached a card somewhere OTHER than `agentReason`, or were not
 *   carried by it at all;
 * - 🔴 `the-rule-unsaid` (`720`, R73) — a policy's rule Codex wrote reached the card NOT as the
 *   provider's words labelled `a-policy-rule` (and `misattributed` covers a provider's words on a
 *   turn whose reason is no policy's rule);
 * - ⚑ `by-its-author` — every card carried the model's words under the agent's name only; `shipped`
 *   says whether BroBot's own profile offers the permissions tool at all, and `sandboxRetry` whether
 *   Codex asked to retry a sandbox-denied command.
 */
export type ReasonVerdict =
  | {
      readonly verdict: 'by-its-author'
      readonly shipped: 'not-offered' | 'offered'
      readonly sandboxRetry: 'not-asked' | 'asked'
    }
  | { readonly verdict: 'misattributed'; readonly turns: readonly string[] }
  | { readonly verdict: 'unlabelled'; readonly turns: readonly string[] }
  | { readonly verdict: 'the-rule-unsaid'; readonly turns: readonly string[] }
  | { readonly verdict: 'moved'; readonly because: string }
  | { readonly verdict: 'not-performed'; readonly because: string }

const REQUIRED = [
  'justified',
  'bare',
  'p-shipped',
  'p-enabled',
  'compound',
  'sandbox-denied',
  'rule-said',
  'rule-silent',
  'rule-justified',
  'rule-escalated',
] as const

/** ⚑ The turns an exec-policy `prompt` rule stops — where CODEX writes the `reason`. */
const POLICY_TURNS = ['rule-said', 'rule-silent', 'rule-justified', 'rule-escalated'] as const

/**
 * ⚑ **720 · R73 — is this turn's raw `reason` a policy's RULE** — *"`<its own command>` requires
 * approval: <the rule's text>"*, the one case R73 names. ⛔ The rule-silent form (*"… requires
 * approval by policy"*) names no rule, and is not.
 */
export function aPolicysRule(ask: AskSeen): boolean {
  if (ask.rawCommand === null || typeof ask.rawReason !== 'string') return false
  const head = `\`${ask.rawCommand}\` requires approval: `
  return ask.rawReason.startsWith(head) && ask.rawReason.slice(head.length).trim() !== ''
}

/** Did this turn's card carry the model's words under the agent's name, and nowhere else? */
function carriedByItsAuthor(ask: AskSeen): boolean {
  if (ask.card === null || ask.modelWrote === null) return false
  const words = ask.modelWrote
  return ask.card.agentReason === words && !ask.card.elsewhere.some((one) => one.includes(words))
}

export function reasonVerdict(asks: readonly AskSeen[]): ReasonVerdict {
  const of = (turn: string): AskSeen | undefined => asks.find((ask) => ask.turn === turn)
  const missing = REQUIRED.filter((turn) => of(turn) === undefined)
  if (missing.length > 0) {
    return { verdict: 'not-performed', because: `no turn measured for ${missing.join(', ')}` }
  }
  const justified = of('justified') as AskSeen
  const bare = of('bare') as AskSeen
  const shipped = of('p-shipped') as AskSeen
  const enabled = of('p-enabled') as AskSeen
  const compound = of('compound') as AskSeen
  const denied = of('sandbox-denied') as AskSeen
  const policy = POLICY_TURNS.map((turn) => of(turn) as AskSeen)
  // ⛔ **The premises first** — each turn must have measured what it exists to measure.
  for (const ask of [justified, bare, enabled, compound, ...policy]) {
    if (ask.method === null) {
      return { verdict: 'not-performed', because: `Codex raised no request for ${ask.turn}` }
    }
    if (ask.card === null) {
      return { verdict: 'not-performed', because: `the product published no card for ${ask.turn}` }
    }
  }
  if (shipped.method !== null && shipped.card === null) {
    return { verdict: 'not-performed', because: 'the product published no card for p-shipped' }
  }
  if (shipped.method === null && !notOffered(shipped)) {
    return {
      verdict: 'not-performed',
      because: 'p-shipped raised no request, and the model was not told the tool is missing',
    }
  }
  // ⚑ A silence is not a refusal to ask: the model must have been TOLD the sandbox refused it.
  if (denied.method === null && !sandboxRefused(denied)) {
    return {
      verdict: 'not-performed',
      because:
        'sandbox-denied raised no request, and the model was not told the sandbox refused it',
    }
  }
  if (denied.method !== null && denied.card === null) {
    return { verdict: 'not-performed', because: 'the product published no card for sandbox-denied' }
  }
  // 🔴 **Then whether the thing this rule is about still exists** — a Codex bump can move it.
  if (whoWroteIt(justified) !== 'the-model') {
    return {
      verdict: 'moved',
      because: `a command's reason is ${whoWroteIt(justified)}, not the model's justification`,
    }
  }
  if (whoWroteIt(bare) !== 'absent') {
    return { verdict: 'moved', because: `the bare command carried a reason (${whoWroteIt(bare)})` }
  }
  if (whoWroteIt(enabled) !== 'the-model') {
    return {
      verdict: 'moved',
      because: `a permissions request's reason is ${whoWroteIt(enabled)}, not the model's`,
    }
  }
  if (shipped.method !== null && whoWroteIt(shipped) !== 'the-model') {
    return {
      verdict: 'moved',
      because: `the shipped profile's permissions reason is ${whoWroteIt(shipped)}, not the model's`,
    }
  }
  if (whoWroteIt(compound) !== 'the-model') {
    return {
      verdict: 'moved',
      because: `a compound command's reason is ${whoWroteIt(compound)}, not the model's`,
    }
  }
  const policyMoved = policy.filter((ask) => whoWroteIt(ask) !== 'not-the-model')
  if (policyMoved.length > 0) {
    return {
      verdict: 'moved',
      because: policyMoved
        .map((ask) => `${ask.turn}'s reason is ${whoWroteIt(ask)}, not Codex's`)
        .join('; '),
    }
  }
  // 🔴 **720 · R73's premise: Codex's sentence names THIS request's own command**, in either form —
  // the tie `thePolicysWords` reads — and at least one policy turn states a rule, or the named case
  // was never on the wire and the checks below would pass over nothing.
  const untied = policy.filter(
    (ask) =>
      ask.rawCommand === null ||
      typeof ask.rawReason !== 'string' ||
      !ask.rawReason.startsWith(`\`${ask.rawCommand}\` requires approval`),
  )
  if (untied.length > 0) {
    return {
      verdict: 'moved',
      because: untied.map((ask) => `${ask.turn}'s reason does not name its own command`).join('; '),
    }
  }
  if (!policy.some(aPolicysRule)) {
    return { verdict: 'moved', because: 'no policy turn carried a rule’s text' }
  }
  // 🔴 **The inverted defect first** — words the model did not write, under the agent's name. ⚑ On
  // the control, `modelWrote` is `null`, so ANY agent words there are misattributed.
  const misattributed = [justified, bare, enabled, compound, denied, ...policy, shipped]
    .filter(
      (ask) =>
        ask.card !== null &&
        ask.card.agentReason !== null &&
        ask.card.agentReason !== ask.modelWrote,
    )
    .map((ask) => ask.turn)
  if (misattributed.length > 0) return { verdict: 'misattributed', turns: misattributed }
  // 🔴 **720 · R73 — a provider's words, or the rule label, on a turn whose reason is no policy's
  // rule** — the model's words, the rule-silent sentence, or nothing: carried as Codex's, they are
  // misattributed.
  const notARule = [justified, bare, enabled, compound, denied, ...policy, shipped]
    .filter(
      (ask) =>
        ask.card !== null &&
        ((ask.card.providerReason ?? null) !== null ||
          (ask.card.providerReasonFrom ?? null) !== null) &&
        !aPolicysRule(ask),
    )
    .map((ask) => ask.turn)
  if (notARule.length > 0) return { verdict: 'misattributed', turns: notARule }
  // ⚑ **The rule itself.** (The control, `bare`, carries no agent words at all — held by the check
  // above, since whatever it carried, the model did not write.)
  const unlabelled = [justified, enabled, compound, ...(shipped.method === null ? [] : [shipped])]
    .filter((ask) => !carriedByItsAuthor(ask))
    .map((ask) => ask.turn)
  // ⛔ **A model's words a POLICY overrode reach the card nowhere** — they never reached the wire.
  for (const ask of policy) {
    const words = ask.modelWrote
    if (
      words !== null &&
      ask.card !== null &&
      ask.card.elsewhere.some((one) => one.includes(words))
    ) {
      unlabelled.push(ask.turn)
    }
  }
  if (unlabelled.length > 0) return { verdict: 'unlabelled', turns: unlabelled }
  // 🔴 **720 · R73 — a policy's rule, carried by its author**: Codex's whole sentence as the
  // provider's words, labelled as a policy's rule.
  const unsaid = policy
    .filter(
      (ask) =>
        aPolicysRule(ask) &&
        // ⚑ The product carries the sentence CLEANED, never reworded — so it is compared with the
        // raw reason cleaned the same way (a heredoc's newlines, a doubled space; `720`'s review).
        (ask.card?.providerReason !== wordsForACard(ask.rawReason) ||
          ask.card?.providerReasonFrom !== 'a-policy-rule'),
    )
    .map((ask) => ask.turn)
  if (unsaid.length > 0) return { verdict: 'the-rule-unsaid', turns: unsaid }
  return {
    verdict: 'by-its-author',
    shipped: shipped.method === null ? 'not-offered' : 'offered',
    sandboxRetry: denied.method === null ? 'not-asked' : 'asked',
  }
}

/** A turn a person answered Cancel on — Codex's own ending beside the product's. */
export interface CancelSeen {
  /** Codex's own `turn/completed.turn.status`, or `null` if none arrived */
  readonly providerStatus: string | null
  /** The product's own `turn` event, or `null` if none arrived */
  readonly productWord: string | null
}

/**
 * ⚑ **What Codex itself says after a card's `{decision:'cancel'}`, beside what the product records.**
 * `the-providers-word` when both arrived and agree; 🔴 `renamed` when they disagree; ⛔
 * `not-performed` when either never arrived.
 *
 * ⚠️ **This is the PREMISE, not a test of R43.** With today's Codex both words are `interrupted` on
 * `main` too — there the latch renamed Codex's own `interrupted` to itself — so a green run cannot
 * tell the two codebases apart (`a-rule-measured-only-where-both-readings-agree`). ⚑ What it pins is
 * the measured fact the conformance and two-sentences tests plant, and the day a Codex bump makes
 * Codex complete a cancelled turn, `main`'s rename would read `renamed` here.
 */
export type CancelVerdict =
  | { readonly verdict: 'the-providers-word'; readonly word: string }
  | { readonly verdict: 'renamed'; readonly provider: string; readonly product: string }
  | { readonly verdict: 'not-performed'; readonly because: string }

export function cancelVerdict(seen: CancelSeen): CancelVerdict {
  if (seen.providerStatus === null) {
    return { verdict: 'not-performed', because: 'Codex reported no ending for the cancelled turn' }
  }
  if (seen.productWord === null) {
    return { verdict: 'not-performed', because: 'the product recorded no ending for it' }
  }
  if (seen.providerStatus !== seen.productWord) {
    return { verdict: 'renamed', provider: seen.providerStatus, product: seen.productWord }
  }
  return { verdict: 'the-providers-word', word: seen.productWord }
}
