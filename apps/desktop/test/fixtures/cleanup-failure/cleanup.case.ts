import { afterEach, expect, it } from 'vitest'
import { cleanupFailureTrace } from '../../helpers/cleanup-failure-trace'

afterEach(async (context) => {
  const trace = cleanupFailureTrace(context)
  trace('host-close-entry', 1)
  if (context.task.name === 'cleanup rejects') throw new Error('original cleanup rejection')
  if (context.task.name === 'cleanup never returns') await new Promise(() => {})
  trace('host-close-settled', 1)
  trace('hook-return')
}, 10000)

it('passes quietly', () => {})
it('body fails but cleanup succeeds quietly', () => expect('body').toBe('failure'))
it('cleanup rejects', () => {})
it('cleanup never returns', () => {})
