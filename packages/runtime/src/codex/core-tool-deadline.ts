const CORE_APPROVAL_WAIT_MS = 24 * 60 * 60 * 1000
// Only a response grace period; it never extends the person's approval window.
const CORE_TOOL_REPLY_GRACE_SECONDS = 60
export const CORE_TOOL_WAIT_SECONDS = CORE_APPROVAL_WAIT_MS / 1000 + CORE_TOOL_REPLY_GRACE_SECONDS
export const CORE_APPROVAL_TIMEOUT =
  "Timed out waiting for the person's approval after 24 h; ask again if it's still needed."

// The native deadline has one minute to carry the app's settled answer, never to extend approval.
export function coreApprovalDeadline(parent: AbortSignal, waitMs = CORE_APPROVAL_WAIT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(CORE_APPROVAL_TIMEOUT), waitMs)
  timer.unref?.()
  return {
    signal: AbortSignal.any([parent, controller.signal]),
    timedOut: () => controller.signal.aborted,
    clear: () => clearTimeout(timer),
  }
}
