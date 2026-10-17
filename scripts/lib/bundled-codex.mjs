/**
 * Resolve the bundled Codex binary for protocol tools and live instruments using the
 * same resolution base as the app's `resolveCodexBinary` (`apps/desktop`).
 * The user's global executable and PATH cannot select a different version.
 */
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

/**
 * Absolute (real) path of the pinned codex binary, or an Error naming the fix. Throws rather
 * than falling back: a script that silently used a PATH codex would defeat the pin.
 */
export function bundledCodexBinary() {
  const desktopRequire = createRequire(join(REPO_ROOT, 'apps', 'desktop', 'package.json'))
  let packageJson
  try {
    packageJson = desktopRequire.resolve('@openai/codex-darwin-arm64/package.json')
  } catch {
    throw new Error(
      'the bundled codex is not installed (@openai/codex-darwin-arm64 under apps/desktop) — ' +
        'run pnpm install with optional dependencies enabled; note it is darwin-arm64 only',
    )
  }
  return realpathSync(join(dirname(packageJson), 'vendor', 'aarch64-apple-darwin', 'bin', 'codex'))
}
