import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'
import { win32 } from 'node:path'
import type {
  ProviderSetupAction,
  ProviderSetupError,
  ProviderSetupState,
} from '../../../shared/provider-setup'

import type { SetupChild, SetupCommand, SetupCompletion } from '../../provider-setup/service'
export interface ClaudeSetupDependencies {
  readonly platform: NodeJS.Platform
  readonly systemRoot?: string
  findProgram(): string | null
  spawn(command: SetupCommand): SetupChild
  stop(pid: number, force: boolean): void
}
export const CLAUDE_SETUP_BOUNDS = {
  installMs: 300_000,
  loginMs: 600_000,
  stopMs: 2_000,
  outputBytes: 262_144,
  diagnosticChars: 8_192,
  lineChars: 16_384,
} as const
type Bounds = { [K in keyof typeof CLAUDE_SETUP_BOUNDS]: number }
type Kind = 'install' | 'signIn'
type Stop = ProviderSetupError | 'cancelled'
type Operation = {
  kind: Kind
  child: SetupChild | null
  bytes: number
  diagnostics: string
  stop?: Stop
  exited: boolean
  finished: boolean
  timers: ReturnType<typeof setTimeout>[]
  cleanup: (() => void)[]
  done: Promise<void>
  resolveDone: () => void
}

export function officialInstaller(
  platform: NodeJS.Platform,
  systemRoot = 'C:\\Windows',
): SetupCommand | null {
  if (platform === 'win32')
    return {
      file: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$ErrorActionPreference = "Stop"; irm https://claude.ai/install.ps1 | iex',
      ],
    }
  if (platform === 'darwin' || platform === 'linux')
    return {
      file: '/bin/bash',
      args: ['-o', 'pipefail', '-c', 'curl -fsSL https://claude.ai/install.sh | bash'],
    }
  return null
}

/** Authorization requests only; no callback codes, credentials, alternate hosts or arbitrary links. */
export function officialAuthUrl(candidate: string): string | null {
  if (candidate.length > 8_192) return null
  try {
    const url = new URL(candidate)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'claude.ai' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname !== '/oauth/authorize'
    )
      return null
    if (url.searchParams.get('response_type') !== 'code') return null
    for (const [name, value] of url.searchParams) {
      if (
        /token|password|secret|authorization/iu.test(name) ||
        (name.toLowerCase() === 'code' && value !== 'true')
      )
        return null
    }
    return url.href
  } catch {
    return null
  }
}

function diagnostics(text: string): string {
  return stripVTControlCharacters(text)
    .split('')
    .filter(
      (character) => character === '\n' || character === '\t' || character.charCodeAt(0) >= 32,
    )
    .join('')
    .replace(
      /((?:token|password|secret|authorization|api[_-]?key)\s*[:=]\s*)\S+/giu,
      '$1[redacted]',
    )
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/giu, 'https://[redacted]@')
}

/** Owns only fixed installer/auth commands. No authentication output is returned or logged. */
export class ClaudeSetupService {
  private current: ProviderSetupState = {
    provider: 'claude',
    supported: { install: true, signIn: true },
    phase: 'idle',
    available: false,
    progress: '',
    authUrl: null,
    error: null,
    details: null,
    exitCode: null,
  }
  private active: Operation | null = null
  private closed = false
  private readonly listeners = new Set<(state: ProviderSetupState) => void>()
  private readonly completed = new Set<SetupCompletion>()
  constructor(
    private readonly deps: ClaudeSetupDependencies,
    private readonly bounds: Bounds = CLAUDE_SETUP_BOUNDS,
  ) {}

  private detected(): string | null {
    try {
      return this.deps.findProgram()
    } catch {
      return null
    }
  }
  get busy(): boolean {
    return this.active !== null
  }
  state(): ProviderSetupState {
    if (!this.active && !this.closed)
      this.current = { ...this.current, available: this.detected() !== null }
    return { ...this.current, supported: { ...this.current.supported } }
  }
  onState(listener: (state: ProviderSetupState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  onCompleted(listener: SetupCompletion): () => void {
    this.completed.add(listener)
    return () => {
      this.completed.delete(listener)
    }
  }
  private publish(change: Partial<ProviderSetupState>): void {
    this.current = { ...this.current, ...change }
    for (const listener of this.listeners) {
      try {
        listener(this.state())
      } catch {
        /* A closed observer cannot stop process cleanup. */
      }
    }
  }

  install(): ProviderSetupAction {
    if (this.closed) return { ok: false, reason: 'closed' }
    if (this.active) return { ok: false, reason: 'busy' }
    const command = officialInstaller(this.deps.platform, this.deps.systemRoot)
    if (!command) return { ok: false, reason: 'unsupported-platform' }
    if (this.detected()) {
      this.publish({
        phase: 'installed',
        available: true,
        progress: 'Claude Code is installed.',
        authUrl: null,
        error: null,
        details: null,
        exitCode: null,
      })
      return { ok: true }
    }
    return this.start('install', command)
  }
  signIn(): ProviderSetupAction {
    if (this.closed) return { ok: false, reason: 'closed' }
    if (this.active) return { ok: false, reason: 'busy' }
    const program = this.detected()
    if (!program) {
      this.publish({
        phase: 'failed',
        available: false,
        progress: 'Install Claude Code before signing in.',
        error: 'not-found',
        authUrl: null,
        details: null,
        exitCode: null,
      })
      return { ok: false, reason: 'not-found' }
    }
    return this.start('signIn', { file: program, args: ['auth', 'login'] })
  }

  private start(kind: Kind, command: SetupCommand): ProviderSetupAction {
    let resolveDone!: () => void
    const operation: Operation = {
      kind,
      child: null,
      bytes: 0,
      diagnostics: '',
      exited: false,
      finished: false,
      timers: [],
      cleanup: [],
      done: new Promise<void>((resolve) => {
        resolveDone = resolve
      }),
      resolveDone: () => resolveDone(),
    }
    this.active = operation
    this.publish({
      phase: kind === 'install' ? 'installing' : 'signing-in',
      available: kind === 'signIn',
      progress:
        kind === 'install'
          ? 'Downloading and installing Claude Code…'
          : 'Waiting for Claude Code to open your browser…',
      authUrl: null,
      error: null,
      details: null,
      exitCode: null,
    })
    try {
      const child = this.deps.spawn(command)
      operation.child = child
      child.once('error', () => {
        if (child.pid === undefined) this.finish(operation, null, 'start-failed')
        else this.stop(operation, 'start-failed')
      })
      child.once('spawn', () => {
        if (operation.stop) this.signal(operation, false)
      })
      child.once('exit', () => {
        if (this.active !== operation || operation.finished) return
        operation.exited = true
        operation.timers.push(
          setTimeout(() => {
            // Exit does not close inherited pipes or prove that descendants have stopped.
            this.stop(operation, 'timed-out')
          }, this.bounds.stopMs),
        )
      })
      child.once('close', (code: number | null) => this.finish(operation, code))
      for (const stream of [child.stdout, child.stderr]) {
        if (!stream) continue
        const decoder = new StringDecoder('utf8')
        let line = ''
        const receive = (chunk: unknown): void => {
          if (this.active !== operation || operation.finished || operation.stop) return
          if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string') return
          operation.bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
          if (operation.bytes > this.bounds.outputBytes) {
            this.stop(operation, 'output-limit')
            return
          }
          const text = decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          if (kind === 'install')
            operation.diagnostics = (operation.diagnostics + text).slice(
              -this.bounds.diagnosticChars,
            )
          else {
            line += stripVTControlCharacters(text)
            const rows = line.split(/\r?\n/u)
            line = rows.pop() ?? ''
            for (const row of rows) this.authLine(operation, row)
            if (line.length > this.bounds.lineChars) {
              this.stop(operation, 'output-limit')
              line = ''
            }
          }
        }
        const pipeFailed = (): void => this.stop(operation, 'start-failed')
        stream.on('error', pipeFailed)
        stream.on('data', receive)
        operation.cleanup.push(() => {
          if (kind === 'signIn' && !operation.stop) this.authLine(operation, line)
          line = ''
          stream.removeListener('data', receive)
          stream.destroy()
          stream.removeListener('error', pipeFailed)
        })
      }
      operation.timers.push(
        setTimeout(
          () => this.stop(operation, 'timed-out'),
          kind === 'install' ? this.bounds.installMs : this.bounds.loginMs,
        ),
      )
      return { ok: true }
    } catch {
      if (operation.child?.pid) this.stop(operation, 'start-failed')
      else this.finish(operation, null, 'start-failed')
      return { ok: false, reason: 'start-failed' }
    }
  }

  private authLine(operation: Operation, line: string): void {
    if (this.active !== operation || operation.stop) return
    for (const match of line.matchAll(/https:\/\/[^\s<>"']+/gu)) {
      const url = officialAuthUrl(match[0].replace(/[),.;]+$/u, ''))
      if (url && url !== this.current.authUrl)
        this.publish({ authUrl: url, progress: 'Complete sign-in in your browser.' })
    }
  }
  private signal(operation: Operation, force: boolean): void {
    const pid = operation.child?.pid
    if (
      (!force && operation.exited) ||
      operation.finished ||
      !pid ||
      !Number.isSafeInteger(pid) ||
      pid <= 0
    )
      return
    try {
      this.deps.stop(pid, force)
    } catch {
      /* Escalation and the exit receipt still own completion. */
    }
  }
  private stop(operation: Operation, reason: Stop): void {
    if (this.active !== operation || operation.finished || operation.stop) return
    operation.stop = reason
    this.publish({
      phase: 'cancelling',
      authUrl: null,
      progress: 'Stopping Claude Code setup…',
      details: null,
    })
    this.signal(operation, false)
    operation.timers.push(
      setTimeout(() => {
        this.signal(operation, true)
        operation.timers.push(
          setTimeout(() => {
            if (this.active === operation && !operation.finished)
              this.publish({
                phase: 'cancelling',
                error: 'timed-out',
                progress: 'Claude Code setup has not stopped yet.',
                authUrl: null,
              })
          }, this.bounds.stopMs),
        )
      }, this.bounds.stopMs),
    )
  }
  private finish(operation: Operation, code: number | null, error?: ProviderSetupError): void {
    if (this.active !== operation || operation.finished) return
    for (const cleanup of operation.cleanup) {
      try {
        cleanup()
      } catch {
        /* Cleanup continues when a pipe has already closed. */
      }
    }
    operation.finished = true
    for (const timer of operation.timers) clearTimeout(timer)
    this.active = null
    const available = this.detected() !== null
    const reason =
      operation.stop ??
      error ??
      (code === 0 ? null : operation.kind === 'install' ? 'install-failed' : 'login-failed')
    const failure = reason ?? (available ? null : 'not-found')
    if (failure === null)
      for (const listener of this.completed) {
        try {
          listener(this.current.provider, operation.kind)
        } catch {
          /* Runtime notification cannot stop child cleanup. */
        }
      }
    this.publish({
      phase:
        reason === 'cancelled'
          ? 'cancelled'
          : failure
            ? 'failed'
            : operation.kind === 'install'
              ? 'installed'
              : 'signed-in',
      available,
      authUrl: null,
      error: failure === 'cancelled' ? null : failure,
      details:
        operation.kind === 'install' && failure && failure !== 'cancelled'
          ? diagnostics(operation.diagnostics) || null
          : null,
      exitCode: code,
      progress:
        reason === 'cancelled'
          ? 'Claude Code setup was cancelled.'
          : failure
            ? 'Claude Code setup did not finish.'
            : operation.kind === 'install'
              ? 'Claude Code is installed.'
              : 'Claude Code sign-in completed.',
    })
    operation.diagnostics = ''
    operation.resolveDone()
  }

  cancel(): ProviderSetupAction {
    if (this.closed) return { ok: false, reason: 'closed' }
    if (this.active) this.stop(this.active, 'cancelled')
    return { ok: true }
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const operation = this.active
    if (operation) {
      this.stop(operation, 'cancelled')
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          operation.done,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, this.bounds.stopMs * 3)
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    this.listeners.clear()
    this.completed.clear()
  }
}
