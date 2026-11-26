import { providerAuthPolicies } from '../../providers/index'
import type { ProviderAuthPolicy } from '../../providers/auth-policy'
import { SUPPORTED_PROVIDERS, ResumeError } from '@brobot2/runtime'
import { type Provider } from '@brobot2/shared'
import type { TiedOutside } from '../../db/conversation-tree'
import { PROVIDER_NAME } from '../../../shared/runtime-ipc'
import type { TranscriptEvent } from '../../../shared/conversation-events'
import { unavailableOf } from '../session-unavailable'
import type { RecordedSession } from '../../db/session-store'
import { THE_ROWS_A_REFUSED_TURN_IS_READ_IN } from '../refused-turn-window'

/**
 * ⚑ **What a reopen on the current sign-in waits for** ({@link RuntimeHost.whatAReopenWaitsFor}) —
 * each a state in which reopening would lose something: a turn or a start of one, a card a person
 * answers, work running in the background, or planning.
 */
type WhatAReopenWaitsFor = 'its-turn' | 'a-person' | 'its-background-work' | 'its-planning'

/**
 * ⚑ **How soon after a reopen on the current sign-in a moved sign-in means the reopen did not help**
 * — the loop guard's window ({@link HostedSession.reopenedForWhatWaited}). ⚑ A Claude access token
 * lives 8 hours, so a renewal inside ten minutes of a launch is no renewal: the launch's credential
 * and the machine's are being read differently, and reopening again would loop. ⚠️ Past it, at most
 * one reopen per conversation per window, with something held each time.
 */
const REOPEN_LOOP_GUARD_MS = 10 * 60_000

/**
 * ⚑ **Why words held for a conversation wait for its reopen, in an agent's words** — after
 * {@link theSignInChanged} ({@link RuntimeHost.whyItWaitsForItsSignIn}). ⚑ `nothing`: the reopen
 * is under way. ⚑ `reopens` says when it is reopened, `then` when what is held goes in with no usage
 * limit in the way, and `sooner` what a person can do first.
 *
 * 🔴 **W4.172 · F095 — at a usage limit, `then` is left out, never added to** (W1 read *"goes in as
 * it starts"* on words that waited for a limit): the reopen is the same, and what is held then waits
 * for the limit in the reopened conversation ({@link RuntimeHost.whyItWaitsForItsSignIn}).
 */
const A_REOPEN_WAITS_FOR: Readonly<
  Record<
    WhatAReopenWaitsFor | 'nothing' | 'a-person-to-reopen-it',
    { readonly reopens: string; readonly then?: string; readonly sooner?: string }
  >
> = {
  nothing: {
    reopens: 'This app is reopening it on the current one',
    then: ', and what is held for it goes in as it starts',
  },
  // ⚑ **W4.172** — for the loop guard's window only ({@link RuntimeHost.itsReopenDidNotHelp}):
  // past it, this app may reopen it again, so the words say how long a person is the only way.
  'a-person-to-reopen-it': {
    reopens: `This app reopened it on the current one moments ago, and it read as moved on again before it ever read as current, so this app does not reopen it again within ${String(REOPEN_LOOP_GUARD_MS / 60_000)} minutes of that reopen; until then, what is held for it waits for a person to reopen it`,
  },
  'its-turn': {
    reopens: 'This app reopens it on the current one once its turn ends',
    then: ', and what is held for it goes in then',
    sooner: 'A person can stop that turn and reopen it sooner.',
  },
  'a-person': {
    reopens:
      'This app reopens it on the current one once the question or permission it is waiting on is answered',
    then: ', and what is held for it goes in then',
  },
  'its-background-work': {
    reopens:
      'This app reopens it on the current one once the work it runs in the background has finished, since a reopen would stop that work',
    then: '; what is held for it goes in then',
    sooner: 'A person can reopen it sooner.',
  },
  'its-planning': {
    reopens:
      'This app reopens it on the current one once a person ends its planning, since a reopen would end that',
    then: '; what is held for it goes in then',
    sooner: 'A person can reopen it sooner.',
  },
}

/** ⚑ The first sentence of every {@link A_REOPEN_WAITS_FOR}. */
const theSignInChanged = (provider: Provider): string =>
  `Its ${PROVIDER_NAME[provider]} sign-in changed after it started.`

/**
 * The rows a turn refused on its sign-in may hold and still have done nothing: how it went, what
 * its provider said of itself, and the recorded job title and task. Any other row, a word
 * of a reply or a tool call among them, means it did something, and then it is not carried on.
 */
const A_TURN_THAT_DID_NOTHING_HOLDS: ReadonlySet<TranscriptEvent['type']> = new Set([
  'pending_compaction',
  'titled',
  'work_given',
  'status',
  'error',
  'turn',
  'provider_usage',
  'provider_limit_clear',
  'context_reading',
  'provider_commands',
  'tool_inventory',
  'session',
])

/**
 * The rows that may follow a refused turn's ending and still mean nothing has come since: what its
 * provider says of itself, and what a reopen writes. Any other row is something newer, a turn's
 * ending, a turn its provider began by itself, an error or work given among them.
 */
const WHAT_A_REOPEN_ADDS: ReadonlySet<TranscriptEvent['type']> = new Set([
  'status',
  'provider_usage',
  'provider_limit_clear',
  'context_reading',
  'provider_commands',
  'tool_inventory',
  'session',
  'reopened',
  'launched',
  'work_recovery',
  'pending_compaction',
])

function compactionClearsContext(event: TranscriptEvent): boolean {
  return (
    event.type === 'compaction' && event.after === undefined && event.parentToolCallId === undefined
  )
}

/** Unrecognized protocol origins never supply housekeeping evidence. */
function authPolicyForNotice(event: TranscriptEvent): ProviderAuthPolicy | undefined {
  if (event.type !== 'unknown') return undefined
  const provider = SUPPORTED_PROVIDERS.find((one) => one === event.provider)
  return provider === undefined ? undefined : providerAuthPolicies[provider]
}

/** The provider may echo the input, but no output, tool progress or other echo proves no effects. */
function aRefusedGiveOnlyHeardHousekeeping(event: TranscriptEvent): boolean {
  return authPolicyForNotice(event)?.protocol.refusedGive(event) ?? false
}

/** An explicit, complete empty terminal level is startup state, not a job that ran or ended. */
function aGiveReopenOnlyHeardHousekeeping(event: TranscriptEvent): boolean {
  return SUPPORTED_PROVIDERS.some((provider) =>
    providerAuthPolicies[provider].protocol.reopenedGive(event),
  )
}

/** A retained input, never a second copy of its words. A piece restricts recovery to its first give. */
interface RefusedInputReference {
  readonly opened: number
  readonly drives: string | null
  readonly piece: string | null
}

/**
 * Did a reopen fail because its provider no longer has the session? A `ResumeError` its adapter
 * marked `noSuchSession`, read down the cause chain because the reopen's refusal wraps what it met.
 * ⛔ Nothing else: a deleted folder, a damaged transcript and a provider that could not start are
 * failures of this attempt, and a later one can succeed.
 */
function theProviderLostIt(error: unknown): boolean {
  let seen: unknown = error
  for (let depth = 0; depth < 8 && seen instanceof Error; depth += 1) {
    if (seen instanceof ResumeError && seen.noSuchSession) return true
    seen = (seen as { cause?: unknown }).cause
  }
  return false
}

/**
 * ⚑ **D-017 · R10 — can the conversation never be reopened?** — its provider no longer has it
 * ({@link theProviderLostIt}), or never named it (`never-started`).
 */
function itCanNeverBeReopened(error: unknown): boolean {
  if (theProviderLostIt(error)) return true
  let seen: unknown = error
  for (let depth = 0; depth < 8 && seen instanceof Error; depth += 1) {
    if (unavailableOf(seen) === 'never-started') return true
    seen = (seen as { cause?: unknown }).cause
  }
  return false
}

/**
 * ⚑ **D-017b · why a setting changed on a conversation nothing runs would not reach it**, or `null`
 * when its next start takes it: one an earlier version replaced has a conversation in its place,
 * and one no message continues has no next start. ⛔ Read by the recorded view
 * (`settingsFixed`) and by the door that writes a setting, so the controls a view offers are the
 * ones the host takes.
 */
function whyNoSettingForItsNextStart(
  row: RecordedSession,
  replacedBy: ReadonlyMap<string, string>,
  canFirstStart: boolean,
): string | null {
  if (replacedBy.has(row.sessionId)) {
    return 'Its messages go to the conversation continuing its job, so settings changed here would not reach it. Change the settings there.'
  }
  if (!canFirstStart && row.unresumableReason !== null) {
    return 'no message continues this conversation, so a setting changed here would not reach it'
  }
  return null
}

/** What an archive or a delete is stopping a conversation for: all of it, or its transcript. */
type SetAsideFor = 'archive' | 'delete' | 'its-files'

/** What is being done to a conversation set aside, as words that follow "This conversation". */
const SET_ASIDE_FOR: Readonly<Record<SetAsideFor, string>> = {
  archive: ' is being archived',
  delete: ' is being deleted',
  'its-files': '’s transcript is being deleted',
}

/** A start bringing a conversation back from the archive ({@link RuntimeHost.bringingBack}). */
interface BringingBack {
  /** The rest of its archived tree, which carries on once the start has succeeded. */
  readonly others: readonly string[]
  /** When each conversation of the tree was archived, to put back if the start fails. */
  readonly archivedAt: ReadonlyMap<string, number>
  readonly saying: string
}

/** What ties `here`, a conversation of a tree, to `other` outside it, as a clause. */
function tieInWords(how: TiedOutside['how'], here: string, other: string): string {
  switch (how) {
    case 'gave-it-work':
      return `${other} gave work to ${here}`
    case 'holds-work-it-gave':
      return `${other} holds work that ${here} gave it`
    case 'wrote-to-it':
      return `${other} wrote to ${here}`
    case 'asked-it':
      return `${other} asked ${here} a question`
    case 'added-files-to-its-work':
      return `${here} added files to ${other}’s work`
    case 'gave-it-a-piece-below':
      return `${other} holds work that hangs below ${here}’s`
  }
}

export {
  A_REOPEN_WAITS_FOR,
  A_TURN_THAT_DID_NOTHING_HOLDS,
  aGiveReopenOnlyHeardHousekeeping,
  aRefusedGiveOnlyHeardHousekeeping,
  type BringingBack,
  compactionClearsContext,
  itCanNeverBeReopened,
  type RefusedInputReference,
  REOPEN_LOOP_GUARD_MS,
  SET_ASIDE_FOR,
  type SetAsideFor,
  THE_ROWS_A_REFUSED_TURN_IS_READ_IN,
  theProviderLostIt,
  theSignInChanged,
  tieInWords,
  WHAT_A_REOPEN_ADDS,
  type WhatAReopenWaitsFor,
  whyNoSettingForItsNextStart,
}
