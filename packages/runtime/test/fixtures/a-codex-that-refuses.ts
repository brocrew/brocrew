import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 706 · **A `codex` the product's own `createSpawnTransportFactory` can start**, which answers the
 * handshake as `0.146.0` does and then refuses `thread/resume` in one measured shape — see
 * `codex-resume-refusals.mjs` for the scenarios and the bytes.
 *
 * ⚑ An executable file rather than an env var, because the factory hands its child a SANITIZED
 * environment (`buildChildEnv`): the scenario is baked into the file it runs.
 */

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'codex-resume-refusals.mjs')

export type ResumeRefusal =
  | 'no-rollout'
  | 'rollout-path'
  | 'died'
  | 'other-refusal'
  | 'another-thread'
  | 'another-code'
  | 'another-rollout-path'
  | 'initialize-refused'
  | 'answers'

/** ⚑ A thread id in the shape Codex issues (UUIDv7) — the probe's `home-wiped` arm's own. */
export const A_CODEX_THREAD = '01a0d52b-4ac7-7060-9f71-9ad6fd1088dc'

/** An executable `codex` under `dir` that plays `scenario`, reporting `version` at `initialize`. */
export function aCodexThatRefuses(dir: string, scenario: ResumeRefusal, version: string): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `codex-${scenario}.mjs`)
  writeFileSync(
    path,
    [
      `#!${process.execPath}`,
      `process.env.BROBOT_706_RESUME = ${JSON.stringify(scenario)}`,
      `process.env.BROBOT_706_VERSION = ${JSON.stringify(version)}`,
      `process.env.BROBOT_706_THREAD = ${JSON.stringify(A_CODEX_THREAD)}`,
      `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)})`,
      '',
    ].join('\n'),
  )
  chmodSync(path, 0o755)
  return path
}

/**
 * ⚑ A rollout of `thread` where Codex keeps one — the thread's history, on disk in `home`: under
 * `sessions/<y>/<m>/<d>/`, or under `archived_sessions/` for a thread that was archived.
 */
export function aRolloutOf(
  home: string,
  thread: string,
  tree: 'sessions' | 'archived_sessions' = 'sessions',
): string {
  const day = join(home, tree, '2026', '09', '24')
  mkdirSync(day, { recursive: true })
  const path = join(day, `rollout-2026-09-24T20-46-18-${thread}.jsonl`)
  writeFileSync(path, '{"type":"session_meta"}\n')
  return path
}
