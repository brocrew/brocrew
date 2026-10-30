import { spawn, execFile } from 'node:child_process'
import { win32 } from 'node:path'
import type { SetupChild, SetupCommand } from './service'

export interface SetupProcessHost {
  spawn(
    file: string,
    args: string[],
    options: {
      shell: false
      windowsHide: true
      detached: boolean
      stdio: ['ignore', 'pipe', 'pipe']
    },
  ): SetupChild
  execFile(
    file: string,
    args: string[],
    options: { windowsHide: true; timeout: number; maxBuffer: number },
    callback: () => void,
  ): void
  kill(pid: number, signal: NodeJS.Signals): void
}

/** Signals only children started here, and their detached process groups. */
export function setupProcesses(
  platform: NodeJS.Platform,
  systemRoot = 'C:\\Windows',
  host: SetupProcessHost = { spawn, execFile, kill: process.kill.bind(process) },
): { spawn(command: SetupCommand): SetupChild; stop(pid: number, force: boolean): void } {
  const owned = new Set<number>()
  return {
    spawn(command) {
      const child = host.spawn(command.file, [...command.args], {
        shell: false,
        windowsHide: true,
        detached: platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const pid = child.pid
      if (pid !== undefined) {
        owned.add(pid)
        child.once('exit', () => {
          // Windows cannot safely target this PID after its leader exits; descendants may remain.
          if (platform === 'win32') owned.delete(pid)
        })
        child.once('close', () => owned.delete(pid))
      }
      return child
    },
    stop(pid, force) {
      if (!Number.isSafeInteger(pid) || pid <= 0 || !owned.has(pid)) return
      if (platform === 'win32') {
        host.execFile(
          win32.join(systemRoot, 'System32', 'taskkill.exe'),
          ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])],
          { windowsHide: true, timeout: 2_000, maxBuffer: 4_096 },
          () => undefined,
        )
      } else host.kill(-pid, force ? 'SIGKILL' : 'SIGTERM')
    },
  }
}
