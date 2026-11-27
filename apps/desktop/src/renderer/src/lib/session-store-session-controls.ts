import { readableError, reopenAtLatest } from './session-record'
import type { SessionCommands } from './session-store-commands'
import type { SessionStore } from './session-store-contract'

/** Controls on one open conversation: jumping to the latest, closing, compacting and its settings. */
export function createSessionControls(
  commands: Pick<
    SessionCommands,
    'approvalChoices' | 'bridge' | 'forSession' | 'forSessionSaying' | 'sessions'
  >,
): Pick<
  SessionStore,
  | 'jumpToLatest'
  | 'close'
  | 'compact'
  | 'refreshConfig'
  | 'setApprovalMode'
  | 'setSessionSetting'
  | 'endPlanMode'
> {
  const { approvalChoices, bridge, forSession, forSessionSaying, sessions } = commands
  return {
    async jumpToLatest(sessionId) {
      const record = sessions.get(sessionId)
      if (!record || record.window.atTail) return
      const { ok, value: page } = await forSession(sessionId, () =>
        bridge.latestHistory({ sessionId }),
      )
      if (!ok || !page) return
      const latest = sessions.get(sessionId)
      if (!latest) return
      // Re-read the newest page WHOLESALE rather than trying to reconcile what was missed. The
      // events counted in `behind` are in the ledger, so the page already contains them, and any
      // attempt to splice them onto a window that ends elsewhere would be inventing a contiguity
      // that is not there.
      reopenAtLatest(latest, page)
    },

    /**
     * Close it in the host. The terminal event comes back on the stream and moves the record to
     * `ended`, which drops it from the open list — the reopen list is where it shows up next,
     * rebuilt from its ledger rather than from anything held here.
     */
    async close(sessionId) {
      // ⚠️ **Said BEFORE the await, because the window it opens is the whole point** (089). Teardown
      // drains and archives — 075 spent a task on it — and for all of that the provider still
      // reports `live`. That a close was asked for is the one fact only this side holds, and saying
      // it is what lets `sessionBeing` draw `closing` instead of a live blue line under a session on
      // its way out. It is deliberately NOT terminal: the row stays in the open list, because it is
      // still open.
      const asked = sessions.get(sessionId)
      // ⚠️ **`opening` counts, and leaving it out was a hole** (089 review). A conversation closed
      // before the host had finished describing it went `starting → ended` with no closing state at
      // all — and that is the case where teardown is most likely to take a visible moment, because
      // the host has to wait for the provider to arrive before it can stop it (`awaitArrival`).
      const was = asked?.phase
      if (was === 'open' || was === 'opening') asked!.phase = 'closing'
      const { ok } = await forSession(sessionId, () => bridge.close({ sessionId }))
      // Only if the host agreed. A close that failed leaves a session the host is still running,
      // and marking it ended here would hide a live conversation behind an error message.
      const record = sessions.get(sessionId)
      // The host's answer stands even if the record has gone from under us — `ok` is about the
      // close, not about whether anything is still here to mark.
      if (!record) return ok
      if (ok) record.phase = 'recorded'
      // ⚠️ **A refused close has to put the word back** — to whatever it was, not to `open` — or the
      // row draws a fading underline for a conversation that is still running and never stops. Only
      // from `closing`: the terminal event may have landed on the stream while this was awaiting,
      // and the fold's `ended` is the newer fact of the two.
      else if (record.phase === 'closing' && was !== undefined) record.phase = was
      return ok
    },

    async compact(sessionId) {
      if (sessions.has(sessionId)) {
        const { refused } = await forSessionSaying(sessionId, () => bridge.compact({ sessionId }))
        return refused === null ? null : readableError(refused)
      }
      try {
        await bridge.compact({ sessionId })
        return null
      } catch (cause) {
        return readableError(cause)
      }
    },

    async refreshConfig(sessionId) {
      const { value: config } = await forSession(sessionId, () =>
        bridge.refreshConfig({ sessionId }),
      )
      const record = sessions.get(sessionId)
      if (config && record?.meta) record.meta = { ...record.meta, config }
    },

    async setApprovalMode(sessionId, mode) {
      const record = sessions.get(sessionId)
      if (!record?.meta) return
      // The choice moves now; the current turn keeps its confirmed mode.
      const choice = { requested: mode, nativePending: record.meta.pendingApprovalMode }
      approvalChoices.set(sessionId, choice)
      record.meta = {
        ...record.meta,
        pendingApprovalMode: mode === record.meta.approvalMode ? null : mode,
      }
      const { value: disclosure } = await forSession(sessionId, () =>
        bridge.setApprovalMode({ sessionId, mode }),
      )
      if (approvalChoices.get(sessionId) !== choice) return
      approvalChoices.delete(sessionId)
      // Keep unrelated updates, and restore the latest native choice on refusal.
      if (record.meta)
        record.meta = disclosure
          ? { ...record.meta, ...disclosure }
          : { ...record.meta, pendingApprovalMode: choice.nativePending }
    },

    /**
     * Approve the plan and let the conversation get on with it (060).
     *
     * Nothing is written to the record here — deliberately. The state change comes back on the
     * liveness channel, which is the only source a second window watching the same conversation
     * has; optimistically clearing the flag would make a REFUSED go-ahead look like a successful
     * one, which is the same rule `setApprovalMode` above follows.
     */
    async setSessionSetting(sessionId, body, refusals = 'record') {
      if (!sessions.has(sessionId))
        return (await bridge.setSessionSetting({ sessionId, body })).thePick
      const { value: changed, refused } = await forSessionSaying(sessionId, () =>
        bridge.setSessionSetting({ sessionId, body }),
      )
      if (refused !== null && refusals === 'throw') throw refused
      const record = sessions.get(sessionId)
      if (changed && record?.meta) record.meta = { ...record.meta, settings: changed.settings }
      return changed?.thePick
    },
    async endPlanMode(sessionId, text) {
      // Spread rather than assigned, so leaving sends a payload with NO `text` key at all —
      // the same rule 065 applies to attribution: absent is the honest shape for "there is no
      // message", and an explicit `undefined` is a field claiming to have been considered.
      await forSession(sessionId, () =>
        bridge.endPlanMode({ sessionId, ...(text === undefined ? {} : { text }) }),
      )
    },
  }
}
