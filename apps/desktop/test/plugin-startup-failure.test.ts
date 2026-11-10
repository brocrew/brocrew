import {
  pluginUnavailableNotice,
  pluginStartupDiagnosticNotice,
  PluginStartupDiagnosticSchema,
} from '../src/shared/plugin-settings'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import {
  createPluginStartupTrace,
  PluginStartupError,
  PluginSupervisorLaunchFailure,
  observePluginSupervisorLaunch,
  pluginStartupDiagnostic,
  pluginFailureCause,
  pluginStartupStderr,
  pluginStartupReason,
  recordPluginStartupFailure,
} from '../src/main/plugins/startup-failure'
import { PluginSupervisorError } from '../src/main/plugins/supervisor/protocol'
import { randomUUID } from 'node:crypto'
import { captureLog } from './lib/log-file'
const captures: Awaited<ReturnType<typeof captureLog>>[] = []
async function capture() {
  const one = await captureLog()
  captures.push(one)
  return one
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const one of captures.splice(0)) await one.close()
})
it('retains the failed phase through supervisor wrappers without exposing arbitrary messages', () => {
  const error = new PluginSupervisorError('unavailable', {
    cause: new PluginStartupError('runtime', new Error('fictional secret')),
  })
  expect(pluginStartupReason(error, 'service-start')).toBe('runtime')
  expect(pluginStartupReason({ code: 'busy' }, 'service-start')).toBe('cleanup-pending')
  expect(pluginUnavailableNotice(pluginStartupReason({ code: 'busy' }, 'service-start'))).toContain(
    'busy',
  )
  expect(pluginStartupReason({ code: 'incompatible' }, 'service-start')).toBe('service-version')
  expect(pluginStartupReason(new Error('fictional secret'), 'connection')).toBe('connection')
})
it.each(['blocked', 'draining'] as const)(
  'keeps a legacy typed %s recovery refusal factual without prescribing a reboot',
  (phase) => {
    const error = new PluginSupervisorError('cleanup-pending', {
      ownerEpoch: randomUUID(),
      diagnostic: { phase, stage: 'recovery', probe: 'no-answer', reason: 'restart-required' },
    })
    expect(pluginStartupReason(error, 'service-start')).toBe('cleanup-pending')
    expect(pluginUnavailableNotice(pluginStartupReason(error, 'service-start'))).toBe(
      'The plugin service is busy or still stopping. Wait a moment, then try again.',
    )
    expect(pluginStartupDiagnostic(error)?.stderr).toContain(`phase=${phase}`)
    expect(pluginStartupDiagnostic(error)?.stderr).toContain('reason=proof-pending')
    expect(pluginStartupDiagnostic(error)?.stderr).not.toContain('Restart your computer')
    expect(pluginStartupDiagnostic(error)?.stderr).not.toContain('Start > Power > Restart')
  },
)
it.each(['accepting', 'missing', 'unreadable', 'stopped'] as const)(
  'never projects a %s restart label into reboot advice',
  (phase) => {
    const error = new PluginSupervisorError('cleanup-pending', {
      ownerEpoch: randomUUID(),
      diagnostic: { phase, stage: 'recovery', probe: 'no-answer', reason: 'restart-required' },
    })
    expect(pluginStartupReason(error, 'service-start')).toBe('cleanup-pending')
    expect(pluginStartupDiagnostic(error)?.stderr).not.toContain('Restart your computer')
    expect(pluginStartupDiagnostic(error)?.stderr).not.toContain('Start > Power > Restart')
  },
)
it.each(['blocked', 'draining'] as const)(
  'keeps an unproven typed %s restart diagnostic generic in Settings and the log',
  (phase) => {
    const error = new PluginSupervisorError('cleanup-pending', {
      diagnostic: { phase, stage: 'recovery', probe: 'no-answer', reason: 'restart-required' },
    })
    expect(pluginStartupReason(error, 'service-start')).toBe('cleanup-pending')
    expect(pluginStartupDiagnostic(error)?.stderr).toContain('reason=proof-pending')
    expect(pluginStartupDiagnostic(error)?.stderr).not.toContain('Restart your computer')
    expect(pluginStartupDiagnostic(error)?.stderr).not.toContain('Start > Power > Restart')
  },
)
it('does not turn a stderr lookalike into a typed reboot remedy', () => {
  const error = new PluginSupervisorLaunchFailure({
    exitCode: 1,
    signal: null,
    stderr: 'phase=blocked stage=recovery probe=no-answer reason=restart-required',
  })
  expect(pluginStartupReason(error, 'service-start')).toBe('service-start')
})
it('logs a readable line with an errno and no raw message or configuration', async () => {
  const log = await capture()
  recordPluginStartupFailure('service-start', {
    cause: { code: 'EACCES', message: 'fictional-secret-key-and-path' },
  })
  recordPluginStartupFailure('connection')
  const lines = await log.lines(2)
  expect(lines[0]).toContain("service-start: BroCrew couldn't start the plugin service.")
  expect(lines[0]).toContain('(EACCES)')
  expect(lines[0]).not.toContain('fictional-secret-key-and-path')
  expect(lines[1]).not.toContain('(EACCES)')
})

it('retains a split first stderr line and real child exit through wrappers into the same log text', async () => {
  const stderr = Object.assign(new EventEmitter(), { unref: vi.fn() })
  const child = { stderr, exitCode: null as number | null, signalCode: null }
  const snapshot = observePluginSupervisorLaunch(child as unknown as ChildProcess)
  stderr.emit('data', Buffer.from('Error: fictional bridge could not bind; personKey=fictional-'))
  stderr.emit('data', Buffer.from('capability\nsecond private stack line'))
  child.exitCode = 17
  const wrapped = new PluginStartupError('service-start', snapshot())
  const diagnostic = pluginStartupDiagnostic(wrapped)!
  expect(diagnostic).toEqual({
    exitCode: 17,
    signal: null,
    stderr: 'Error: fictional bridge could not bind; personKey=fictional-capability',
  })
  expect(PluginStartupDiagnosticSchema.safeParse(diagnostic).success).toBe(true)
  expect(stderr.unref).toHaveBeenCalledOnce()
  stderr.emit('data', Buffer.alloc(100_000, 'x'))
  expect(pluginStartupDiagnostic(snapshot())).toEqual(diagnostic)
  const captured = await capture()
  recordPluginStartupFailure('service-start', wrapped)
  await vi.waitFor(async () => expect(await captured.text()).toContain('second private stack line'))
  const log = await captured.text()
  expect(log).toContain(pluginStartupDiagnosticNotice(diagnostic))
  expect(log).toContain('fictional-capability')
  expect(diagnostic.stderr).not.toContain('second private stack line')
  expect(log).toContain('second private stack line')
})
it('does not invent a child exit or stderr at an attachment timeout and bounds escaped text', () => {
  const snapshot = observePluginSupervisorLaunch({
    exitCode: null,
    signalCode: null,
    stderr: null,
  } as unknown as ChildProcess)
  expect(pluginStartupDiagnostic(snapshot())).toEqual({
    exitCode: null,
    signal: null,
    stderr: null,
  })
  expect(pluginStartupDiagnosticNotice(pluginStartupDiagnostic(snapshot())!)).toBe(
    'Exit code not reported. No stderr was reported.',
  )
  expect(pluginStartupStderr('\u001b[31mError: denied token=fictional-token\u202e')).toBe(
    'Error: denied token=fictional-token',
  )
  expect(pluginStartupStderr('x'.repeat(2000))).toHaveLength(512)
})

it('keeps the real multiline startup error after a loader preamble in Settings and the log', async () => {
  const stderr = Object.assign(new EventEmitter(), { unref: vi.fn() })
  const child = { stderr, exitCode: 1, signalCode: null }
  const snapshot = observePluginSupervisorLaunch(child as unknown as ChildProcess)
  stderr.emit('data', Buffer.from('node:internal/modules/cjs/loader:2142\n  throw error;\n'))
  stderr.emit('data', Buffer.from(' '.repeat(5000)))
  stderr.emit('data', Buffer.from("\nError: Cannot find module 'fictional-missing-module'\n"))
  stderr.emit('data', Buffer.from('Require stack:\n- /fictional/service/entry.cjs\n'))
  stderr.emit('data', Buffer.from('personKey=fictional-key\n    at startup (entry.cjs:12:3)\n'))
  stderr.emit('end')
  const failure = snapshot()
  expect(pluginStartupDiagnostic(failure)?.stderr).toBe(
    "Error: Cannot find module 'fictional-missing-module'",
  )
  const captured = await capture()
  recordPluginStartupFailure('service-start', failure)
  await vi.waitFor(async () => expect(await captured.text()).toContain('at startup'))
  const log = await captured.text()
  expect(log).toContain("Error: Cannot find module 'fictional-missing-module'")
  expect(log).toContain('Require stack:')
  expect(log).toContain('/fictional/service/entry.cjs')
  expect(log).toContain('at startup (entry.cjs:12:3)')
  expect(log).toContain('fictional-key')
})

it('keeps hashes and credential-shaped error text while stripping terminal escapes', () => {
  const hash = 'abcd1234'.repeat(8)
  const escaped = hash.match(/.{16}/g)!.join('\u001b[0m')
  const message = `Error: ${escaped} Bearer fictional-key token=fictional-token`
  expect(pluginStartupStderr(message)).toBe(
    `Error: ${hash} Bearer fictional-key token=fictional-token`,
  )
  const bounded = pluginStartupStderr('x'.repeat(511) + '😀')!
  expect(bounded).toBe('x'.repeat(511) + '…')
  expect(PluginStartupDiagnosticSchema.shape.stderr.safeParse(bounded).success).toBe(true)
})
it('drains stderr after exit before retaining the failure, within the original launch deadline', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  try {
    const stderr = Object.assign(new EventEmitter(), {
      unref: vi.fn(),
      readableEnded: false,
      destroyed: false,
    })
    const child = { stderr, exitCode: 17, signalCode: null }
    const snapshot = observePluginSupervisorLaunch(child as unknown as ChildProcess)
    let settled = false
    const draining = snapshot.drainUntil(performance.now() + 100).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(20)
    expect(settled).toBe(false)
    stderr.emit('data', Buffer.from('Error: fictional late pipe failure\n'))
    stderr.emit('end')
    await draining
    expect(pluginStartupDiagnostic(snapshot())?.stderr).toBe('Error: fictional late pipe failure')
    expect(pluginStartupDiagnostic(snapshot())?.exitCode).toBe(17)
    const stuck = observePluginSupervisorLaunch({
      ...child,
      stderr: new EventEmitter(),
    } as unknown as ChildProcess)
    const timed = stuck.drainUntil(performance.now() + 100)
    await vi.advanceTimersByTimeAsync(100)
    await timed
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('catalogue logs include stage and nested causes only on that path', async () => {
  const captured = await capture()
  const original = new Error('owner-invalidated token=fictional-token\u001b[31m', {
    cause: new Error('broker closed password=fictional-password'),
  })
  recordPluginStartupFailure(
    'catalogue-response',
    new PluginStartupError('catalogue-response', original, 'rpc'),
  )
  recordPluginStartupFailure('connection', original)
  const [first, second] = await captured.lines(2)
  expect(first).toContain('stage=rpc')
  expect(first).toContain('owner-invalidated')
  expect(first).toContain('broker closed')
  expect(first).toContain('token=fictional-token')
  expect(first).toContain('password=fictional-password')
  expect(first).not.toContain(String.fromCharCode(27))
  expect(second).not.toContain('owner-invalidated')
})
it('cause formatting bounds cycles and survives hostile diagnostic properties', () => {
  const cyclic = new Error('owner-invalidated')
  cyclic.cause = cyclic
  expect(pluginFailureCause(cyclic)).toContain('owner-invalidated')
  // An aggregate that contains itself is named once, not walked without end.
  const members: unknown[] = []
  const loop = new AggregateError(members, 'fictional loop')
  Object.defineProperty(loop, 'errors', { value: [loop] })
  expect(pluginFailureCause(loop)).toContain('fictional loop')
  expect(
    pluginFailureCause(new Error('x'.repeat(10000), { cause: new Error('actual leaf') })).length,
  ).toBeLessThanOrEqual(512)
  expect(
    pluginFailureCause(new Error('x'.repeat(10000), { cause: new Error('actual leaf') })),
  ).toContain('actual leaf')
  const hostile = Object.defineProperty({}, 'message', {
    get() {
      throw new Error('getter')
    },
  })
  expect(() => pluginFailureCause(hostile)).not.toThrow()
})
it('cause diagnostics keep the real error text, including addresses and paths', () => {
  const value = pluginFailureCause(
    new Error('http://127.0.0.1:8123/mcp /fictional/private sdk-body-contents'),
  )
  expect(value).toBe('Error: http://127.0.0.1:8123/mcp /fictional/private sdk-body-contents')
})
it('catalogue logs retain the typed refusal code when its public Error message is generic', async () => {
  const captured = await capture()
  recordPluginStartupFailure('catalogue-response', new PluginSupervisorError('policy-refused'))
  const log = (await captured.lines(1)).join('\n')
  expect(log).toContain('PluginSupervisorError')
  expect(log).toContain('code=policy-refused')
})

it('logs pre-controller time, nested phases and failures across retries', async () => {
  const captured = await capture()
  let now = 100
  const trace = createPluginStartupTrace(() => now)
  const recovery = trace.begin('workspace-recovery')
  now += 78_000
  recovery()
  trace.attempt()
  const catalogue = trace.begin('catalogue')
  now += 5000
  const failed = new PluginSupervisorLaunchFailure({
    exitCode: 1,
    signal: null,
    stderr: 'Error: missing module',
  })
  catalogue(failed)
  recordPluginStartupFailure('service-start', failed)
  trace.failure('service-start', failed)
  trace.attempt()
  trace.begin('catalogue-new-owner')()
  trace.begin('ready')()
  await vi.waitFor(async () => expect(await captured.text()).toContain('ready end'))
  const log = await captured.text()
  expect(log).toMatch(/workspace-recovery start.*elapsed: 0, attempt: 0/)
  expect(log).toMatch(/workspace-recovery end.*elapsed: 78000, attempt: 0/)
  expect(log).toMatch(/catalogue failure.*elapsed: 83000, attempt: 1/)
  expect(log).toMatch(/catalogue-new-owner end.*attempt: 2/)
  expect(log).toMatch(/ready end.*attempt: 2/)
  expect(log).toContain('Exit code 1')
  expect(log).toContain('Error: missing module')
})
