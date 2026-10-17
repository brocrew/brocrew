#!/usr/bin/env node
/**
 * Generate vendored Codex protocol types from the bundled binary, independent of PATH.
 *
 *   pnpm run protocol:generate
 *
 * For a version upgrade, change the `@openai/codex-darwin-arm64` pin, install dependencies,
 * regenerate here and update `CODEX_PROTOCOL_VERSION`. Use `--experimental` for the vendored
 * surface and leave raw ts-rs output unformatted (`.prettierignore`).
 */
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundledCodexBinary } from './lib/bundled-codex.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const out = join(repoRoot, 'packages/runtime/src/codex/protocol')

const codex = bundledCodexBinary()
const version = execFileSync(codex, ['--version'], { encoding: 'utf8' }).trim()
// `generate-ts` writes over what is there and deletes nothing, so a type the new version dropped
// would stay behind (0.160.0 dropped `ThreadRollback*`). Start from an empty directory.
rmSync(out, { recursive: true, force: true })
execFileSync(codex, ['app-server', 'generate-ts', '--out', out, '--experimental'], {
  stdio: 'inherit',
})
console.log(
  `protocol:generate OK — vendored types rewritten from the bundled ${version} (--experimental).\n` +
    'If the version moved, update CODEX_PROTOCOL_VERSION in packages/runtime/src/codex/protocol-version.ts.',
)
