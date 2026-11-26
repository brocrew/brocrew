#!/usr/bin/env node
/**
 * W4.1430.226.6 — driver (supersedes 226.4's) for ONE pin of the running-command popup proof. Throwaway; not a product
 * or CI file. Run it once per pin, from a clean, already-installed checkout of exactly that pin, on
 * an ADMITTED remote lane. It never installs, fetches, commits, switches refs or touches the
 * product.
 *
 *   node run-command-popup-proof.mjs --repo <checkout> --pin before|after \
 *        --sha <full 40-hex> --tree <full 40-hex> --out <new dir> [--scene <path to the .look.ts>] \
 *        [--lane "<admission text>"]
 *
 * The scene is per pin: command-popup-before.look.ts (imports only what main has) or
 * command-popup-after.look.ts. ⚠️ The 300 s hard kill is SIGKILL: the scene's `finally`/`catch` cannot run
 * then, so `failure.png` and `facts.json` are produced only on an ordinary red run, NOT on a kill;
 * a kill leaves `timeout.txt` and the vitest logs.
 *
 * Owned files, and only these:
 *   <out>/                      created EXCLUSIVELY (non-recursive mkdir; fails if it exists)
 *   <out>/*                     the files this run writes (PNGs, facts.json, identity.json, logs)
 *   <repo>/apps/desktop/look/scenes/command-popup.look.ts
 *                               copied EXCLUSIVELY (COPYFILE_EXCL; refuses if present), and removed in
 *                               `finally`, then `git status --porcelain` must be empty again.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { arch, platform, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at < 0 ? fallback : argv[at + 1]
}
const die = (message, code = 2) => {
  console.error(`run-command-popup-proof: ${message}`)
  process.exit(code)
}

const repo = resolve(flag('repo', ''))
const pin = flag('pin')
const sha = flag('sha')
const tree = flag('tree')
const outArg = flag('out')
const scene = resolve(flag('scene', join(here, `command-popup-${flag('pin')}.look.ts`)))
const lane = flag('lane')
const PNGS = {
  before: ['before-fallback.png'],
  after: [
    'after-running-no-output.png',
    'after-removed-open.png',
    'after-progress.png',
    'after-finished.png',
    'after-terminal-edge.png',
    'after-terminal-then-removed.png',
    'after-terminal-then-past.png',
    'after-level-then-edge.png',
    'after-loaded-call.png',
  ],
}
if (!flag('repo') || !PNGS[pin] || !/^[0-9a-f]{40}$/.test(sha ?? '') || !/^[0-9a-f]{40}$/.test(tree ?? '') || !outArg)
  die('need --repo, --pin before|after, --sha <40 hex>, --tree <40 hex>, --out <new dir>')
// The main Mac does not run this (Docker lane only). Anywhere else must say which lane admitted it.
if (platform() === 'darwin' && !lane) die('refusing on macOS without --lane "<admission>"')
if (!existsSync(scene)) die(`no scene at ${scene}`)

const git = (...args) => {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  if (r.status !== 0) die(`git ${args.join(' ')} failed: ${r.stderr}`, 3)
  return r.stdout.trim()
}
// 1. The checkout must BE the pin and be clean — a proof of other bytes proves nothing.
if (git('rev-parse', 'HEAD') !== sha) die(`HEAD is ${git('rev-parse', 'HEAD')}, not ${sha}`, 3)
if (git('rev-parse', 'HEAD^{tree}') !== tree) die('tree differs from --tree', 3)
if (git('status', '--porcelain') !== '') die('checkout is not clean before the run', 3)

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const out = resolve(outArg)
mkdirSync(out) // exclusive: no `recursive`, so an existing directory is an error, not a reuse
const target = join(repo, 'apps/desktop/look/scenes/command-popup.look.ts')
const startedAt = new Date().toISOString()
let copied = false
let run
let timedOut = false
try {
  // 2. Own-file exclusive copy of the scene.
  copyFileSync(scene, target, constants.COPYFILE_EXCL)
  copied = true
  const sceneSha = sha256(target)

  // 3. One vitest run, the same engine as `pnpm run look:capture`, with an explicit per-test
  //    timeout and a hard wall-clock kill. Output goes to files in <out>.
  run = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'vitest',
      'run',
      '--config',
      'apps/desktop/vitest.look.config.ts',
      '--testTimeout',
      '90000',
      'look/scenes/command-popup.look.ts',
    ],
    {
      cwd: repo,
      encoding: 'utf8',
      timeout: 300000,
      killSignal: 'SIGKILL',
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        LOOK_PIN: pin,
        LOOK_OUT: join(out, 'final.png'),
        LOOK_WIDTH: '1400',
        LOOK_HEIGHT: '900',
      },
    },
  )
  timedOut = run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGKILL'
  writeFileSync(join(out, 'vitest.stdout.log'), run.stdout ?? '')
  writeFileSync(join(out, 'vitest.stderr.log'), run.stderr ?? '')
  if (timedOut)
    writeFileSync(join(out, 'timeout.txt'), `killed after 300000 ms at ${new Date().toISOString()}\n`)

  // 4. Identity — every value read from the checkout or the run, none assumed.
  const need = createRequire(join(repo, 'apps/desktop/package.json'))
  const version = (name) => {
    try {
      return JSON.parse(readFileSync(need.resolve(`${name}/package.json`), 'utf8')).version
    } catch (e) {
      return `unreadable: ${e.code ?? e.message}`
    }
  }
  const facts = existsSync(join(out, 'facts.json'))
    ? JSON.parse(readFileSync(join(out, 'facts.json'), 'utf8'))
    : null
  const files = readdirSync(out)
    .filter((n) => n.endsWith('.png'))
    .sort()
    .map((n) => {
      const buf = readFileSync(join(out, n))
      const ok = buf.subarray(1, 4).toString() === 'PNG'
      return {
        file: n,
        bytes: buf.length,
        sha256: createHash('sha256').update(buf).digest('hex'),
        ...(ok ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : { notPng: true }),
      }
    })
  const missing = PNGS[pin].filter((n) => !files.some((f) => f.file === n && f.bytes > 0))
  const identity = {
    pin,
    sha,
    tree,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitStatus: run.status,
    signal: run.signal ?? null,
    timedOut,
    lane: lane ?? null,
    host: { platform: platform(), arch: arch(), release: release(), node: process.version },
    sceneSha256: sceneSha,
    driverSha256: sha256(fileURLToPath(import.meta.url)),
    playwright: version('playwright'),
    vitestBrowser: version('@vitest/browser'),
    vitest: version('vitest'),
    // Read by the page itself: user agent (carries the real Chromium build), DPR, viewport, font
    // faces with their load status, and the body's computed font-family.
    page: facts,
    expectedPngs: PNGS[pin],
    missingPngs: missing,
    pngs: files,
    ownedAtEnd: { out, sceneCopyRemoved: false },
  }
  // 5. Cleanup of owned file happens in `finally`; identity is written after it so it can say so.
  globalThis.__identity = identity
} finally {
  if (copied) {
    unlinkSync(target)
  }
  const stray = git('status', '--porcelain')
  const identity = globalThis.__identity ?? {}
  identity.ownedAtEnd = {
    out,
    sceneCopyRemoved: copied && !existsSync(target),
    checkoutCleanAfter: stray === '',
    ...(stray === '' ? {} : { strayStatus: stray }),
  }
  writeFileSync(join(out, 'identity.json'), JSON.stringify(identity, null, 2))
  const bad =
    !run || run.status !== 0 || timedOut || (identity.missingPngs ?? ['?']).length > 0 || stray !== ''
  console.log(
    `${pin}: ${bad ? 'FAILED' : 'ran'} — files in ${out}${
      existsSync(join(out, 'failure.png')) ? ' (failure.png kept)' : ''
    }`,
  )
  process.exitCode = bad ? 1 : 0
  void statSync
}
