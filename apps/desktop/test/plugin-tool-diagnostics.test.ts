import { afterEach, expect, it } from 'vitest'
import { recordPluginToolFailure } from '../src/main/plugins/tool-diagnostics'
import { captureLog } from './lib/log-file'

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})
async function fixture() {
  const log = await captureLog()
  closers.push(log.close)
  return log
}

it('logs failures for any plugin ID without filtering the reason at runtime', async () => {
  const log = await fixture()
  recordPluginToolFailure('chrome', 'proof-rejected')
  recordPluginToolFailure('chrome', 'cancelled')
  recordPluginToolFailure('fictional-private-page', 'proof-rejected')
  recordPluginToolFailure('chrome', 'fictional-private-error' as never)
  const lines = await log.lines(4)
  expect(lines).toHaveLength(4)
  expect(lines[0]).toMatch(/\[warn\]\s+\(plugin-tool\) proof-rejected .*plugin: 'chrome'/)
  expect(lines[1]).toContain('cancelled')
  expect(lines[2]).toContain("plugin: 'fictional-private-page'")
  expect(lines[3]).toContain('fictional-private-error')
})

it('retains content-free unknown completion and its host-exit resolution', async () => {
  const log = await fixture()
  const call = {
    callId: '11111111-2222-4333-8444-555555555555',
    tool: 'screenshot',
    startedAt: '2026-11-10T13:00:00.000Z',
    lastStage: 'page-ready' as const,
    state: 'completion-unknown' as const,
    hostRun: 'fictional-host-run',
  }
  recordPluginToolFailure('chrome', 'call-state', call)
  recordPluginToolFailure('chrome', 'call-state', { ...call, state: 'host-exited' })
  const lines = await log.lines(2)
  expect(lines).toHaveLength(2)
  for (const [index, expected] of [call, { ...call, state: 'host-exited' }].entries())
    for (const [key, value] of Object.entries(expected))
      expect(lines[index]).toContain(`${key}: '${value}'`)
})

it('logs the stage, cause and correlation of a failure, and its real error message on the same line', async () => {
  const log = await fixture()
  const correlation = '11111111-2222-4333-8444-555555555555'
  recordPluginToolFailure('chrome', 'binding-failed', {
    stage: 'binding-connect',
    cause: 'io-denied',
    correlation,
    reason: 'fictional connect refused <- inner fictional cause',
  })
  const lines = await log.lines(1)
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain("stage: 'binding-connect'")
  expect(lines[0]).toContain("cause: 'io-denied'")
  expect(lines[0]).toContain(correlation)
  expect(lines[0]).toContain('fictional connect refused <- inner fictional cause')
})
