import type { Provider } from '@brobot2/shared'

/**
 * 🔴 **W4.164 · F093 R1 — one turn as the model got it, read from the provider's own file**: Claude
 * Code's transcript (`<home>/projects/<folder>/<session>.jsonl`) or Codex's rollout
 * (`<home>/sessions/…/rollout-….jsonl`), found the way the app finds them for an import. When the
 * file is gone, nothing else holds a copy.
 *
 * ⚑ **Exact where the provider kept it exact**: the message as BroBot handed it over; on Claude, each
 * of Claude Code's reminders and context records as it rendered them (`rendered`); on Codex, its
 * developer and user messages as sent, and its base prompt. ⚑ **Never dropped**: a record this build
 * does not know is kept raw, under its own name. ⛔ Read only, and only that one file.
 *
 * ⛔ **W4.172 · a window reaches it only inside `whatTheModelGot`** (`ipc.ts`): a person's read,
 * refused while the app quits. It has no channel of its own.
 */

/** Who wrote a part of the turn. */
export type AsSentAuthor =
  /** The message as BroBot handed it over: its lines and the words. */
  | 'the-message'
  /** The provider's own addition: a reminder, a context record, a developer message. */
  | 'the-provider'

/** One part of the turn, as the model got it. */
export interface AsSentPart {
  readonly author: AsSentAuthor
  /** The provider's own name for it: `environment`, `deferred_tools_delta`, `developer`… */
  readonly label: string
  /**
   * ⚑ **W4.177 — what it is, in plain words**, for a part this build knows: *"Today's date"*, *"The
   * skills Codex offers"*. ⚑ Draw it in place of {@link label} when it is there; absent for a part
   * this build does not know, whose provider name is then all there is.
   */
  readonly title?: string
  /** The role it was sent in: `user`, `system`, `developer`. */
  readonly role: string
  readonly text: string
}

/**
 * ⚑ **How Claude Code's context sections reached the model** (its environment, skills, sub-agent
 * types, date…). Its transcript keeps each wrapped as a reminder whichever way it went, so the way is
 * read from this build's snapshot of the model the turn's answer names:
 *  - `context-message`: a model that takes a context message got them in it, unwrapped, after the
 *    message — so they are shown that way;
 *  - `reminders`: a model that takes none got them wrapped, at the head of the message, among the
 *    other reminders — so they are shown that way;
 *  - `not-known`: no snapshot of that model, or no answer to name it; they are shown as the record
 *    keeps them, and {@link said} says either is possible.
 */
export interface ContextSectionsPlacement {
  readonly as: 'context-message' | 'reminders' | 'not-known'
  /** The model the turn's answer names, or `null` when there is no answer yet. */
  readonly model: string | null
  /** In plain words, how they reached it. */
  readonly said: string
}

/** A record of the turn that was not sent to the model, or one this build cannot read. */
export interface AsSentRecord {
  /** The record's own type (and subtype), as the provider wrote it. */
  readonly label: string
  /** Known bookkeeping the provider keeps for itself, or a record this build does not know. */
  readonly kind: 'not-sent' | 'unknown'
  /** The record as written, for one this build does not know; `null` for known bookkeeping. */
  readonly raw: unknown
}

/**
 * What reached the model that a provider's record of a turn holds none of.
 *  - `the-system-prompt`: no system prompt was read. Claude Code's transcript keeps none; Codex's
 *    rollout keeps its base prompt, in `standing`.
 *  - `after-its-first-answer`: what the model got later in the turn, such as tool results and the
 *    provider's later additions. This app reads a turn only up to the model's first answer.
 */
export type WhatTheRecordLeavesOut = 'the-system-prompt' | 'after-its-first-answer'

/** The answer for one turn. */
export type TurnAsSent =
  | {
      readonly found: true
      readonly provider: Provider
      /** The provider's version as its file names it (`2.1.287`, `0.160.0`), when it does. */
      readonly version: string | null
      /** Whether the file holds the turn to the model's answer; `false` for one still going on. */
      readonly whole: boolean
      /**
       * The message as BroBot handed it over, exactly — or, for a conversation brought in from
       * elsewhere, which BroBot never handed anything over to, the message as the record keeps it.
       */
      readonly message: string
      /**
       * Everything of the turn that reached the model, in the order it got it: on Claude, the
       * reminders at the head of the message, the message, then the context message's sections
       * ({@link contextSections} says how they reached this model); on Codex, each block of each
       * message as sent.
       */
      readonly parts: readonly AsSentPart[]
      /**
       * ⚑ **On Claude, how the sections Claude Code renders in the system's role reached the model** —
       * absent when the turn has none, and on Codex.
       */
      readonly contextSections?: ContextSectionsPlacement
      /** Codex: what stands in front of every request of this conversation (its base prompt). */
      readonly standing: readonly AsSentPart[]
      /** What reached the model that this record holds none of. */
      readonly leavesOut: readonly WhatTheRecordLeavesOut[]
      readonly records: readonly AsSentRecord[]
    }
  | { readonly found: false; readonly why: string }
