import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VERSION_TIMEOUT_MS } from './program-policy'

/**
 * What a program prints for `--version`, run in a home of its own that is removed afterwards, so a
 * person's own settings are never read or changed. `homeEnv` names the provider's home variables.
 */
export async function runVersionInItsOwnHome(
  path: string,
  prefix: string,
  homeEnv: (home: string) => Readonly<Record<string, string>>,
): Promise<string> {
  let home: string | null = null
  try {
    const own = mkdtempSync(join(tmpdir(), prefix))
    home = own
    return await new Promise<string>((resolve, reject) => {
      execFile(
        path,
        ['--version'],
        {
          env: {
            HOME: own,
            ...homeEnv(own),
            PATH: process.platform === 'win32' ? (process.env.PATH ?? '') : '/usr/bin:/bin',
            ...(process.platform === 'win32'
              ? { USERPROFILE: own, SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' }
              : {}),
          },
          // ⚑ F072 — no console window flashes on Windows.
          windowsHide: true,
          timeout: VERSION_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          encoding: 'utf8',
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      )
    })
  } finally {
    if (home !== null) rmSync(home, { recursive: true, force: true })
  }
}
