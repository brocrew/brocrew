import type { Locator } from 'playwright-core'
import { ToolError } from './schema.js'
import { describeError, type ToolDeps } from './common.js'

type Button = 'left' | 'right' | 'middle'
const remaining = (deadline: number): number => Math.max(1, deadline - Date.now())
/** Playwright's message continues with its call log; the outcome belongs on the first line. */
const outcome = (error: unknown, what: string): ToolError => {
  const [first, ...log] = describeError(error).split('\n')
  return new ToolError([`${first}; ${what}`, ...log].join('\n'))
}

/**
 * Playwright's checks run first with no input, so a failure there provably sent nothing. The
 * click itself stays Playwright's own, which only lets the event reach the checked element; when
 * it fails, whether it was dispatched cannot be observed.
 */
export async function clickElement(
  deps: ToolDeps,
  loc: Locator,
  input: { button: Button; clickCount: number },
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const options = { button: input.button, clickCount: input.clickCount }
  try {
    await loc.click({ ...options, trial: true, timeout: remaining(deadline) })
  } catch (error) {
    throw outcome(error, 'nothing was sent')
  }
  if (deps.signal?.aborted) throw new ToolError('cancelled; nothing was sent')
  try {
    await loc.click({ ...options, timeout: remaining(deadline) })
  } catch (error) {
    throw outcome(error, 'completion unknown')
  }
}
