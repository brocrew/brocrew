/**
 * 🔴 **722 · R79 — the verdict of `probe:claude-launch-id`, kept pure so `ci` can pin it.**
 *
 * ⚑ The ruling: *"A Claude launch holds its provider session id from the start (SDK 0.3.281's
 * `options.sessionId` if it assigns the id before the CLI runs; measure it), so a conversation
 * closed before `system/init` still has a ref."* The probe drives the PRODUCT's `ClaudeRuntime`
 * against a scripted loopback model and records, per arm, what the CLI named its transcript and
 * what the product announced. This module decides what that means.
 *
 * | arm | what is done | what R79 needs |
 * |---|---|---|
 * | **finishes** | a turn the model answers | the first `system/init` names the id the launch asked for, and so does the transcript |
 * | **closed-before-init** — the subject | the turn is sent, then the session closed before any init is read | the transcript is named by the asked id, the product announces THAT id as the conversation ENDED, and a reopen by it takes a turn under that same ref |
 * | **named-none** — the control | the same, with `sessionId` taken out of the launch (`717`'s shape) | a transcript under an id of the CLI's own, and nothing announced — the defect, reproduced |
 * | **never-sent** | closed with nothing sent | no transcript, and nothing announced |
 *
 * ⛔ **Every arm owes its premise read off the child** (`709`): a subject whose init arrived before
 * the close — or DURING it, while the interrupt was being acknowledged, so the ordinary init path
 * named it (the `722` review) — or whose CLI wrote nothing before it was closed, measured nothing
 * about R79 and says so — `not-performed` — rather than reading as the product holding or failing. ⚠️ `moved` means the CLI
 * or the product now does something this probe did not expect: re-read before believing either.
 */

export type LaunchArm = 'finishes' | 'closed-before-init' | 'named-none' | 'never-sent'

export interface LaunchSeen {
  readonly arm: LaunchArm
  /** The `sessionId` the launch's options carried — `null` when none did. */
  readonly asked: string | null
  /** The first `system/init`'s `session_id` read by the time the close COMPLETED, or `null`. */
  readonly initId: string | null
  /** Whether an init had been read when the close was asked — `null` on an arm that never closes early. */
  readonly initBeforeClose: boolean | null
  /** The ids of every `<id>.jsonl` under the launch's provider home, after the close. */
  readonly transcripts: readonly string[]
  /** The `sessionId` the product announced on a `session` event, or `null` when it announced none. */
  readonly announced: string | null
  /** The `state` of the `session` event that announced it — `ended` is R79's door; `null` with none. */
  readonly announcedOn: 'started' | 'resumed' | 'ended' | null
  /**
   * closed-before-init only: the folder the launch was GIVEN (a symlink), the one the CLI RECORDED
   * in its transcript — read by the probe off the file, never through the product — and the one
   * the product ANNOUNCED. `null` on every other arm.
   */
  readonly cwdLaunched: string | null
  readonly cwdRecorded: string | null
  readonly cwdAnnounced: string | null
  /**
   * closed-before-init only: whether a reopen by the announced ref TOOK A TURN — the product's
   * `resume`, a send, the CLI's `--resume`, and a `session: 'resumed'` under that same ref (the
   * product's init barrier) before the turn completed. ⚠️ Not the preflight alone (the `722`
   * review): `resume` returns before any init, so a handle is no proof the CLI took the id.
   */
  readonly resumed: boolean | null
}

export type LaunchVerdict =
  | { readonly verdict: 'names-its-own' }
  | { readonly verdict: 'not-performed'; readonly why: string }
  | { readonly verdict: 'moved'; readonly why: string }

const A_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function launchIdVerdict(seen: readonly LaunchSeen[]): LaunchVerdict {
  const arm = (name: LaunchArm): LaunchSeen | undefined => seen.find((one) => one.arm === name)
  const finishes = arm('finishes')
  const closed = arm('closed-before-init')
  const none = arm('named-none')
  const neverSent = arm('never-sent')
  if (!finishes || !closed || !none || !neverSent) {
    return { verdict: 'not-performed', why: 'an arm is missing' }
  }

  // ⛔ The premises first — each read off the child, never assumed.
  for (const early of [closed, none]) {
    if (early.initBeforeClose !== false) {
      return {
        verdict: 'not-performed',
        why: `${early.arm}: an init was read before the close, so nothing here was closed before init`,
      }
    }
    // ⛔ …and none DURING it: the interrupt is awaited while the reader still reads, and an init
    // that lands there names the conversation by the ordinary path (the `722` review).
    if (early.initId !== null) {
      return {
        verdict: 'not-performed',
        why: `${early.arm}: an init reached the adapter during the close, so the init path named it`,
      }
    }
    if (early.transcripts.length === 0) {
      return {
        verdict: 'not-performed',
        why: `${early.arm}: the CLI wrote no transcript before it was closed — there was nothing to name`,
      }
    }
  }

  // ⛔ The subject's own premise: the CLI RESOLVED the symlinked folder it was launched from. Where
  // it recorded the folder as given, the recorded-spelling path (the `722` review) was not exercised.
  if (closed.cwdRecorded === null || closed.cwdRecorded === closed.cwdLaunched) {
    return {
      verdict: 'not-performed',
      why: 'closed-before-init: the CLI recorded the folder as it was launched, so the recorded spelling was not exercised',
    }
  }

  // ⚑ The launch asks for its own id, and the CLI takes it.
  if (finishes.asked === null || !A_UUID.test(finishes.asked)) {
    return { verdict: 'moved', why: 'finishes: the launch asked for no id, or not a UUID' }
  }
  if (finishes.initId !== finishes.asked) {
    return {
      verdict: 'moved',
      why: `finishes: the init named ${String(finishes.initId)}, not the id asked for`,
    }
  }
  if (!finishes.transcripts.includes(finishes.asked)) {
    return { verdict: 'moved', why: 'finishes: no transcript under the id asked for' }
  }

  // 🔴 The subject: closed before init, and still ONE conversation under the launch's own id.
  if (closed.asked === null || closed.transcripts.join() !== closed.asked) {
    return {
      verdict: 'moved',
      why: `closed-before-init: the transcript is ${closed.transcripts.join(', ')}, not the id asked for (${String(closed.asked)})`,
    }
  }
  if (closed.announced !== closed.asked) {
    return {
      verdict: 'moved',
      why: `closed-before-init: the product announced ${String(closed.announced)}, not the id it launched with`,
    }
  }
  if (closed.cwdAnnounced !== closed.cwdRecorded) {
    return {
      verdict: 'moved',
      why: `closed-before-init: the product announced the folder ${String(closed.cwdAnnounced)}, not the one the CLI recorded (${closed.cwdRecorded})`,
    }
  }
  if (closed.announcedOn !== 'ended') {
    return {
      verdict: 'moved',
      why: `closed-before-init: announced on session:${String(closed.announcedOn)}, not as the conversation ended`,
    }
  }
  if (closed.resumed !== true) {
    return {
      verdict: 'moved',
      why: 'closed-before-init: a reopen by the announced ref took no turn under that ref',
    }
  }

  // ⚑ The control, one fact over: no id asked, so the product has nothing to name (`717`).
  if (none.asked !== null) {
    return {
      verdict: 'not-performed',
      why: 'named-none: the launch still asked for an id — not the control',
    }
  }
  if (none.announced !== null) {
    return {
      verdict: 'moved',
      why: `named-none: the product announced ${none.announced} with no id of its own to announce`,
    }
  }

  if (neverSent.transcripts.length > 0 || neverSent.announced !== null) {
    return {
      verdict: 'moved',
      why: 'never-sent: a launch that sent nothing left a transcript or a ref',
    }
  }
  return { verdict: 'names-its-own' }
}
