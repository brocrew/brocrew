import { describe, expect, it } from 'vitest'
import { DidNotAnswerInTime, didNotAnswerInTime, withDeadline } from '../src/internal/bounded'

/**
 * # A wait that ran out is its own failure
 *
 * A caller that asks a provider a question bounds the wait. When the bound is what ended it, the
 * provider was too slow, and the next ask may find it answering; when the work itself failed,
 * something is wrong that asking again does not fix. The two are told apart by the failure's class,
 * never by its words.
 */
describe('a wait that ran out is its own failure', () => {
  const never = new Promise<never>(() => {})

  it('🔴 a deadline that expires rejects with its own class, and still says what was waited for', async () => {
    const failure = await withDeadline(never, 5, 'codex model/list').then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(DidNotAnswerInTime)
    expect((failure as Error).message).toBe('codex model/list did not answer within 5ms')
    expect(didNotAnswerInTime(failure)).toBe(true)
  })

  it('⚑ work that fails before its deadline fails as itself', async () => {
    const failed = new Error('codex app-server exited')
    const failure = await withDeadline(Promise.reject(failed), 1_000, 'codex initialize').then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBe(failed)
    expect(didNotAnswerInTime(failure)).toBe(false)
    // Words that sound like a time-out are not one.
    expect(didNotAnswerInTime(new Error('codex did not answer within 5ms'))).toBe(false)
    expect(didNotAnswerInTime('did not answer within 5ms')).toBe(false)
    expect(didNotAnswerInTime(undefined)).toBe(false)
  })

  it('🔴 it is found under a failure that wraps it', () => {
    const slow = new DidNotAnswerInTime('claude did not answer within 15000ms')
    const wrapped = new Error('could not list the models', { cause: slow })
    expect(didNotAnswerInTime(new Error('launch failed', { cause: wrapped }))).toBe(true)
    expect(didNotAnswerInTime(new Error('launch failed', { cause: new Error('exited') }))).toBe(
      false,
    )
  })

  it('⚑ a value that arrives in time is handed over', async () => {
    await expect(withDeadline(Promise.resolve('answered'), 1_000, 'codex')).resolves.toBe(
      'answered',
    )
  })
})
