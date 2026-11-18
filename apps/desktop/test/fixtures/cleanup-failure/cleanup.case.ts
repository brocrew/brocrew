import { afterEach, expect, it } from 'vitest'
import { cleanupAndReportFailures } from '../../helpers/cleanup-failure-trace'

afterEach(async (context) => {
  await cleanupAndReportFailures(
    context,
    [
      { closeAll: async () => {} },
      {
        closeAll: async () => {
          if (context.task.name === 'cleanup rejects') throw new Error('original cleanup rejection')
          if (context.task.name === 'cleanup never returns') await new Promise(() => {})
        },
      },
    ],
    { close: () => {} },
    [],
  )
}, 10000)

it('passes quietly', () => {})
it('body fails but cleanup succeeds quietly', () => expect('body').toBe('failure'))
it('cleanup rejects', () => {})
it('cleanup never returns', () => {})
