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
  PluginStartupError,
  PluginSupervisorLaunchFailure,
  observePluginSupervisorLaunch,
  pluginStartupDiagnostic,
  pluginStartupStderr,
  pluginStartupReason,
  recordPluginStartupFailure,
} from '../src/main/plugins/startup-failure'
import { PluginSupervisorError } from '../src/main/plugins/supervisor/protocol'
import { randomUUID } from 'node:crypto'
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
it.each(['win32', 'darwin', 'linux'] as const)(
  'adds fixed restart directions only on %s for fully eligible typed refusals',
  (platform) => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: platform } }))
    for (const phase of ['blocked', 'draining'] as const) {
      const epoch = randomUUID()
      const error = new PluginSupervisorError('cleanup-pending', {
        ownerEpoch: epoch,
        diagnostic: { phase, stage: 'recovery', probe: 'no-answer', reason: 'restart-required' },
      })
      const diagnostic = pluginStartupDiagnostic(error)!
      expect(diagnostic).toEqual({
        exitCode: null,
        signal: null,
        stderr: `phase=${phase} stage=recovery probe=no-answer reason=restart-required${platform === 'win32' ? '; Start > Power > Restart' : ''}`,
      })
      expect(PluginStartupDiagnosticSchema.safeParse(diagnostic).success).toBe(true)
      expect(diagnostic.stderr).not.toContain(epoch)
      expect(pluginUnavailableNotice(pluginStartupReason(error, 'service-start'))).toBe(
        'Restart your computer, then reopen BroCrew.',
      )
    }
  },
)
it.each([
  ...(['attach-record', 'hello', 'detach', 'lease-lost'] as const).map((stage) => ({ stage })),
  ...(['live', 'unknown'] as const).map((probe) => ({ probe })),
  ...(
    [
      'duplicate-workspace',
      'capacity',
      'drain-timeout',
      'proof-pending',
      'released-owner-stalled',
      'io',
      'unknown',
    ] as const
  ).map((reason) => ({ reason })),
])('does not advise restarting for a noneligible typed diagnostic %j', (override) => {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
  const error = new PluginSupervisorError('cleanup-pending', {
    ownerEpoch: randomUUID(),
    diagnostic: {
      phase: 'blocked',
      stage: 'recovery',
      probe: 'no-answer',
      reason: 'restart-required',
      ...override,
    },
  })
  expect(pluginStartupReason(error, 'service-start')).toBe('cleanup-pending')
  expect(pluginStartupDiagnostic(error)?.stderr).not.toContain('Start > Power > Restart')
  expect(PluginStartupDiagnosticSchema.safeParse(pluginStartupDiagnostic(error)).success).toBe(true)
})
it.each([
  'unavailable',
  'busy',
  'incompatible',
  'unsupported',
  'policy-refused',
  'source-mismatch',
  'network',
] as const)('does not advise restarting for a typed %s refusal with a restart label', (code) => {
  vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
  const error = new PluginSupervisorError(code, {
    ownerEpoch: randomUUID(),
    diagnostic: {
      phase: 'blocked',
      stage: 'recovery',
      probe: 'no-answer',
      reason: 'restart-required',
    },
  })
  expect(pluginStartupReason(error, 'service-start')).not.toBe('restart-required')
  expect(pluginStartupDiagnostic(error)?.stderr).toContain('reason=proof-pending')
  expect(pluginStartupDiagnostic(error)?.stderr).not.toContain('Start > Power > Restart')
})
it.each(['accepting', 'missing', 'unreadable', 'stopped'] as const)(
  'never projects a %s restart label into reboot advice',
  (phase) => {
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
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
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
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
  expect(pluginStartupDiagnostic(error)?.stderr).not.toContain('Start > Power > Restart')
  expect(
    pluginStartupDiagnostic({
      code: 'cleanup-pending',
      ownerEpoch: randomUUID(),
      diagnostic: {
        phase: 'blocked',
        stage: 'recovery',
        probe: 'no-answer',
        reason: 'restart-required',
      },
    }),
  ).toBeUndefined()
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
  expect(log).not.toContain('second private stack line')
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

it('redacts a capability split by terminal escapes before display normalization', () => {
  const capability = 'abcd1234'.repeat(8)
  const escaped = capability.match(/.{16}/g)!.join('\u001b[0m')
  expect(pluginStartupStderr(`Error: ${escaped}`, [capability])).toBe('Error: [redacted]')
  const bounded = pluginStartupStderr('x'.repeat(511) + '😀')!
  expect(bounded).toBe('x'.repeat(511))
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
