import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderSetupState } from '../src/shared/provider-setup'
import {
  CLAUDE_SETUP_BOUNDS,
  ClaudeSetupService,
  officialAuthUrl,
  officialInstaller,
} from '../src/main/providers/claude/setup-service'
import { setupProcesses, type SetupProcessHost } from '../src/main/provider-setup/process'

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  constructor(readonly pid: number | undefined = 70123) {
    super()
  }
}
const children: FakeChild[] = []
afterEach(() => {
  for (const child of children.splice(0)) child.emit('close', 1)
  vi.useRealTimers()
})
function fixture(platform: NodeJS.Platform = 'darwin', available = false) {
  const child = new FakeChild()
  children.push(child)
  const findProgram = vi.fn((): string | null =>
    available ? '/fictional/tools/official-cli' : null,
  )
  const spawn = vi.fn(() => child)
  const stop = vi.fn()
  const service = new ClaudeSetupService(
    { platform, findProgram, spawn, stop },
    { ...CLAUDE_SETUP_BOUNDS, installMs: 100, loginMs: 200, stopMs: 10 },
  )
  const states: ProviderSetupState[] = []
  service.onState((state) => states.push(state))
  const completed = vi.fn()
  service.onCompleted(completed)
  return { child, service, spawn, stop, findProgram, states, completed }
}
const auth =
  'https://claude.ai/oauth/authorize?response_type=code&client_id=fictional-client&state=fictional-state&code_challenge=fictional-challenge&code=true'

describe('trusted native completion notifications', () => {
  it.each(['install', 'signIn'] as const)(
    'invalidates exactly once before terminal %s state, after successful close only',
    (action) => {
      const f = fixture('darwin', action === 'signIn')
      const order: string[] = []
      f.service.onCompleted(() => order.push('invalidate'))
      f.service.onState((state) => {
        if (state.phase === 'installed' || state.phase === 'signed-in') order.push('terminal')
      })
      f.service[action]()
      f.child.stdout.write(auth + '\n')
      expect(f.completed).not.toHaveBeenCalled()
      f.findProgram.mockReturnValue('/fictional/tools/official-cli')
      f.child.emit('close', 0)
      expect(f.completed).toHaveBeenCalledExactlyOnceWith('claude', action)
      expect(order).toEqual(['invalidate', 'terminal'])
      f.service.state()
      f.child.emit('close', 0)
      expect(f.completed).toHaveBeenCalledTimes(1)
    },
  )
  it.each(
    (['install', 'signIn'] as const).flatMap((action) =>
      (['failure', 'cancel', 'timeout', 'missing'] as const).map((outcome) => ({
        action,
        outcome,
      })),
    ),
  )('does not announce $action $outcome as successful setup', async ({ action, outcome }) => {
    vi.useFakeTimers()
    const f = fixture('darwin', action === 'signIn')
    f.service[action]()
    if (outcome === 'cancel') f.service.cancel()
    if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(action === 'install' ? 100 : 200)
    f.findProgram.mockReturnValue(outcome === 'missing' ? null : '/fictional/tools/official-cli')
    f.child.emit('close', outcome === 'failure' ? 1 : 0)
    expect(f.completed).not.toHaveBeenCalled()
  })
  it('does not announce an already installed idle action, and disposes completion listeners', () => {
    const f = fixture('darwin', true)
    f.service.install()
    expect(f.completed).not.toHaveBeenCalled()
    const discarded = vi.fn()
    f.service.onCompleted(discarded)()
    f.service.onCompleted(() => {
      throw new Error('fictional observer failure')
    })
    f.service.signIn()
    f.child.emit('close', 0)
    expect(discarded).not.toHaveBeenCalled()
    expect(f.completed).toHaveBeenCalledTimes(1)
    expect(f.service.busy).toBe(false)
  })
})

describe('fixed official setup commands, with no real execution', () => {
  it.each(['darwin', 'linux'] as const)(
    'uses the documented installer on %s with pipeline failure handling',
    (platform) => {
      expect(officialInstaller(platform)).toEqual({
        file: '/bin/bash',
        args: ['-o', 'pipefail', '-c', 'curl -fsSL https://claude.ai/install.sh | bash'],
      })
    },
  )
  it('uses native noninteractive hidden PowerShell, without a profile or Terminal app', () => {
    expect(officialInstaller('win32', 'Z:\\FictionalOS')).toEqual({
      file: 'Z:\\FictionalOS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$ErrorActionPreference = "Stop"; irm https://claude.ai/install.ps1 | iex',
      ],
    })
    expect(officialInstaller('freebsd')).toBeNull()
  })
  it('redetects the installed CLI after success; no development SDK fallback', () => {
    const f = fixture()
    expect(f.service.install()).toEqual({ ok: true })
    expect(f.service.state()).toMatchObject({
      provider: 'claude',
      supported: { install: true, signIn: true },
      phase: 'installing',
    })
    f.findProgram.mockReturnValue('/fictional/native/bin/official-cli')
    f.child.emit('close', 0)
    expect(f.service.state()).toMatchObject({
      phase: 'installed',
      available: true,
      exitCode: 0,
      details: null,
    })
    expect(f.spawn).toHaveBeenCalledTimes(1)
    expect(f.service.install()).toEqual({ ok: true })
    expect(f.spawn).toHaveBeenCalledTimes(1)
  })
  it('does not call success when the installer exits zero but lookup still finds nothing', () => {
    const f = fixture()
    f.service.install()
    f.child.emit('close', 0)
    expect(f.service.state()).toMatchObject({
      phase: 'failed',
      error: 'not-found',
      available: false,
    })
  })
  it('reports bounded installer failure diagnostics and never publishes them during progress', () => {
    const f = fixture()
    f.service.install()
    f.child.stderr.write('\u001b[31mDownload failed\u001b[0m\npassword=')
    f.child.stderr.write('fictional-value\n')
    expect(f.states.every((state) => state.details === null)).toBe(true)
    f.child.emit('close', 7)
    expect(f.service.state()).toMatchObject({
      error: 'install-failed',
      exitCode: 7,
      details: 'Download failed\npassword=[redacted]\n',
    })
    expect(JSON.stringify(f.states)).not.toContain('fictional-value')
  })
  it('limits retained diagnostics separately from total process output', () => {
    const f = fixture()
    f.service.install()
    f.child.stderr.write('x'.repeat(20_000))
    f.child.emit('close', 1)
    expect(f.service.state().details).toHaveLength(CLAUDE_SETUP_BOUNDS.diagnosticChars)
  })
  it('refuses unsupported platforms and missing login without spawning', () => {
    const f = fixture('freebsd')
    expect(f.service.install()).toEqual({ ok: false, reason: 'unsupported-platform' })
    expect(f.service.signIn()).toEqual({ ok: false, reason: 'not-found' })
    expect(f.spawn).not.toHaveBeenCalled()
  })
})

describe('the CLI owns browser sign-in', () => {
  it('invokes only the detected program with auth login and forwards only an approved chunked URL', () => {
    const f = fixture('darwin', true)
    expect(f.service.signIn()).toEqual({ ok: true })
    expect(f.spawn).toHaveBeenCalledWith({
      file: '/fictional/tools/official-cli',
      args: ['auth', 'login'],
    })
    f.child.stdout.write('Never show fictional-login-output\n' + auth.slice(0, 40))
    f.child.stdout.write(auth.slice(40) + '\n')
    expect(f.service.state().authUrl).toBe(auth)
    expect(JSON.stringify(f.states)).not.toContain('fictional-login-output')
    f.child.stderr.write('invented private callback code\n')
    f.child.emit('close', 1)
    expect(f.service.state()).toMatchObject({
      phase: 'failed',
      error: 'login-failed',
      details: null,
      authUrl: null,
    })
    expect(JSON.stringify(f.states)).not.toContain('invented private callback code')
  })
  it('handles a final URL without newline, and clears it when the command closes', () => {
    const f = fixture('darwin', true)
    f.service.signIn()
    f.child.stdout.write(auth)
    f.child.emit('close', 0)
    expect(f.states.some((state) => state.authUrl === auth)).toBe(true)
    expect(f.service.state()).toMatchObject({ phase: 'signed-in', authUrl: null, error: null })
  })
  it.each([
    'http://claude.ai/oauth/authorize?response_type=code',
    'https://claude.ai.attacker.invalid/oauth/authorize?response_type=code',
    'https://fictional-user@claude.ai/oauth/authorize?response_type=code',
    'https://claude.ai:444/oauth/authorize?response_type=code',
    'https://claude.ai/oauth/authorize?response_type=token',
    'https://claude.ai/oauth/callback?code=fictional-code',
    auth + '&access_token=fictional-value',
    auth + '&code=fictional-callback',
    auth + '#fictional-fragment',
  ])('rejects non-request/credential-bearing URL %s', (url) =>
    expect(officialAuthUrl(url)).toBeNull(),
  )
})

describe('bounded process lifecycle', () => {
  it('cancels softly then forcibly, retaining the busy permit until a close receipt', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.service.install()
    f.service.cancel()
    expect(f.stop).toHaveBeenCalledWith(f.child.pid, false)
    expect(f.service.install()).toEqual({ ok: false, reason: 'busy' })
    await vi.advanceTimersByTimeAsync(20)
    expect(f.stop).toHaveBeenCalledWith(f.child.pid, true)
    expect(f.service.busy).toBe(true)
    expect(f.service.install()).toEqual({ ok: false, reason: 'busy' })
    f.child.emit('close', null)
    expect(f.service.busy).toBe(false)
    expect(f.service.state()).toMatchObject({ phase: 'cancelled', authUrl: null })
  })
  it.each(['install', 'signIn'] as const)(
    'times out %s and never returns sign-in diagnostics',
    async (action) => {
      vi.useFakeTimers()
      const f = fixture('darwin', action === 'signIn')
      f.service[action]()
      await vi.advanceTimersByTimeAsync(action === 'install' ? 100 : 200)
      expect(f.stop).toHaveBeenCalledWith(f.child.pid, false)
      f.child.emit('close', null)
      expect(f.service.state()).toMatchObject({
        phase: 'failed',
        error: 'timed-out',
        details: null,
      })
    },
  )
  it('bounds output across both pipes and stops rather than silently dropping unlimited data', () => {
    const f = fixture()
    f.service.install()
    f.child.stdout.write(Buffer.alloc(140_000, 'x'))
    f.child.stderr.write(Buffer.alloc(140_000, 'y'))
    expect(f.stop).toHaveBeenCalledWith(f.child.pid, false)
    f.child.emit('close', 1)
    expect(f.service.state().error).toBe('output-limit')
    expect(f.service.state().details!.length).toBeLessThanOrEqual(
      CLAUDE_SETUP_BOUNDS.diagnosticChars,
    )
  })
  it('bounds incomplete login lines and does not expose them', () => {
    const f = fixture('darwin', true)
    f.service.signIn()
    f.child.stdout.write('x'.repeat(20_000))
    f.child.emit('close', 1)
    expect(f.service.state()).toMatchObject({ error: 'output-limit', details: null })
  })
  it('handles a failed output pipe without forwarding its error or losing the child permit', () => {
    const f = fixture()
    f.service.install()
    f.child.stderr.emit('error', new Error('fictional pipe detail'))
    expect(f.stop).toHaveBeenCalledWith(f.child.pid, false)
    expect(f.service.busy).toBe(true)
    f.child.emit('close', 1)
    expect(f.service.state()).toMatchObject({ error: 'start-failed', details: null })
    expect(JSON.stringify(f.states)).not.toContain('fictional pipe detail')
  })
  it('keeps spawn-error diagnostics fixed and releases only a failed spawn without a PID', () => {
    const child = new FakeChild(undefined)
    // Explicitly shadow the constructor default for an unspawned process.
    Object.defineProperty(child, 'pid', { value: undefined })
    const service = new ClaudeSetupService({
      platform: 'darwin',
      findProgram: () => null,
      spawn: () => child,
      stop: vi.fn(),
    })
    service.install()
    child.emit('error', new Error('fictional spawn detail'))
    expect(service.state()).toMatchObject({ error: 'start-failed', details: null })
    expect(service.busy).toBe(false)
  })
  it('requires close after leader exit with open pipes, and ignores late events after closure', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.service.install()
    f.child.emit('exit', 5)
    await vi.advanceTimersByTimeAsync(30)
    expect(f.service.busy).toBe(true)
    expect(f.service.state()).toMatchObject({ phase: 'cancelling', error: 'timed-out' })
    expect(f.service.install()).toEqual({ ok: false, reason: 'busy' })
    expect(f.child.stdout.destroyed).toBe(false)
    f.child.emit('close', 5)
    expect(f.service.state()).toMatchObject({ error: 'timed-out', exitCode: 5 })
    const before = f.states.length
    f.child.emit('close', 0)
    f.child.emit('exit', 0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.states).toHaveLength(before)
    expect(f.child.stdout.listenerCount('data')).toBe(0)
    expect(f.stop).toHaveBeenCalledWith(f.child.pid, true)
  })
  it('bounds shutdown, retains a stuck permit, and prevents new commands after close', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.service.onState(() => {
      throw new Error('fictional closed observer')
    })
    f.service.install()
    const closing = f.service.close()
    await vi.advanceTimersByTimeAsync(30)
    await closing
    expect(f.stop).toHaveBeenCalledWith(f.child.pid, true)
    expect(f.service.install()).toEqual({ ok: false, reason: 'closed' })
    f.child.emit('close', null)
    expect(f.service.busy).toBe(false)
  })
})

describe('native process adapter with every OS call mocked', () => {
  it.each(['install', 'signIn'] as const)(
    'keeps Windows %s busy after leader exit until inherited pipes really close',
    async (action) => {
      vi.useFakeTimers()
      const child = new FakeChild(),
        next = new FakeChild(70125)
      children.push(child, next)
      const spawn = vi
        .fn(() => child)
        .mockReturnValueOnce(child)
        .mockReturnValueOnce(next)
      const execFile = vi.fn(),
        kill = vi.fn()
      const adapter = setupProcesses('win32', 'Z:\\FictionalOS', { spawn, execFile, kill })
      const service = new ClaudeSetupService(
        {
          platform: 'win32',
          systemRoot: 'Z:\\FictionalOS',
          ...adapter,
          findProgram: () => (action === 'signIn' ? 'Z:\\FictionalTools\\official-cli.exe' : null),
        },
        { ...CLAUDE_SETUP_BOUNDS, installMs: 100, loginMs: 200, stopMs: 10 },
      )
      expect(service[action]()).toEqual({ ok: true })
      child.emit('exit', 0)
      await vi.advanceTimersByTimeAsync(1000)
      expect(service.state()).toMatchObject({ phase: 'cancelling', error: 'timed-out' })
      expect(service.busy).toBe(true)
      expect(service.install()).toEqual({ ok: false, reason: 'busy' })
      expect(service.signIn()).toEqual({ ok: false, reason: 'busy' })
      expect(spawn).toHaveBeenCalledTimes(1)
      expect(child.stdout.destroyed).toBe(false)
      expect(child.stderr.destroyed).toBe(false)
      expect(execFile).not.toHaveBeenCalled()
      expect(kill).not.toHaveBeenCalled()
      // The descendant releases the inherited streams before the process emits its close receipt.
      child.stdout.end()
      child.stderr.end()
      child.emit('close', 0)
      expect(service.busy).toBe(false)
      expect(service.state().phase).toBe('failed')
      expect(service[action]()).toEqual({ ok: true })
      expect(spawn).toHaveBeenCalledTimes(2)
      child.emit('exit', 0)
      child.emit('close', 0)
      expect(service.busy).toBe(true)
      next.emit('close', 0)
    },
  )
  it('does not treat Windows taskkill completion as a process-tree close receipt', async () => {
    vi.useFakeTimers()
    const child = new FakeChild()
    children.push(child)
    const execFile = vi.fn<SetupProcessHost['execFile']>()
    const adapter = setupProcesses('win32', 'Z:\\FictionalOS', {
      spawn: () => child,
      execFile,
      kill: vi.fn(),
    })
    const service = new ClaudeSetupService(
      { platform: 'win32', ...adapter, findProgram: () => null },
      { ...CLAUDE_SETUP_BOUNDS, stopMs: 10 },
    )
    service.install()
    service.cancel()
    execFile.mock.calls[0]![3]()
    expect(service.busy).toBe(true)
    child.emit('exit', 0)
    await vi.advanceTimersByTimeAsync(30)
    expect(execFile).toHaveBeenCalledTimes(1)
    expect(service.busy).toBe(true)
    expect(service.install()).toEqual({ ok: false, reason: 'busy' })
    const closing = service.close()
    await vi.advanceTimersByTimeAsync(30)
    await closing
    expect(service.busy).toBe(true)
    expect(service.install()).toEqual({ ok: false, reason: 'closed' })
    child.emit('close', null)
    expect(service.busy).toBe(false)
  })
  it('retains an owned POSIX group through the pipe-drain interval after its leader exits', () => {
    const child = new FakeChild(),
      kill = vi.fn()
    const adapter = setupProcesses('darwin', undefined, {
      spawn: () => child,
      execFile: vi.fn(),
      kill,
    })
    adapter.spawn({ file: '/fictional/cli', args: [] })
    child.emit('exit', 1)
    adapter.stop(child.pid!, true)
    expect(kill).toHaveBeenCalledWith(-child.pid!, 'SIGKILL')
    child.emit('close', 1)
    kill.mockClear()
    adapter.stop(child.pid!, true)
    expect(kill).not.toHaveBeenCalled()
  })
  it.each(['darwin', 'win32'] as const)(
    'hides %s shells, owns PIDs and never invokes a shell for CLI arguments',
    (platform) => {
      const child = new FakeChild()
      const spawn = vi.fn(() => child),
        execFile = vi.fn(),
        kill = vi.fn()
      const adapter = setupProcesses(platform, 'Z:\\FictionalOS', { spawn, execFile, kill })
      adapter.stop(70123, true)
      expect(kill).not.toHaveBeenCalled()
      expect(execFile).not.toHaveBeenCalled()
      adapter.spawn({ file: '/fictional/cli', args: ['auth', 'login'] })
      expect(spawn).toHaveBeenCalledWith('/fictional/cli', ['auth', 'login'], {
        shell: false,
        windowsHide: true,
        detached: platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      adapter.stop(70123, false)
      adapter.stop(70123, true)
      if (platform === 'win32') {
        expect(execFile).toHaveBeenLastCalledWith(
          'Z:\\FictionalOS\\System32\\taskkill.exe',
          ['/PID', '70123', '/T', '/F'],
          { windowsHide: true, timeout: 2000, maxBuffer: 4096 },
          expect.any(Function),
        )
      } else
        expect(kill.mock.calls).toEqual([
          [-70123, 'SIGTERM'],
          [-70123, 'SIGKILL'],
        ])
      child.emit('exit', 0)
      child.emit('close', 0)
      kill.mockClear()
      execFile.mockClear()
      adapter.stop(70123, true)
      expect(kill).not.toHaveBeenCalled()
      expect(execFile).not.toHaveBeenCalled()
    },
  )
})
