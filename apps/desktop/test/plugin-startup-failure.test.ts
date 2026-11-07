import {
  pluginUnavailableNotice,
  pluginStartupDiagnosticNotice,
  PluginStartupDiagnosticSchema,
} from '../src/shared/plugin-settings'
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
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
  'projects a typed eligible %s reboot refusal into the computer restart remedy',
  (phase) => {
    const error = new PluginSupervisorError('cleanup-pending', {
      ownerEpoch: randomUUID(),
      diagnostic: { phase, stage: 'recovery', probe: 'no-answer', reason: 'restart-required' },
    })
    expect(pluginStartupReason(error, 'service-start')).toBe('restart-required')
    expect(pluginUnavailableNotice(pluginStartupReason(error, 'service-start'))).toBe(
      'Restart your computer, then reopen BroCrew.',
    )
    expect(pluginStartupDiagnostic(error)?.stderr).toContain(`phase=${phase}`)
    if (process.platform === 'win32')
      expect(pluginStartupDiagnostic(error)?.stderr).toContain('Start > Power > Restart')
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
it('keeps a readable bounded log with an errno and no raw message or configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fictional-plugin-diagnostic-'))
  roots.push(root)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await recordPluginStartupFailure(root, 'service-start', {
    cause: { code: 'EACCES', message: 'fictional-secret-key-and-path' },
  })
  const log = await readFile(join(root, 'plugin-startup.log'), 'utf8')
  expect(log).toContain("service-start: BroCrew couldn't start the plugin service.")
  expect(log).toContain('(EACCES)')
  expect(log).not.toContain('fictional-secret-key-and-path')
  expect(log.length).toBeLessThan(1024)
  expect(warn).toHaveBeenCalledOnce()
  await recordPluginStartupFailure(root, 'connection')
  expect(await readFile(join(root, 'plugin-startup.log'), 'utf8')).not.toContain('(EACCES)')
})
it.skipIf(process.platform === 'win32')(
  'replaces a diagnostic symlink without writing its target',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'fictional-plugin-diagnostic-'))
    roots.push(root)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const target = join(root, 'untouched')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(target, 'fictional existing file')
    await symlink(target, join(root, 'plugin-startup.log'))
    await recordPluginStartupFailure(root, 'runtime')
    expect(await readFile(target, 'utf8')).toBe('fictional existing file')
    expect(await readFile(join(root, 'plugin-startup.log'), 'utf8')).toContain('runtime')
  },
)
it('a log write failure does not replace the original startup failure or prevent Retry', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(
    recordPluginStartupFailure(join(tmpdir(), 'fictional-absent', 'no-parent'), 'storage'),
  ).resolves.toBeUndefined()
})

it('retains a split first stderr line and real child exit through wrappers into the same log text', async () => {
  const stderr = Object.assign(new EventEmitter(), { unref: vi.fn() })
  const child = { stderr, exitCode: null as number | null, signalCode: null }
  const snapshot = observePluginSupervisorLaunch(child as unknown as ChildProcess, [
    'fictional-capability',
  ])
  stderr.emit('data', Buffer.from('Error: fictional bridge could not bind; personKey=fictional-'))
  stderr.emit('data', Buffer.from('capability\nsecond private stack line'))
  child.exitCode = 17
  const wrapped = new PluginStartupError('service-start', snapshot())
  const diagnostic = pluginStartupDiagnostic(wrapped)!
  expect(diagnostic).toEqual({
    exitCode: 17,
    signal: null,
    stderr: 'Error: fictional bridge could not bind; personKey=[redacted]',
  })
  expect(PluginStartupDiagnosticSchema.safeParse(diagnostic).success).toBe(true)
  expect(stderr.unref).toHaveBeenCalledOnce()
  stderr.emit('data', Buffer.alloc(100_000, 'x'))
  expect(pluginStartupDiagnostic(snapshot())).toEqual(diagnostic)
  const root = await mkdtemp(join(tmpdir(), 'fictional-plugin-exit-'))
  roots.push(root)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await recordPluginStartupFailure(root, 'service-start', wrapped)
  const log = await readFile(join(root, 'plugin-startup.log'), 'utf8')
  expect(log).toContain(pluginStartupDiagnosticNotice(diagnostic))
  expect(log).not.toContain('fictional-capability')
  expect(diagnostic.stderr).not.toContain('second private stack line')
  expect(log).toContain('second private stack line')
})
it('does not invent a child exit or stderr at an attachment timeout and bounds escaped text', () => {
  const snapshot = observePluginSupervisorLaunch(
    { exitCode: null, signalCode: null, stderr: null } as unknown as ChildProcess,
    [],
  )
  expect(pluginStartupDiagnostic(snapshot())).toEqual({
    exitCode: null,
    signal: null,
    stderr: null,
  })
  expect(pluginStartupDiagnosticNotice(pluginStartupDiagnostic(snapshot())!)).toBe(
    'Exit code not reported. No stderr was reported.',
  )
  expect(
    pluginStartupStderr('\u001b[31mError: denied token=fictional-token\u202e' + 'x'.repeat(2000)),
  ).toBe('Error: denied token=[redacted]')
  expect(pluginStartupStderr('x'.repeat(2000))).toHaveLength(512)
})

it('keeps the real multiline startup error after a loader preamble in Settings and the log', async () => {
  const stderr = Object.assign(new EventEmitter(), { unref: vi.fn() })
  const child = { stderr, exitCode: 1, signalCode: null }
  const snapshot = observePluginSupervisorLaunch(child as unknown as ChildProcess, [
    'fictional-key',
  ])
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
  const root = await mkdtemp(join(tmpdir(), 'fictional-full-stderr-'))
  roots.push(root)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await recordPluginStartupFailure(root, 'service-start', failure)
  const log = await readFile(join(root, 'plugin-startup.log'), 'utf8')
  expect(log).toContain("Error: Cannot find module 'fictional-missing-module'")
  expect(log).toContain('Require stack:\n- /fictional/service/entry.cjs')
  expect(log).toContain('at startup (entry.cjs:12:3)')
  expect(log).not.toContain('fictional-key')
})

it('redacts a capability split by terminal escapes before display normalization', () => {
  const capability = 'abcd1234'.repeat(8)
  const escaped = capability.match(/.{16}/g)!.join('\u001b[0m')
  expect(pluginStartupStderr(`Error: ${escaped}`, [capability])).toBe('Error: [redacted]')
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
    const snapshot = observePluginSupervisorLaunch(child as unknown as ChildProcess, [])
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
    const stuck = observePluginSupervisorLaunch(
      { ...child, stderr: new EventEmitter() } as unknown as ChildProcess,
      [],
    )
    const timed = stuck.drainUntil(performance.now() + 100)
    await vi.advanceTimersByTimeAsync(100)
    await timed
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('catalogue logs include stage and bounded sanitized nested causes only on that path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fictional-catalogue-cause-'))
  roots.push(root)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const original = new Error('owner-invalidated token=fictional-token\u001b[31m', {
    cause: new Error('broker closed password=fictional-password'),
  })
  await recordPluginStartupFailure(
    root,
    'catalogue-response',
    new PluginStartupError('catalogue-response', original, 'rpc'),
  )
  const log = await readFile(join(root, 'plugin-startup.log'), 'utf8')
  expect(log).toContain('stage=rpc')
  expect(log).toContain('owner-invalidated')
  expect(log).toContain('broker closed')
  expect(log).not.toMatch(/fictional-token|fictional-password/)
  expect(log).not.toContain(String.fromCharCode(27))
  expect(log.length).toBeLessThan(1024)
  await recordPluginStartupFailure(root, 'connection', original)
  expect(await readFile(join(root, 'plugin-startup.log'), 'utf8')).not.toContain(
    'owner-invalidated',
  )
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
  const root = await mkdtemp(join(tmpdir(), 'fictional-typed-catalogue-error-'))
  roots.push(root)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await recordPluginStartupFailure(
    root,
    'catalogue-response',
    new PluginSupervisorError('policy-refused'),
  )
  const log = await readFile(join(root, 'plugin-startup.log'), 'utf8')
  expect(log).toContain('PluginSupervisorError')
  expect(log).toContain('code=policy-refused')
})

it('retains pre-controller time, nested phases and failures across retries and later writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fictional-startup-trace-'))
  roots.push(root)
  let now = 100
  const trace = createPluginStartupTrace(() => now)
  const recovery = trace.begin('workspace-recovery')
  now += 78_000
  recovery()
  trace.destination(root)
  trace.attempt()
  const catalogue = trace.begin('catalogue')
  now += 5000
  const failed = new PluginSupervisorLaunchFailure({
    exitCode: 1,
    signal: null,
    stderr: 'Error: missing module',
  })
  catalogue(failed)
  await recordPluginStartupFailure(root, 'service-start', failed)
  trace.failure('service-start', failed)
  trace.attempt()
  trace.begin('catalogue-new-owner')()
  trace.begin('ready')()
  await trace.flush()
  const log = await readFile(join(root, 'plugin-startup-trace.log'), 'utf8')
  expect(log).toMatch(/launch=.* elapsed=0 attempt=0 workspace-recovery start/)
  expect(log).toContain('elapsed=78000 attempt=0 workspace-recovery end')
  expect(log).toContain('elapsed=83000 attempt=1 catalogue failure')
  expect(log).toContain('attempt=2 catalogue-new-owner end')
  expect(log).toContain('attempt=2 ready end')
  expect(log).toContain('Exit code 1')
  expect(log).toContain('Error: missing module')
  expect(await readFile(join(root, 'plugin-startup.log'), 'utf8')).toContain(
    'Error: missing module',
  )
})
it('trace write failure never rejects or prevents later startup work', async () => {
  const trace = createPluginStartupTrace()
  trace.destination(join(tmpdir(), 'fictional-absent', 'trace'))
  trace.begin('workspace-recovery')()
  await expect(trace.flush()).resolves.toBeUndefined()
  const root = await mkdtemp(join(tmpdir(), 'fictional-recovered-trace-'))
  roots.push(root)
  trace.destination(root)
  trace.attempt()
  trace.begin('ready')()
  await expect(trace.flush()).resolves.toBeUndefined()
  const log = await readFile(join(root, 'plugin-startup-trace.log'), 'utf8')
  expect(log).toContain('attempt=0 workspace-recovery end')
  expect(log).toContain('attempt=1 ready end')
})
