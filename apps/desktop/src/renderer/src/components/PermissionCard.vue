<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, watchEffect } from 'vue'
import type { PermissionDecision, Provider } from '../../../shared/runtime-ipc'
import { clockTime } from '../../../shared/clock'
import { fullTime } from '../lib/clock'
import {
  ALLOW,
  I_OPENED_IT,
  ALLOWED_ONCE,
  ALLOW_FOR_THIS_CONVERSATION,
  ALLOW_ONCE,
  ALWAYS_ALLOW,
  CANCEL_REQUEST,
  MCP_SERVER_KIND,
  MCP_TOOL_KIND,
  inTheAgentsWords,
  mcpToolAsker,
  mcpToolGrantCovers,
  mcpToolGrantDoes,
  noWayToAllow,
  outcomeAllows,
  permissionDecisionFor,
  conversationGrantCovers,
  conversationGrantSaid,
  keptGrantOf,
  keptGrantSaid,
  permissionOffer,
  whatTheMarksSay,
  wideGrantWarningParts,
  grantedFor,
} from '../lib/permission-offer'
import {
  WHAT_COMES_AFTER_IS_NOT_OURS,
  serversAskOf,
  whatThisAnswerDoes,
} from '../lib/user-input-offer'
import { whoAnsweredIt } from '../../../shared/who-did-it'
import type { RequestDraft, TakenWithoutThisWindow } from '../lib/session-record'
import {
  ANSWERED_IN_THE_OTHER_WINDOW,
  ANSWERED_ONCE_A_WINDOW_TAKES_IT,
  TAKE_IT_OVER_TO_ANSWER_HERE,
} from '../lib/taking-over'
import type { PermissionItem, PermissionOutcome, TranscriptItem } from '../lib/transcript'
import { escaped } from '../lib/named-in-a-reply'
import { usePathsIn, type PathsHere } from '../composables/useMessagePaths'
import PathsInText from './PathsInText.vue'

/**
 * The agent is frozen until this is answered. The card may only offer the decisions the provider
 * actually accepts for this request, and must disclose the whole scope it carries — including the
 * admission that the scope is not fully representable, which is the honest signal that approving
 * may do more than the summary line says.
 */
const props = defineProps<{
  item: PermissionItem & Pick<TranscriptItem, 'at'>
  /**
   * Where this card's state lives (064, 061 finding 8).
   *
   * ⚠️ **The in-flight guard and the disclosure used to be `ref`s in here**, which made them state
   * of a COMPONENT INSTANCE. A re-fold renumbers item ids, Vue rebuilds the rows, and both went with
   * the instance — so an expanded card collapsed and, worse, *"an already-submitted permission
   * decision"* became *"clickable again"*, in 061's words. Owned by the session record and keyed by
   * the request id, they outlive any number of rebuilds.
   *
   * Absent where there is no session to own one: the read-only pane, and a test mounting this card
   * on its own. Then it keeps its own, which lives exactly as long as it used to.
   */
  draft?: RequestDraft
  /**
   * 🔴 **725 · R44 — this conversation's own agent, by NAME, or `null`** (`TranscriptView.ownAgent`):
   * whose words the model's `agentReason` is drawn as. ⚑ Absent or `null` says *the agent*.
   */
  ownAgent?: string | null
  /**
   * 🔴 **725 · R73 — the conversation's provider, so a policy's rule is labelled as ITS rule**
   * (`inItsRulesWords`). ⚑ Absent or `null` says *the provider*.
   */
  provider?: Provider | null
  /**
   * ⚑ **D-017b · the conversation's turns are taken without this window** — the provider holds this
   * card for the window that holds it, so it is drawn read-only here, with the press that takes it
   * where no window does. ⚑ Absent or `null`: this window answers it.
   */
  takenWithoutThisWindow?: TakenWithoutThisWindow | null
  /** This conversation's paths. Absent: a path on the card stays plain text. */
  paths?: PathsHere | null
}>()
const emit = defineEmits<{
  decide: [requestId: string, decision: PermissionDecision]
  /** ⚑ **D-017b** — *Take it over to answer here*, raised; the screen takes it. */
  takeItOver: []
}>()

const ownDraft = reactive<RequestDraft>({
  answers: new Map(),
  sent: false,
  // ⚑ **468 · false, because a card with no record behind it has answered nothing.** This
  // draft exists only when the parent hands none — the card's own fallback — and nothing
  // reads `answered` off it: `answeredFromHere` walks `record.requests`, never a component.
  answered: false,
  open: false,
})
const draft = computed(() => props.draft ?? ownDraft)

const LABELS: Record<PermissionOutcome, string> = {
  allow: 'Approve',
  // ⚑ The words Waiting on you and the transcript use for the same choice: it ends with the
  // conversation, and nothing is kept.
  allow_for_session: ALLOW_FOR_THIS_CONVERSATION,
  // Overridden at render time by `wideLabel`, which names the tool. Kept here so the map stays
  // exhaustive — the type is what makes a new outcome a compile error rather than a blank button.
  // ⚑ 739 — never *Always*: that word is R95's grant, kept beyond the conversation (`allow_always`).
  allow_all_for_session: 'Allow all for this conversation',
  // 🔴 739 · `736` F-1 — R95's *Always allow*, the provider's own choice that outlives the
  // conversation: what it keeps and where is the line under it ({@link keeps}), never this word.
  allow_always: ALWAYS_ALLOW,
  deny: 'Deny',
  cancel: 'Cancel turn',
}

const scope = computed(() => props.item.request.scope)

/** The card's own words that may name a path: what it asks, the command, and its scope. */
const paths = usePathsIn(
  () => props.paths,
  () =>
    [
      props.item.request.action,
      props.item.request.summary ?? '',
      props.item.request.detail,
      scope.value.cwd ?? '',
      ...scope.value.paths,
    ].map(escaped),
)

/**
 * 🔴 **730 · R80 — the card Codex raises before an MCP tool runs** (`mcpToolCall`, `723`), or
 * `undefined` on every other card. ⚑ Everything this card says differently is keyed on it alone, so
 * an unmarked card — and every row before `723` — draws exactly as it did.
 */
const mcpCall = computed(() => props.item.request.mcpToolCall)

/**
 * 🔴 **737 · `728` — the MCP server that asks the person on this card** (`mcpServerAsks`), or
 * `undefined` on every other card — so a card from before `728`, and Codex's own MCP tool card,
 * draw as they did. ⛔ Keyed on the marker alone, never on the absence of `mcpToolCall` (`728`
 * F-10's forged frame carries Codex's marker and is Codex's card).
 */
const serversAsk = computed(() => serversAskOf(props.item.request))

/**
 * ⚑ **The page a server asks the person to open, when it is safe to copy** — a plain `http(s)`
 * address with no control, format or space characters, at most 4,096 long. ⛔ At least as strict as
 * the runtime's own rule for showing it on the card, so this never copies a link the card withheld.
 */
const serverLink = computed(() => {
  const url = props.item.request.mcpServerAsks?.url
  if (url === undefined || url.length > 4096) return null
  return /^https?:\/\/[^\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u.test(url) ? url : null
})
const linkCopied = ref<'copied' | 'refused' | null>(null)

async function copyServerLink(): Promise<void> {
  if (serverLink.value === null) return
  try {
    await navigator.clipboard.writeText(serverLink.value)
    linkCopied.value = 'copied'
  } catch {
    linkCopied.value = 'refused'
  }
}

/**
 * 🔴 **730 · the word on a button** — {@link LABELS}, except where a ruling gave this card its own:
 * R80's *Allow once* on Codex's MCP card, and R81's *Cancel request* on a card whose Cancel asks no
 * turn to stop (`cancelStopsNothing`). ⚑ **737** — and *Allow* where an MCP server asks
 * ({@link serversAsk}), the word its CLI shows (`728` §2).
 */
function labelOf(outcome: PermissionOutcome): string {
  if (outcome === 'allow' && serversAsk.value?.opensALink === true) return I_OPENED_IT
  if (outcome === 'allow' && serversAsk.value !== undefined) return ALLOW
  if (outcome === 'allow' && mcpCall.value !== undefined) return ALLOW_ONCE
  if (outcome === 'cancel' && props.item.request.cancelStopsNothing === true) return CANCEL_REQUEST
  return LABELS[outcome]
}

/**
 * ⛔ **What may be drawn, decided by the ONE function both surfaces call** (299 §1).
 *
 * ⚠️ **The `ORDER` array that used to live here was right, and being right here was not enough.**
 * It filtered `allow_all_for_session` out of the row under a comment saying so — *"it is not another
 * button in the row"* — while `attention.ts`, the other consumer of the same
 * `scope.availableDecisions`, mapped every offered outcome positionally onto peer buttons. The Home
 * overview drew the wholesale grant in the slot this card reserves for `allow_for_session`. See
 * `permission-offer.ts` for the measurement; what matters here is that the rule is no longer a thing
 * this component knows on its own.
 *
 * `offered` is the row, `wide` is the grant that is never in it. Both come out of one call, so they
 * cannot describe different requests.
 */
const offer = computed(() =>
  // ⚑ 695 · R36 — the request itself carries the provider's two marks, and the offer reads them.
  permissionOffer(scope.value.availableDecisions, props.item.request.action, props.item.request),
)

/**
 * Rendered in a stable order, but only where the provider offers the outcome.
 *
 * ⚠️ `allow_all_for_session` is deliberately NOT here (058). It is not another button in the row —
 * it is rendered below, apart, under its own warning. See {@link wide}.
 */
const offered = computed(() => offer.value.row)

/**
 * 🔴 695 · R36 — the provider's two marks, as sentences, from the function *Waiting on you*'s row reads too —
 * ⚑ and, since 700, the provider's own reason for them (since `725`, a policy's rule as its rule).
 */
const marksSay = computed(() =>
  whatTheMarksSay(props.item.request, offer.value, props.provider ?? null),
)

/**
 * 🔴 **725 · R44 — the model's own words about this command, as its agent's** (`agentReason`,
 * carried by `709`), or `null` on every row that does not carry them — a row from before `709`
 * among them, which is drawn as it was.
 */
const agentSays = computed(() =>
  props.item.request.agentReason
    ? inTheAgentsWords(props.ownAgent ?? null, props.item.request.agentReason)
    : null,
)

/**
 * The WHOLESALE grant, if this request offers one (058) — "every use of this tool this session,
 * whatever the arguments", as opposed to `allow_for_session`'s the provider's own rule for the ask (R94).
 *
 * ⚠️ **Its separation from `offered` is the feature, not styling.** The dispatch's rule is that it
 * "must not be reachable by the same click that grants a narrow scope". The backend made the two
 * mutually exclusive until `736`; since R94 an under-disclosed card whose CLI suggested its own rule
 * carries both, as two buttons with their own grants. This keeps the wide grant out of the row either
 * way: it is never a peer in the button row,
 * so no muscle memory aimed at "the second button" can land on it.
 *
 * Never a default and never pre-selected: nothing on this card is PRE-SELECTED. Every outcome
 * requires the click that names it. ⚠️ 695 · R36b moved which answer is drawn FIRST and FILLED on a
 * `defaultToNo` ask (Deny, then Approve outlined) — the order and the fill, never a selection.
 *
 * ⚑ **Its LABEL comes from the shared module too**, because the overview quotes the same words when
 * it says where this button is. Two surfaces naming one grant is the thing that must not drift.
 */
const wide = computed(() => offer.value.wide)

/**
 * 🔴 **Why this card offers no way to ALLOW its request, when it offers none** (487, closing
 * `483`'s repair 1).
 *
 * ⛔ **The line this replaces blamed the provider for our own fail-closed.** It read *"The
 * provider offered no decisions for this request."* on every empty offer, and on the branch `483`
 * traced as reachable the provider offered plenty — BroBot withheld every positive because the
 * grant riding along with the command could not be displayed faithfully. ⚑ Since 487 the adapter
 * writes WHY and this renders it.
 *
 * ⚠️ **The explanation lives here and not beside the `<span>`**, because a template comment is
 * rendered into the markup: quoting the retired sentence next to the element that replaced it put
 * the old copy back into every card's HTML, where a test looking for it found it (this
 * dispatch's own red).
 *
 * ⛔ **Both halves come from `permission-offer.ts`** — the adapter's own word turned into a
 * sentence, and the residual *nothing arrived at all* — because *Waiting on you* and the person's queue
 * say the same thing about the same request and a second copy here is `214` §3 on the sentence.
 */
const cannotAllow = computed(() => noWayToAllow(scope.value.noPositiveBecause, offer.value))
/** 🔴 736 · R94 — what the conversation grant this card draws covers, or null. */
const grantCovers = computed(() =>
  offer.value.row.includes('allow_for_session') ? conversationGrantSaid(scope.value) : null,
)
/**
 * 🔴 **739 · `736` F-1 — what *Always allow* keeps and where** ({@link keptGrantOf}), off the wire,
 * or `null` where the card does not offer it. ⚑ The line under the button and the `kept grant` row
 * both read it, and *Waiting on you* reads the same function, so no surface says it another way.
 */
const keeps = computed(() => keptGrantOf(scope.value))
const keptSaid = computed(() => keptGrantSaid(keeps.value))
/**
 * 🔴 **739 · *Always allow* is never the filled default** — outlined, as a `defaultToNo` ask draws
 * its allowing answers (695). ⚑ `058`'s reason for keeping the wholesale grant out of *"the filled
 * primary style the approve buttons carry, so nothing about it reads as the expected next click"*
 * holds for a grant that outlives the conversation too — on an always-only Codex command card it
 * would otherwise be the one filled button.
 */
function keptBeyond(outcome: PermissionOutcome): boolean {
  return outcome === 'allow_always'
}
/**
 * 🔴 **739 · whether *Always allow* here keeps Codex's own PREFIX rule** — the one answer on this
 * card that applies an exec-policy rule, so the proposal below is not *"not applied here"* of it.
 */
const keepsARule = computed(() =>
  (scope.value.grants?.allow_always ?? []).some((rule) => rule.kind === 'command-prefix'),
)
/**
 * ⚑ **739 review — and only where the `kept grant` row it points at is drawn**: pending, or answered
 * *Always allow*. A settled card answered anything else applied no rule, so its proposal reads as
 * main's — *proposed, not applied here* — true of every answer that card had.
 */
const keptRuleSaid = computed(
  () => keepsARule.value && (!answered.value || props.item.outcome === 'allow_always'),
)
const answered = computed(() => props.item.outcome !== null || props.item.note !== null)

/**
 * ⚑ **D-017b · waiting, and answered by another window than this one** — see
 * {@link takenWithoutThisWindow}: no decision is offered here, because the host would refuse it.
 */
const answeredElsewhere = computed(
  () => !answered.value && (props.takenWithoutThisWindow ?? null) !== null,
)

/**
 * 🔴 **743 · `739` F-7 — the `persistence` row: the offer's summary while the card asks, and what
 * the ANSWER granted once it is settled** (`grantedFor`). ⛔ A card answered *Allow once* read
 * *always* under its own *Allowed once*: the offer's widest grant, which nobody pressed.
 */
/** 🔴 743 · `739` F-8 — the plain wholesale warning, in the parts the card sets its reach in bold by. */
const warningParts = computed(() => wideGrantWarningParts(props.item.request.action))
const persistenceSaid = computed(() =>
  answered.value ? grantedFor(props.item.outcome) : scope.value.persistence,
)
/**
 * A decision is on its way, so no button may be offered again.
 *
 * ⚠️ **Set by whoever observes the act, and by BOTH of them on purpose.** The card sets it here
 * because a click has happened and nothing may be offered again from this instant; the store sets
 * it too, on the record, which is what makes the guard outlive the re-fold that used to reset it
 * (061 finding 8). Written in one place only, it would be wrong in one of two ways: on the card,
 * lost to a remount; in the store alone, absent for any surface that renders a card without wiring
 * a draft owner — which a review found is exactly what the fallback below is.
 */
const sent = computed(() => draft.value.sent)

/**
 * Whether the settled card is showing its whole self (034). Answered cards COLLAPSE, because the
 * moment a decision exists the card stops being a question and becomes a record of one — and a
 * record does not need the command block, the scope table, the warning and the button row it took
 * to ask. Two answered cards used to fill a screen, which is a real cost: the conversation they are
 * part of becomes unreadable.
 *
 * Nothing is deleted, only folded. 031 made the scope/persistence disclosure a hard rule — the user
 * must be able to see exactly what they granted — so the expanded view is the SAME markup as the
 * pending one, one click away, and the summary line always states the outcome.
 *
 * A PENDING card has no collapsed form at all: it is a question the agent is frozen on, and it must
 * stay impossible to miss.
 *
 * Kept on the draft rather than in a `ref` (064), so a re-fold cannot re-collapse a card the reader
 * deliberately opened to check what they granted — which is the disclosure 031 made a hard rule.
 */
const open = computed(() => draft.value.open)

/**
 * The anchor for the disclosure pair. `aria-controls` is bound only while the body is OPEN, because
 * the body is `v-if` and not `v-show`: keeping N answered bodies in the DOM of a long conversation
 * is the cost this whole change exists to avoid, so the element genuinely is absent when collapsed
 * and an `aria-controls` naming it would be pointing at nothing. `aria-expanded` — which is the
 * required half of the pair, and the one screen readers announce the disclosure with — is always
 * bound.
 */
const bodyId = computed(() => `permission-body-${props.item.request.id}`)

/** What was decided, in the user's words. `null` outcome with a note is a card that stopped being
 *  actionable without ever being answered (teardown) — which is neither an approval nor a refusal
 *  and must not be dressed as one. */
const verdict = computed(() => {
  const outcome = props.item.outcome
  if (!outcome) return 'Not answered'
  // ⚑ **737 review** — a server's card answered *Allow* reads back as allowed, the word its button said.
  if (outcome === 'allow' && serversAsk.value?.opensALink === true) return 'You said you opened it'
  if (outcome === 'allow' && serversAsk.value !== undefined) return 'Allowed'
  // 🔴 739 · `737` F-5 — Codex's MCP card: what was granted and for how long, in its button's word.
  if (outcome === 'allow' && mcpCall.value !== undefined) return ALLOWED_ONCE
  return {
    allow: 'Approved',
    allow_for_session: 'Allowed for this conversation',
    // Says what it GRANTED, not what was clicked: this is the line a settled card is read back by,
    // and on a card that offers both conversation grants it names the tool, so the transcript —
    // where someone goes to find out what they agreed to — tells the two apart. Codex's MCP card
    // offers only this one, so it says the plain words.
    allow_all_for_session:
      // ⚑ 730 · R80 — Codex's MCP CONVERSATION grant ends with it, so it is never *always* (its
      // *Always allow*, since `736`, is `allow_always`, verdict below).
      // 🔴 739 — never *always*: that word is R95's grant, kept beyond the conversation, below.
      mcpCall.value === undefined
        ? `Allowed every ${props.item.request.action} call for this conversation`
        : 'Allowed for this conversation',
    // ⚑ 739 · `736` F-1 — R95's *Always allow*: kept beyond this conversation, where the line under
    // its button said (740 · R99: where the CLI keeps it — Claude's project local settings, Codex's
    // provider home; the expanded card keeps that `kept grant` row). ⛔ It does not say the file was
    // written: a Claude or Codex command rule is written by the CLI, and nothing reports it.
    allow_always: 'Always allowed, beyond this conversation',
    deny: 'Denied',
    cancel: 'Cancelled',
  }[outcome]
})

/**
 * 🔴 **Who answered it** (503, HO-037 §2) — `UserDecisionEvent.by`, carried onto the item by the
 * fold and read from nowhere else.
 *
 * ## ⛔ Why the OUTCOME is the condition and not the `by` field
 *
 * ⚠️ **`answered` above is true of three different things**, and only one of them has an answerer:
 * a decision was taken; a teardown settled the card without one; a response was refused. ⛔ A card
 * in the second state has nobody to name AND no gap in the ledger to report, so drawing either arm
 * of {@link whoAnsweredIt} over it would be this app stating something that is not true of it.
 * ⚑ `item.outcome` is written by `markPermissionAnswered` and by nothing else, so it is exactly
 * *a decision row was folded* — which is the question being asked.
 *
 * ⚑ **The words are the vocabulary's** — `WHO_DID_IT_SAYS`, through the one phrasing — and the
 * `by` that frames the named arm is the shared clause's own, so this surface and the digest cannot
 * come to two opinions about an actor.
 */
const answeredBy = computed(() =>
  props.item.outcome === null ? null : whoAnsweredIt(props.item.by),
)

/** The state-colour grammar, unchanged: an approval is green, a refusal is red, and a card nobody
 *  answered is neither. Drives the border and the verdict, never colour alone — the word is right
 *  there beside it. */
const tone = computed(() => {
  switch (props.item.outcome) {
    case 'allow':
    case 'allow_for_session':
    case 'allow_all_for_session':
    case 'allow_always':
      return 'approved'
    case 'deny':
    case 'cancel':
      return 'refused'
    default:
      return 'unanswered'
  }
})

/**
 * What it WAS, in one line: the tool, then as much of the request as fits. The detail is often a
 * multi-line command block, so only its first line is offered here — the rest is behind the
 * disclosure with everything else, rather than silently re-flowing the card to three lines.
 */
const what = computed(() => {
  const head = props.item.request.detail.split('\n')[0]?.trim() ?? ''
  const clipped = head.length > 72 ? `${head.slice(0, 71)}…` : head
  return [props.item.request.action, clipped].filter(Boolean).join(' · ')
})

/**
 * How long it has been frozen — counted off the request's own time, and only while it is live.
 *
 * The clock STOPS the moment the card is answered (034). It always could have, but it mattered less
 * when a settled card was a rare thing at the end of a transcript; a long conversation now carries
 * every decision it ever made, and a per-card second-timer that outlives its own reason would have
 * every one of them re-rendering once a second forever.
 */
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
function stopTicking(): void {
  if (ticker === null) return
  clearInterval(ticker)
  ticker = null
}
watchEffect(() => {
  if (answered.value) stopTicking()
  else ticker ??= setInterval(() => (now.value = Date.now()), 1000)
})
onScopeDispose(stopTicking)
const waiting = computed(() => {
  if (answered.value || props.item.at === undefined) return null
  const seconds = Math.max(0, Math.round((now.value - props.item.at) / 1000))
  return seconds < 60 ? `waiting ${seconds}s` : `waiting ${Math.round(seconds / 60)}m`
})

/**
 * 🔴 **What pressing this outcome DOES, from the function the queue reads** (482, from `478` F3 —
 * *"`PermissionCard` says it in one word (Cancel turn)"*).
 *
 * ## ⛔ Nothing here is composed; both halves come from the modules that already own them
 *
 * ⚠️ **The decision is built by {@link permissionDecisionFor}** — the same call {@link decide}
 * makes, and the reason it is a call rather than an object literal is `473`: a second producer of
 * this value is how a Vue `Proxy` reached `ipcRenderer.invoke`. ⛔ Building one here to ask a
 * question about would be that second producer arriving through the back door.
 *
 * ⚑ **The sentence is `whatThisAnswerDoes`'s**, which is what `PersonsQueue` draws under every
 * button it offers — ⚑ **except the conversation's grant on Codex's MCP card** (`730` review, R80),
 * which says {@link mcpToolGrantDoes}: no other surface offers that grant, so no other surface has
 * a line to agree with. ⚠️ `label` is passed because the type asks for it and is not read for a
 * permission — the card's own vocabulary stays the card's (`297`, and see `permission-offer.ts`'s
 * *"what is deliberately NOT shared"*).
 */
function saysOf(outcome: PermissionOutcome): string {
  // ⚑ **728 · a SERVER's card says what the server is told** — see `ServersAsk`. Handed the same
  // `stopsNothing` 730 reads, so its Cancel line names the scope too.
  const server = serversAskOf(props.item.request)
  const stopsNothing = outcome === 'cancel' && props.item.request.cancelStopsNothing === true
  if (server !== undefined) {
    return whatThisAnswerDoes({
      kind: 'permission',
      label: labelOf(outcome),
      decision: permissionDecisionFor(outcome),
      server,
      ...(stopsNothing ? { stopsNothing: true as const } : {}),
    })
  }
  // 🔴 **730 · R81 — a Cancel that asks no turn to stop says so**, from the same function *Waiting on you*
  // and the person's queue read, handed the same marker (`attention.ts`).
  if (stopsNothing) {
    return whatThisAnswerDoes({
      kind: 'permission',
      label: labelOf(outcome),
      decision: permissionDecisionFor('cancel'),
      stopsNothing: true,
    })
  }
  // 🔴 **730 review · R80 — the conversation's grant on the MCP card names its tool and server**,
  // never *"anything of this kind"* beside a chip that says *MCP tool*. ⚑ Since `743` (`739` F-1,
  // ruled) *Waiting on you* and the person's queue offer this grant too, and say the same line
  // (`whatThisAnswerDoes`, handed the call).
  if (outcome === 'allow_all_for_session' && mcpCall.value !== undefined) {
    return mcpToolGrantDoes(mcpCall.value)
  }
  // 🔴 **739 · what the two standing buttons install**, handed to the function *Waiting on you* and the
  // person's queue read, with the same words (`attention.ts`): the conversation grant's rule (`726` F-14) and
  // what *Always allow* keeps and where (`736` F-1).
  const covers = outcome === 'allow_for_session' ? conversationGrantCovers(scope.value) : null
  const kept = outcome === 'allow_always' ? keeps.value : null
  if (covers !== null || kept !== null) {
    return whatThisAnswerDoes({
      kind: 'permission',
      label: LABELS[outcome],
      decision: permissionDecisionFor(outcome),
      ...(covers === null ? {} : { covers }),
      ...(kept === null ? {} : { keeps: kept }),
    })
  }
  return whatThisAnswerDoes({
    kind: 'permission',
    label: LABELS[outcome],
    decision: permissionDecisionFor(outcome),
  })
}

function decide(outcome: PermissionOutcome): void {
  if (sent.value) return
  draft.value.sent = true
  // ⛔ **The neutral decision object is built by `permissionDecisionFor`** (473) — `deny` is the
  // graceful refusal, `cancel` is the provider's own cancel (it ends the turn on a command or file
  // approval and on Claude; on a card marked `cancelStopsNothing` the turn runs on — `736`, R97), and
  // this switch used to live here. ⚠️ **It moved
  // because a SECOND producer of the same value got it wrong**: the overview's `answerFor` handed
  // the queue's own decision over, that queue keeps its world in a deep `ref`, and Electron refuses
  // to structured-clone a Vue `Proxy`. ⚑ `permission-offer.ts` is where this file's other shared
  // rule already lives, for the same reason — two copies of one rule and only one of them holds it.
  emit('decide', props.item.request.id, permissionDecisionFor(outcome))
}
</script>

<template>
  <!-- `data-outcome` is a style hook (it drives the spine and verdict colours below); `data-open` is
       a TEST one — `smoke:ui` step 4b re-finds the card it just expanded with
       `[data-cy=permission-card][data-open=true]`. No CSS reads `data-open` and none should: the
       fold is the `v-if` on the body, and it is announced by `aria-expanded`, not by an attribute. -->
  <article
    class="permission-card"
    :class="{ settled: answered }"
    data-cy="permission-card"
    :data-request-id="item.request.id"
    :data-outcome="answered ? tone : null"
    :data-open="answered ? open : null"
  >
    <!-- The whole of an answered card, until you ask for more. It carries what still matters —
         what was decided, what it was about, and when — and it is the element that says this card
         is settled, so nothing has to look inside the fold to know that. -->
    <button
      v-if="answered"
      class="settled-line"
      type="button"
      :aria-expanded="open"
      :aria-controls="open ? bodyId : undefined"
      data-cy="permission-answered"
      @click="draft.open = !draft.open"
    >
      <span class="frozen-pulse still"></span>
      <strong class="verdict" data-cy="permission-verdict">{{ verdict }}</strong>
      <span class="what" data-cy="permission-what">{{ what }}</span>
      <!-- 🔴 **Who answered it** (503). ⛔ Present only where a decision exists; a card a teardown
           settled was answered by nobody at all, which is neither of the two things this line can
           say. The words come from the shared vocabulary and never from this file. -->
      <span v-if="answeredBy" class="who" data-cy="permission-answered-by">{{ answeredBy }}</span>
      <span v-if="item.note" class="note" data-cy="permission-note">{{ item.note }}</span>
      <span class="time" :title="fullTime(item.at)">{{ clockTime(item.at) }}</span>
      <svg class="icon chevron" :class="{ open }"><use href="#i-chevron" /></svg>
    </button>

    <div v-if="!answered" class="permission-top">
      <span class="frozen-pulse"></span>
      <strong>Frozen until you answer</strong>
      <!-- 🔴 **737 · `730` F-9** — a server's own card is the server asking (`MCP server`), never
           *command*; every other card keeps its kind. -->
      <span v-if="serversAsk" class="kind">{{ MCP_SERVER_KIND }}</span>
      <span v-else class="kind">{{ mcpCall ? MCP_TOOL_KIND : item.request.kind }}</span>
      <span class="time" :title="fullTime(item.at)">{{ waiting ?? clockTime(item.at) }}</span>
    </div>

    <div v-if="!answered || open" :id="bodyId" class="permission-body" @click="paths.clicked">
      <p data-cy="permission-action">
        <PathsInText :text="item.request.action" :found="paths" />
      </p>
      <!-- The provider's own sentence, when it sends one (071). ABOVE the disclosure and never
           instead of it: "Claude wants to read foo.txt" is a readable summary of a request, and what
           Allow authorizes is the block below. -->
      <p v-if="item.request.summary" class="request-summary" data-cy="permission-summary">
        <PathsInText :text="item.request.summary" :found="paths" />
      </p>
      <!-- 🔴 725 · R44 — what the model wrote about this command, under its agent's name: beside
           the disclosure, never in it (181). -->
      <p v-if="agentSays" class="request-summary" data-cy="permission-agent-reason">
        {{ agentSays }}
      </p>
      <!-- ⚑ The server's link, copied in one press: open it in your browser, then answer here. -->
      <p
        v-if="serverLink && !answered"
        class="request-summary server-link"
        data-cy="permission-server-link"
      >
        <button type="button" data-cy="permission-copy-link" @click="copyServerLink">
          Copy link
        </button>
        <span v-if="linkCopied === 'copied'" role="status">
          Copied. Open it in your browser, then answer here.
        </span>
        <span v-else-if="linkCopied === 'refused'" role="status">
          Couldn’t copy it. Select the link in the text below instead.
        </span>
      </p>
      <!-- 🔴 730 · R80 — who asks, and the server, the tool and the parameters, as Codex named
           them: beside the disclosure, never instead of it (the block below is the whole call). -->
      <div v-if="mcpCall" class="mcp-call" data-cy="permission-mcp-call">
        <p class="request-summary" data-cy="permission-mcp-asker">
          {{ mcpToolAsker(provider ?? null) }}
        </p>
        <dl class="mcp-facts">
          <dt>server</dt>
          <dd data-cy="permission-mcp-server">{{ mcpCall.server }}</dd>
          <template v-if="mcpCall.tool">
            <dt>tool</dt>
            <dd data-cy="permission-mcp-tool">{{ mcpCall.tool }}</dd>
          </template>
          <template v-for="(parameter, index) in mcpCall.parameters" :key="index">
            <dt data-cy="permission-mcp-parameter-name">{{ parameter.name }}</dt>
            <dd data-cy="permission-mcp-parameter-value">{{ parameter.value }}</dd>
          </template>
        </dl>
        <!-- ⚠️ **730 review · the tail is only true of a block that was not cut itself**: a
             parameter too long to list is what makes the call long enough for `detailOmitted`. -->
        <p
          v-if="mcpCall.parametersOmitted"
          class="detail-omitted"
          data-cy="permission-mcp-parameters-omitted"
        >
          ⚠️ {{ mcpCall.parametersOmitted.toLocaleString() }} more
          {{ mcpCall.parametersOmitted === 1 ? 'parameter is' : 'parameters are' }} part of this
          call and not listed here —
          {{
            item.request.detailOmitted
              ? 'the block below holds the call, and says where it is cut.'
              : 'the block below is the whole call.'
          }}
        </p>
      </div>
      <!-- ⚠️ This is the disclosure, and it now shows the WHOLE of what Allow runs (071, from 069
           finding 1). It used to be handed a string already cut to 200 characters — no ellipsis, no
           way to see the rest — while Allow returned for the untruncated input: a benign prefix
           padded to the boundary and `; curl … | sh` after it. It scrolls rather than truncates, and
           a request past the transport ceiling says so on the line below, in the card's own chrome,
           where a model cannot forge the marker into its own command text. -->
      <div class="command-block" data-cy="permission-detail">
        <PathsInText :text="item.request.detail" :found="paths" />
      </div>
      <p
        v-if="item.request.detailOmitted"
        class="detail-omitted"
        data-cy="permission-detail-omitted"
      >
        ⚠️ {{ item.request.detailOmitted.toLocaleString() }} more characters are part of this
        request and are not shown here. Approving runs all of it.
      </p>
      <p
        v-if="paths.failure.value"
        class="message-path-failure"
        role="status"
        data-cy="message-path-failure"
      >
        {{ paths.failure.value }}
      </p>

      <!-- The whole scope, as the provider stated it. A card that showed only the command would be
           hiding what approving it actually grants. -->
      <dl class="scope">
        <template v-if="scope.cwd">
          <dt>cwd</dt>
          <dd><PathsInText :text="scope.cwd" :found="paths" /></dd>
        </template>
        <template v-if="scope.paths.length > 0">
          <dt>paths</dt>
          <dd>
            <div v-for="path in scope.paths" :key="path">
              <PathsInText :text="path" :found="paths" />
            </div>
          </dd>
        </template>
        <template v-if="scope.networkHosts.length > 0">
          <dt>network</dt>
          <dd>{{ scope.networkHosts.join(', ') }}</dd>
        </template>
        <!-- ⚑ 739 · the offer's own persistence: since `739` every button it summarises is drawn
             (`736` drew only what it drew until *Always allow* was). 🔴 743 · `739` F-7 — on a
             settled card, what the ANSWER granted (`persistenceSaid`). -->
        <dt>persistence</dt>
        <dd data-cy="permission-persistence">{{ persistenceSaid }}</dd>
        <!-- 🔴 736 · R94 — what the conversation grant installs, which can be far wider than this
             action (an edit's is every edit): the rules the button sends, in words.
             🔴 743 · `739` F-7's sibling — on a settled card only where that grant was the answer,
             as the `kept grant` row below: a card answered anything else installed no such rule. -->
        <template
          v-if="grantCovers !== null && (!answered || item.outcome === 'allow_for_session')"
        >
          <dt>conversation grant</dt>
          <dd data-cy="permission-grant-covers">{{ grantCovers }}</dd>
        </template>
        <!-- 🔴 739 · `736` F-1 — what *Always allow* keeps beyond this conversation, and where: the
             file the request names, verbatim. -->
        <!-- ⚑ 739 review — on a settled card only where *Always allow* was the answer: a card answered
             anything else kept nothing, and its expanded body is where a person checks what they
             agreed to. -->
        <template v-if="keptSaid !== null && (!answered || item.outcome === 'allow_always')">
          <dt>kept grant</dt>
          <dd data-cy="permission-always-keeps">{{ keptSaid }}</dd>
        </template>
        <template v-if="scope.grantRoot">
          <dt>grant root</dt>
          <dd>{{ scope.grantRoot }}</dd>
        </template>
        <template v-if="scope.amendments.length > 0 && !keptRuleSaid">
          <!-- ⛔ 697: its old heading said the card APPLIED these — false. The provider proposed
               them, and no answer drawn on this card applies one. -->
          <dt>proposed, not applied here</dt>
          <dd>
            <div v-for="amendment in scope.amendments" :key="amendment.kind + amendment.detail">
              {{ amendment.kind }}: {{ amendment.detail }}
            </div>
          </dd>
        </template>
        <!-- 🔴 739 · on a card whose *Always allow* keeps Codex's own prefix rule, that answer is the
             one that applies a rule for future commands — the one its `kept grant` names, echoed as
             Codex offered it (not rebuilt from this proposal). A network proposal no answer here
             applies. -->
        <template v-if="scope.amendments.length > 0 && keptRuleSaid">
          <dt>proposed</dt>
          <dd>
            <div
              v-for="amendment in scope.amendments"
              :key="amendment.kind + amendment.detail"
              data-cy="permission-proposed"
            >
              {{ amendment.kind }}: {{ amendment.detail }} —
              {{
                amendment.kind === 'exec'
                  ? `only ${ALWAYS_ALLOW} keeps a rule here, the one under “kept grant”`
                  : 'not applied by any answer here'
              }}
            </div>
          </dd>
        </template>
      </dl>

      <p v-if="scope.underDisclosed" class="warn" data-cy="permission-under-disclosed">
        ⚠ This request's full effect could not be represented — treat its scope as broader than
        shown.
      </p>

      <!-- ⛔ **A refusal the request SURVIVED** (146) — see `UserInputCard.vue` for the whole
           argument. Rendered here too because one function writes it for both card kinds, and a
           field the store can set on this item that this card cannot show would be a silence
           exactly where the sentence is needed. -->
      <p v-if="!answered && item.refused" class="refused" data-cy="permission-refused">
        {{ item.refused }}
      </p>

      <!-- No repeat of the verdict down here: the summary line above states it and stays visible
           while this is open, so a second copy would only be another thing to keep in agreement. -->
      <!-- 🔴 **Every button says what it does** (482, HO-030 §2). ⛔ *Cancel turn* was one word
           that happened to be right about SCOPE and silent about everything else, and four buttons
           beside it said nothing at all — the PO's *"an inconsistent explanation is worse than a
           uniformly absent one"*. ⚠️ **The label is not replaced:** the word is what you press and
           the line is what happens, and the line carries a clause the word cannot ("and this
           request is refused"). -->
      <!-- ⚑ **D-017b · read-only where another window, or none, holds the conversation** — what
           would answer it is said, and where no window holds it, the press that takes it here. -->
      <div
        v-if="answeredElsewhere"
        class="permission-actions"
        data-cy="permission-answered-elsewhere"
      >
        <p class="after">
          {{
            takenWithoutThisWindow === 'by-no-window'
              ? ANSWERED_ONCE_A_WINDOW_TAKES_IT
              : ANSWERED_IN_THE_OTHER_WINDOW
          }}
        </p>
        <button
          v-if="takenWithoutThisWindow === 'by-no-window'"
          class="btn approve-quiet"
          type="button"
          data-cy="permission-take-it-over"
          @click="emit('takeItOver')"
        >
          <span class="btn-word">
            <strong>{{ TAKE_IT_OVER_TO_ANSWER_HERE }}</strong>
          </span>
        </button>
      </div>
      <div v-else-if="!answered" class="permission-actions">
        <button
          v-for="outcome in offered"
          :key="outcome"
          class="btn"
          :class="{
            approve: outcomeAllows(outcome) && offer.primary === 'allows' && !keptBeyond(outcome),
            'approve-quiet':
              outcomeAllows(outcome) && (offer.primary === 'refuses' || keptBeyond(outcome)),
            deny: !outcomeAllows(outcome),
          }"
          type="button"
          :disabled="sent"
          :data-cy="`permission-${outcome}`"
          @click="decide(outcome)"
        >
          <span class="btn-word">
            <svg class="icon">
              <use :href="outcome === 'deny' || outcome === 'cancel' ? '#i-x' : '#i-play'" />
            </svg>
            <strong>{{ labelOf(outcome) }}</strong>
          </span>
          <small :data-cy="`permission-does-${outcome}`">{{ saysOf(outcome) }}</small>
        </button>
        <!-- 🔴 **Why there is no way to allow this** (487) — see `cannotAllow` in the script
             block for what this replaced and why that argument is not written here. -->
        <span
          v-if="cannotAllow"
          class="warn"
          data-cy="permission-cannot-allow"
          :data-why="cannotAllow.why"
        >
          {{ cannotAllow.says }}
        </span>
        <!-- 🔴 **695 · R36 — the provider's own marks, said where the missing button would be.**
             The offer already obeys them; these explain an order and an absence. -->
        <p v-if="marksSay.grantWithheld" class="after" data-cy="permission-grant-withheld">
          {{ marksSay.grantWithheld }}
        </p>
        <p v-if="marksSay.defaultIsNo" class="after" data-cy="permission-default-no">
          {{ marksSay.defaultIsNo }}
        </p>
        <!-- 🔴 **700 · `695` F-f — and the provider's own words**, quoted after the lines that say
             what the marks did: its reason for a mark, or (725, R73) its rule. -->
        <p v-if="marksSay.providerReason" class="after" data-cy="permission-provider-reason">
          {{ marksSay.providerReason }}
        </p>
        <!-- 🔴 **The gap, once for the row** (434, HO-024 §5.3) — the same sentence in the same
             place `PersonsQueue` draws it. -->
        <p v-if="offered.length > 0" class="after" data-cy="permission-after">
          {{ WHAT_COMES_AFTER_IS_NOT_OURS }}
        </p>
      </div>

      <!-- The WHOLESALE grant (058), below the row and never in it.
           Until `736`, 031 offered "Approve for session" only where a card fully described its own
           effect, and refused it for an opaque tool because the grant would then cover things the
           card never showed (that button now grants the rule the provider suggests, said below the
           scope). That left the tool with the worst approval fatigue as the only one offered no
           relief at all. This is the honest version of the grant it was refused: it really does
           cover every future call, so it says so, and it is the one thing on this card that
           explains itself before you can press it.
           Set apart deliberately — its own block, its own warning, and NOT the filled primary
           style the approve buttons carry, so nothing about it reads as the expected next click. -->
      <div v-if="!answered && !answeredElsewhere && wide" class="wide-grant">
        <!-- 🔴 730 · R80 — Codex's MCP grant covers the tool, whatever it is given, and ends with
             the conversation (measured, `723`). -->
        <p v-if="mcpCall" class="warn" data-cy="permission-wide-warning">
          {{ mcpToolGrantCovers(mcpCall, provider ?? null) }}
        </p>
        <!-- 🔴 743 · `739` F-8 — the words on its button, in the parts of the sentence *Waiting on you* and
             the person's queue draw whole (its reach in bold, 058). ⚠️ A template comment is rendered:
             the old words are not quoted here. -->
        <p v-else class="warn" data-cy="permission-wide-warning">
          {{ warningParts.lead }}<strong>{{ warningParts.reach }}</strong
          >{{ warningParts.rest }}
        </p>
        <button
          class="btn wide"
          type="button"
          :disabled="sent"
          :data-cy="`permission-${wide.outcome}`"
          @click="decide(wide.outcome)"
        >
          <span class="btn-word">
            <svg class="icon"><use href="#i-play" /></svg>
            <strong>{{ wide.label }}</strong>
          </span>
          <!-- ⛔ **The widest button on the card is not the one to leave silent** (482). The
               warning above says what the GRANT covers; this says what the PRESS does, and both
               are drawn because they are different claims. -->
          <small :data-cy="`permission-does-${wide.outcome}`">{{ saysOf(wide.outcome) }}</small>
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.server-link {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
}

.permission-card {
  max-width: var(--measure-message);
  margin: 0 auto var(--space-10);
  border: var(--border-width) solid var(--waiting-card-border);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: inset var(--border-edge-width) 0 0 var(--waiting);
  overflow: hidden;
}

.permission-card.settled {
  margin-bottom: var(--space-6);
  border-color: var(--line-strong);
  background: var(--wash-1);
  box-shadow: inset var(--border-edge-width) 0 0 var(--line-strong);
}

.permission-card[data-outcome='approved'] {
  box-shadow: inset var(--border-edge-width) 0 0 var(--success);
}

.permission-card[data-outcome='refused'] {
  box-shadow: inset var(--border-edge-width) 0 0 var(--danger);
}

.settled-line {
  display: flex;
  width: 100%;
  min-height: 34px;
  align-items: center;
  padding: var(--space-3) var(--space-6);
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: var(--type-caption);
  gap: var(--space-4);
  text-align: left;
}

.settled-line:hover {
  background: var(--wash-2);
}

.verdict {
  color: var(--text-soft);
  font-size: var(--type-caption);
  font-weight: var(--fw-bold);
  white-space: nowrap;
}

[data-outcome='approved'] .verdict {
  color: var(--success);
}

[data-outcome='refused'] .verdict {
  color: var(--danger-text);
}

.what {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  color: var(--muted);
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settled-line .who {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: var(--type-caption);
  white-space: nowrap;
}

.settled-line .time {
  color: var(--faint);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

.settled-line .chevron {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  color: var(--faint);
  transition: transform var(--dur-fast) ease;
}

.settled-line .chevron.open {
  transform: rotate(90deg);
}

.settled .permission-body {
  border-top: var(--border-width) solid var(--line);
}

.permission-top {
  display: flex;
  min-height: 39px;
  align-items: center;
  padding: var(--space-4) var(--space-8);
  border-bottom: var(--border-width) solid var(--waiting-card-line);
  gap: var(--space-4);
}

.permission-top strong {
  color: var(--waiting-text);
  font-size: var(--type-small);
  font-weight: var(--fw-bold);
}

.kind {
  color: var(--waiting-text-weak);
  font: var(--type-caption) / 1 var(--font-mono);
}

.frozen-pulse {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
  animation: pulse 1.6s ease-in-out infinite;
  background: var(--waiting);
  box-shadow: var(--waiting-glow-wide);
}

.frozen-pulse.still {
  animation: none;
  background: var(--muted);
  box-shadow: none;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.35;
  }
}

.permission-top .time {
  margin-left: auto;
  color: var(--waiting-text-weak);
  font-family: var(--font-mono);
  font-size: var(--type-caption);
}

.permission-body {
  padding: var(--space-6) var(--space-8);
}

.permission-body p {
  margin: 0;
  color: var(--waiting-text-soft);
  font-size: var(--type-small);
  line-height: var(--leading-normal);
}

.permission-body .request-summary {
  margin-top: var(--space-3);
  color: var(--waiting-text);
}

.command-block {
  margin: var(--space-5) 0;
  padding: var(--space-4) var(--space-5);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: var(--code-bg);
  color: var(--code-text);
  font: var(--type-caption) / 1.45 var(--font-mono);
  max-height: 40vh;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.permission-body .detail-omitted {
  margin-bottom: var(--space-5);
  color: var(--danger-text-notice);
  font-size: var(--type-caption);
}

.mcp-facts {
  display: grid;
  max-height: 30vh;
  margin: 0 0 var(--space-5);
  color: var(--text-soft);
  font: var(--type-caption) / 1.5 var(--font-mono);
  gap: var(--space-1) var(--space-5);
  grid-template-columns: auto 1fr;
  overflow: auto;
}

.mcp-facts dt {
  color: var(--faint);
}

.mcp-facts dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.scope {
  display: grid;
  margin: 0 0 var(--space-5);
  color: var(--muted);
  font: var(--type-caption) / 1.5 var(--font-mono);
  gap: var(--space-1) var(--space-5);
  grid-template-columns: auto 1fr;
}

.scope dt {
  color: var(--faint);
}

.scope dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.warn {
  margin: 0 0 var(--space-5);
  color: var(--waiting);
  font-size: var(--type-caption);
}

.permission-actions {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
}

.btn {
  display: inline-flex;
  min-height: var(--control-h);
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: var(--space-2) var(--space-6);
  border: var(--border-width) solid var(--line-strong);
  border-radius: var(--radius-md);
  background: var(--wash-2);
  color: var(--text-soft);
  font-size: var(--type-small);
  font-weight: var(--fw-semibold);
  gap: var(--space-1);
  text-align: left;
}

.btn-word {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  white-space: nowrap;
}

.btn small {
  font-size: var(--type-caption);
  font-weight: var(--fw-normal);
  line-height: var(--leading-tight);
  opacity: 0.85;
  white-space: normal;
}

.after {
  margin: 0;
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-tight);
}

.btn:hover:not(:disabled) {
  background: var(--wash-5);
}

.btn:disabled {
  opacity: 0.6;
}

.btn .icon {
  width: 14px;
  height: 14px;
}

.btn.approve {
  border-color: var(--waiting);
  background: var(--waiting);
  color: var(--waiting-ink);
}

.btn.approve:hover:not(:disabled) {
  border-color: var(--waiting-fill-hover);
  background: var(--waiting-fill-hover);
}

.btn.deny {
  border-color: var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger-text-soft);
}

.btn.approve-quiet {
  border-color: var(--waiting);
  background: transparent;
}

.wide-grant {
  margin-top: var(--space-6);
  padding-top: var(--space-5);
  border-top: var(--border-width) solid var(--line);
}

.wide-grant .warn {
  margin-bottom: var(--space-4);
}

.btn.wide {
  border-color: var(--danger-border);
  background: transparent;
  color: var(--danger-text-soft);
  font-weight: var(--fw-semibold);
}

.btn.wide:hover:not(:disabled) {
  background: var(--danger-bg);
}

.btn.deny:hover:not(:disabled) {
  background: var(--danger-fill-hover);
}

.settled-line .note {
  flex: 0 1 auto;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--type-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refused {
  margin: 0 0 var(--space-4);
  color: var(--muted);
  font-size: var(--type-caption);
  line-height: var(--leading-normal);
}
</style>
