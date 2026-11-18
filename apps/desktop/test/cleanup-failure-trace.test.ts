import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TestContext } from 'vitest'
import { cleanupAndReportFailures } from './helpers/cleanup-failure-trace'

describe('cleanup failure reporting', { sequential: true, shuffle: false }, () => {
  const output: string[] = []
  const failures: { test: string; errors: string[] }[] = []
  const rememberFailure = (context: TestContext) => {
    context.onTestFailed(({ task }) => {
      failures.push({
        test: task.name,
        errors: task.result?.errors?.map((error) => String(error.message)) ?? [],
      })
    })
  }

  beforeAll(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk))
      return true
    })
  })
  afterAll(() => vi.restoreAllMocks())

  describe('controlled outcomes', () => {
    afterEach(async (context) => {
      await cleanupAndReportFailures(
        context,
        [
          { closeAll: async () => {} },
          {
            closeAll: async () => {
              if (context.task.name === 'cleanup rejects')
                throw new Error('original cleanup rejection')
              if (context.task.name === 'cleanup never returns') await new Promise(() => {})
            },
          },
        ],
        { close: () => {} },
        [],
      )
    }, 10000)

    it('passes quietly', () => {})
    it.fails('body fails but cleanup succeeds quietly', (context) => {
      rememberFailure(context)
      expect('body').toBe('failure')
    })
    it.fails('cleanup rejects', (context) => rememberFailure(context))
    it.fails('cleanup never returns', (context) => rememberFailure(context))
  })

  it('retains original errors and reports only the two failed cleanup stages', () => {
    expect(failures.map((failure) => failure.test)).toEqual([
      'body fails but cleanup succeeds quietly',
      'cleanup rejects',
      'cleanup never returns',
    ])
    expect(failures[0]!.errors.join('\n')).toContain('body')
    expect(failures[1]!.errors).toContain('original cleanup rejection')
    expect(failures[2]!.errors.join('\n')).toContain('Hook timed out in 10000ms')
    const records = output
      .filter((line) => line.startsWith('CLEANUP_FAILED '))
      .map(
        (line) =>
          JSON.parse(line.slice('CLEANUP_FAILED '.length)) as {
            test: string
            stages: { stage: string; index: number }[]
          },
      )
    expect(records.map((record) => record.test)).toEqual([
      'cleanup rejects',
      'cleanup never returns',
    ])
    expect(records[0]!.stages.at(-1)).toMatchObject({ stage: 'host-close-settled', index: 1 })
    expect(records[1]!.stages.at(-1)).toMatchObject({ stage: 'host-close-entry', index: 1 })
  })
})
