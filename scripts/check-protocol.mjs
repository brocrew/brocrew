#!/usr/bin/env node
/**
 * Assert the vendored Codex protocol types are exactly what the BUNDLED CLI generates
 * (043, closing 036 P2-6; retargeted from PATH codex to the pinned binary in 014).
 * Regenerates into a temp dir and diffs against `packages/runtime/src/codex/protocol` —
 * catching CLI/protocol drift at build time rather than as confusing mis-parsing at runtime.
 *
 *   pnpm run protocol:check      # this script
 *   pnpm run protocol:generate   # rewrite the vendored types in place
 *
 * NOT part of `pnpm run ci`: it runs a live codex binary, which only exists on a darwin-arm64
 * install. It exits 0 with a SKIP notice when the bundled binary is unavailable (another
 * platform, optional deps skipped); a genuine drift is always a non-zero exit.
 *
 * It also asserts that the bundled program still holds the one sentence of Codex's the product
 * matches (`CODEX_SIGN_IN_REFUSED_AT_ROUTING`), for the same reason: a change is found here.
 *
 * The generation flags are load-bearing and verified byte-identical for 0.160.0:
 *   --experimental   emits the experimental surface we vendor (without it, 7 vendored types
 *                    are missing and several unions shrink)
 *   NO prettier      the checked-in files are raw ts-rs output, which is why
 *                    `.prettierignore` excludes the protocol directory
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  theProgramStillSays,
  theSentenceCodexRefusesASignInWith,
} from './lib/a-sentence-codex-says.mjs'
import { bundledCodexBinary } from './lib/bundled-codex.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const vendored = join(repoRoot, 'packages/runtime/src/codex/protocol')

let codex
try {
  codex = bundledCodexBinary()
} catch (error) {
  console.log(`SKIP protocol:check — ${error.message}`)
  process.exit(0)
}
const probe = spawnSync(codex, ['--version'], { encoding: 'utf8' })
if (probe.error || probe.status !== 0) {
  console.log(`SKIP protocol:check — bundled codex at ${codex} did not run.`)
  process.exit(0)
}
const cliVersion = probe.stdout.trim()

// Codex gives one refusal no type, so the product matches its sentence. A Codex that words it
// differently would leave a refused sign-in unrecognised, so that is a failed update, said here.
const sentence = theSentenceCodexRefusesASignInWith(
  readFileSync(join(repoRoot, 'packages/runtime/src/codex/auth-probe.ts'), 'utf8'),
)
if (!theProgramStillSays(readFileSync(codex), sentence)) {
  console.error(
    `protocol:check FAILED — the bundled ${cliVersion} no longer holds the sentence BroBot ` +
      `recognises a refused sign-in by:\n  ${sentence}\n` +
      'Read app-server/src/request_processors/account_processor/workspace_routing.rs at the new\n' +
      'tag, and change CODEX_SIGN_IN_REFUSED_AT_ROUTING in packages/runtime/src/codex/auth-probe.ts\n' +
      'to what Codex says now.',
  )
  process.exit(1)
}

const out = mkdtempSync(join(tmpdir(), 'brobot2-protocol-'))
try {
  execFileSync(codex, ['app-server', 'generate-ts', '--out', out, '--experimental'], {
    stdio: 'pipe',
  })
  // `diff -r` exits non-zero on any content difference or missing/extra file.
  const diff = spawnSync('diff', ['-r', vendored, out], { encoding: 'utf8' })
  if (diff.status === 0) {
    console.log(
      `protocol:check OK — vendored types match the bundled ${cliVersion} (--experimental).`,
    )
    process.exit(0)
  }
  console.error(
    `protocol:check FAILED — vendored types differ from what the bundled ${cliVersion} generates:\n`,
  )
  console.error(diff.stdout || diff.stderr)
  console.error(
    'Regenerate with `pnpm run protocol:generate`, update CODEX_PROTOCOL_VERSION in\n' +
      'packages/runtime/src/codex/protocol-version.ts, and re-run the suites.',
  )
  process.exit(1)
} finally {
  rmSync(out, { recursive: true, force: true })
}
