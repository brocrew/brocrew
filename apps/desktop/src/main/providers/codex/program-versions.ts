import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderVersion } from '../../../shared/runtime-ipc'
import type { CodexProgram } from './program'
import { VERSION_TIMEOUT_MS } from '../program-policy'

const FROM = { carried: 'the copy BroCrew carries' } as const

/** Bind once; a passing failure is asked again rather than cached. */
export function codexVersionReader(
  codexProgram: () => CodexProgram,
): () => Promise<ProviderVersion> {
  let codex: Promise<ProviderVersion> | null = null
  return async () => {
    codex ??= codexVersion(codexProgram).then(
      ({ answer, final }) => {
        if (!final) codex = null
        return answer
      },
      (error: unknown) => {
        codex = null
        throw error
      },
    )
    const askedCodex = codex
    return await askedCodex
  }
}

/** Codex's answer, and whether it holds for the rest of the run (`final`) or is asked again. */
async function codexVersion(
  codexProgram: () => CodexProgram,
): Promise<{ readonly answer: ProviderVersion; readonly final: boolean }> {
  let program: CodexProgram
  try {
    program = codexProgram()
  } catch (error) {
    // ⚑ `CodexUnavailableError`'s message is already a person's sentence.
    const said = error instanceof Error ? error.message : String(error)
    return {
      answer: {
        version: null,
        reason: said,
        program: {
          standing: 'missing',
          from: null,
          path: null,
          version: null,
          tested: null,
          said,
          help: null,
          update: null,
          others: [],
          updatedFrom: null,
        },
      },
      final: true,
    }
  }
  const where = `${FROM[program.from]}, at ${program.path}`
  // ⚑ A copy this app carries is the one it was built with: no tested range applies, and there is
  // nothing for a person to install.
  const facts = {
    from: program.from,
    path: program.path,
    tested: null,
    help: null,
    update: null,
    others: [],
    updatedFrom: null,
  }
  const unreadable = (said: string, final: boolean) => ({
    answer: {
      version: null,
      reason: said,
      program: { ...facts, standing: 'unreadable' as const, version: null, said },
    },
    final,
  })
  let home: string | null = null
  try {
    const own = mkdtempSync(join(tmpdir(), 'brobot-codex-version-'))
    home = own
    const printed = await new Promise<string>((resolve, reject) => {
      execFile(
        program.path,
        ['--version'],
        {
          env: {
            HOME: own,
            CODEX_HOME: own,
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
    const version = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(printed)?.[1]
    if (version === undefined) {
      return unreadable(
        `Codex, ${where}, did not say which version it is, so it may not run.`,
        true,
      )
    }
    return {
      answer: {
        version,
        program: { ...facts, standing: 'tested', version, said: `Codex ${version}, ${where}.` },
      },
      final: true,
    }
  } catch (error) {
    console.warn(
      `could not ask Codex its version: ${error instanceof Error ? error.message : String(error)}`,
    )
    return unreadable(
      `Codex, ${where}, could not be asked its version just now; it is asked again next time.`,
      false,
    )
  } finally {
    if (home !== null) rmSync(home, { recursive: true, force: true })
  }
}
