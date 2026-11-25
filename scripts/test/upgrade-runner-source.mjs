import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The upgrade-path runner and the modules it is split into, as paths under scripts/. */
export const RUNNER_FILES = [
  'upgrade-path.mjs',
  ...['settings', 'system', 'models', 'app', 'state', 'conversations', 'the-beta'].map(
    (name) => `lib/upgrade-run/${name}.mjs`,
  ),
]

/** The runner's source, its files joined, for tests that read what it says. */
export const runnerSource = () =>
  RUNNER_FILES.map((path) => readFileSync(join(SCRIPTS, path), 'utf8')).join('\n')
