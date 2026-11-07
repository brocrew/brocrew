import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { theVariablesFor } from '../../lib/tests-run-in-a-fictional-home.mjs'
import { failureError, outputClass, builderOutputClass } from './diagnostics.mjs'
import { hostedSystemEnvironment } from './environment.mjs'
const exec = promisify(execFile)
export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export function privateFolder(folder) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
  fs.chmodSync(folder, 0o700)
  return folder
}
export function fixtureEnvironment(root, extra = {}, runtime = process.execPath) {
  const home = privateFolder(path.join(root, 'home'))
  return {
    ...hostedSystemEnvironment(),
    ...theVariablesFor(home),
    PATH: `${privateFolder(path.join(root, 'bin'))}:${path.dirname(runtime)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    TMPDIR: privateFolder(path.join(root, 'tmp')),
    TMP: path.join(root, 'tmp'),
    TEMP: path.join(root, 'tmp'),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    npm_config_userconfig: path.join(root, 'npm-user'),
    npm_config_globalconfig: path.join(root, 'npm-global'),
    npm_config_cache: path.join(root, 'npm-cache'),
    npm_config_store_dir: path.join(root, 'pnpm-store'),
    CI: 'true',
    GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    ELECTRON_CACHE: path.join(root, 'electron-cache'),
    ELECTRON_BUILDER_CACHE: path.join(root, 'builder-cache'),
    ...extra,
  }
}
export function fixtureAppEnvironment(root, app) {
  // Matrix and journey run on different Node binaries; their app PATH must still be identical.
  return fixtureEnvironment(root, {}, path.join(app, 'Contents/Resources/plugin-node/node'))
}
export function buildEnvironment(root, pnpm) {
  if (!path.isAbsolute(pnpm)) throw new Error('Declared package manager required')
  return {
    PATH: `${fixtureEnvironment(root).PATH}:${path.dirname(pnpm)}`,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  }
}
export async function command(
  program,
  args,
  root,
  extra = {},
  cwd = repository,
  phase = 'prepare',
) {
  // Diagnostics can include provider input: callers only receive a fixed error, never stdout/stderr.
  try {
    return (
      await exec(program, args, {
        cwd,
        env: fixtureEnvironment(root, extra),
        timeout: 420_000,
        maxBuffer: 8 * 1024 * 1024,
      })
    ).stdout
  } catch (error) {
    const text = String(error.stdout ?? '') + String(error.stderr ?? '')
    const packaging = phase === 'app-package' ? builderOutputClass(text) : 'unknown'
    throw failureError(phase, error, packaging === 'unknown' ? outputClass(text) : packaging)
  }
}
