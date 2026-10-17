import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, hostname, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { expect } from 'vitest'
import { CODEX_AUTH, HOMES_DIRNAME } from '../../lib/clean-base.mjs'
import { DATA_FOLDER_NAME, pastedImagesRoot } from '../../lib/user-data.mjs'

/**
 * ⚑ **717 · the planted userData both halves of `clean-base`'s tests stand on** (R45).
 *
 * ⛔ **R45 split `scripts/gate-only/clean-base.test.mjs`**: the tests that never spawn the script
 * went back to `scripts/test/clean-base-without-running-it.test.mjs`, so the mutation rows they kill
 * can be re-verified again, and the half that spawns it stayed gate-only. ⚑ Both plant the same
 * userData, so the fixture lives here ONCE rather than as two copies that can drift apart.
 *
 * ⚠️ **It plants and removes only under the system temp directory**, and it runs nothing: no process, no
 * `clean-base`. It imports two NAMES from the library, never an act — which is what
 * `clean-base-runs-only-in-the-gate.test.mjs` lets a file an ordinary run collects from do.
 *
 * ⛔ **And it is where R46's guard lives** ({@link mustNameScratch}), because the question it asks —
 * *is this path scratch?* — is answered by the one list of fixtures this module made.
 */

/** Above macOS's `kern.maxproc` ceiling, so no live process can ever carry it. */
export const DEAD_PID = 999999

const roots = []

/** Every fixture root this file made, removed — each test file calls it from its own `afterEach`. */
export function removeFixtures() {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function fixture() {
  const home = homedir()
  const guarded = [
    home,
    join(home, '.claude'),
    join(home, '.codex'),
    join(home, 'Library', 'Application Support', '@brobot2'),
    join(home, '.config', '@brobot2'),
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    process.env.XDG_CONFIG_HOME,
  ].filter(Boolean)
  const inside = (path, candidate) => {
    const from = relative(resolve(path), candidate)
    return from === '' || (from !== '..' && !from.startsWith(`..${sep}`) && !isAbsolute(from))
  }
  const safe = (candidate) => !guarded.some((path) => inside(path, candidate))
  const base = realpathSync(tmpdir())
  if (!safe(base)) throw new Error('system temp overlaps a real home or app-data directory')
  const root = mkdtempSync(join(base, 'b351-cb-'))
  if (!safe(realpathSync(root))) {
    rmSync(root, { recursive: true, force: true })
    throw new Error('fake fixture root overlaps a real home or app-data directory')
  }
  roots.push(root)
  expect(existsSync(root)).toBe(true)
  return root
}

/**
 * Require each clean-base call to target a fixture created by this module before spawning it. Check
 * --dir and its pasted-images sibling both as written and after resolving links; a fixture root's
 * sibling is outside that fixture. Calls with no directory must have every environment-derived
 * fallback inside such a fixture. Refuse --dir= syntax because this guard accepts only --dir
 * followed by a value. A scratch HOME is per call and never implied for the whole file, so real
 * provider-home roots remain protected in forbidden-root tests.
 */
export function mustNameScratch(args, { env = {}, cwd = process.cwd() } = {}) {
  const dirs = []
  let dangling = false
  for (let at = 0; at < args.length; at += 1) {
    if (args[at].startsWith('--dir=')) {
      throw new Error(`${args[at]}: this guard does not read \`--dir=\` — not started (R46)`)
    }
    if (args[at] === '--dir') {
      if (at + 1 < args.length) dirs.push(args[at + 1])
      else dangling = true
      at += 1
    }
  }
  for (const dir of dirs) {
    // ⚠️ Against the PHYSICAL cwd — the child's `process.cwd()` has its links followed, so a `..`
    // under a linked cwd climbs from where the link leads (`717`'s review, round 2).
    const path = resolve(whereItLeads(resolve(cwd)), dir)
    if (!sweptBy(path).every((one) => isScratch(one))) {
      throw new Error(`--dir ${dir} is not a fixture this file made — not started (R46)`)
    }
  }
  if (dirs.length === 0 || dangling) {
    const child = { ...process.env, ...env }
    const swept = env.HOME === undefined ? [] : fallbacksUnder(child).flatMap(sweptBy)
    if (env.HOME === undefined || !swept.every((one) => isScratch(one))) {
      throw new Error(
        `${JSON.stringify(args)} falls back to a directory derived from HOME, and this call's HOME ` +
          'is not a fixture this file made — not started (R46)',
      )
    }
  }
}

/**
 * ⚑ **Every directory `clean-base` falls back to under this environment, and the
 * sibling `clean-base` sweeps beside each** — `userDataFor`'s own derivation (`lib/user-data.mjs`),
 * spelled out because that one reads THIS process's `HOME` and the child's is the question.
 * `clean-base-starts-only-on-scratch.test.mjs` holds the two derivations equal.
 */
export function fallbacksUnder(env, platform = process.platform) {
  const base =
    platform === 'darwin'
      ? join(env.HOME, 'Library', 'Application Support')
      : platform === 'win32'
        ? (env.APPDATA ?? join(env.HOME, 'AppData', 'Roaming'))
        : (env.XDG_CONFIG_HOME ?? join(env.HOME, '.config'))
  return [join(base, DATA_FOLDER_NAME), pastedImagesRoot(join(base, DATA_FOLDER_NAME))]
}

/**
 * ⚑ **What `clean-base` touches for a target**: the target, and the `-pasted-images` sibling of the
 * target as typed AND of where it leads — the script sweeps the sibling of the RESOLVED userData
 * (`pastedImagesRoot(anchor.real)`), so a link to a fixture root would put that one outside it.
 */
function sweptBy(path) {
  return [path, pastedImagesRoot(path), pastedImagesRoot(whereItLeads(path))]
}

/**
 * At or under a fixture this module made — as typed, or as the OS resolves it — and LEADING there:
 * the path is followed through its nearest existing ancestor, so a link inside a fixture that points
 * out of it is not scratch, whether or not the rest exists yet.
 */
function isScratch(path) {
  return underAFixture(path) && underAFixture(whereItLeads(path))
}

function underAFixture(path) {
  return roots.some((root) =>
    [root, realpathSync(root)].some((one) => path === one || path.startsWith(`${one}${sep}`)),
  )
}

/** `path` with every link in its existing part followed; the part that does not exist yet, as is. */
function whereItLeads(path) {
  let rest = ''
  for (let at = path; ; at = dirname(at)) {
    try {
      return join(realpathSync(at), rest)
    } catch {
      if (dirname(at) === at) return path
      rest = join(basename(at), rest)
    }
  }
}

/**
 * Include several profiles so the fixture detects leftover launcher entries rather than testing
 * only the built-in profile. Keep default as a legacy profile name, not as the app's own profile
 * identifier.
 */
export const HIS_PROFILES = Object.freeze([
  'default',
  'developer',
  'mem-1',
  'mem-2',
  'repo-investigation',
])

/** A userData that looks like one a real launch leaves behind. */
export function plantUserData(
  root,
  { authMode = 0o600, profiles = ['default'], extra = () => {} } = {},
) {
  const userData = join(root, 'ud')
  const codex = join(userData, HOMES_DIRNAME, 'default', 'default', 'codex')
  const claude = join(userData, HOMES_DIRNAME, 'default', 'default', 'claude')
  for (const profile of profiles) {
    const home = join(userData, HOMES_DIRNAME, 'default', profile)
    mkdirSync(join(home, 'codex', 'sessions', '2026', '09'), { recursive: true })
    mkdirSync(join(home, 'claude', 'projects'), { recursive: true })
    // ⚠️ **Different bytes per profile** (352 §3). His four copies held one refresh token and the
    // fifth had been rewritten by a rotation — so a test that plants one identical string in all of
    // them cannot see a keep that took the wrong file.
    writeFileSync(join(home, 'codex', CODEX_AUTH), `not-a-real-credential-${profile}\n`)
    chmodSync(join(home, 'codex', CODEX_AUTH), authMode)
    writeFileSync(join(home, 'codex', 'config.toml'), '[memories]\n')
    writeFileSync(join(home, 'codex', 'sessions', '2026', '09', 'rollout.jsonl'), '{}\n')
    writeFileSync(join(home, 'claude', 'projects', 's.jsonl'), '{}\n')
  }
  mkdirSync(join(userData, 'brobot-workspace'), { recursive: true })
  // ⚑ **D-016 · the files kept for pieces of work** — planted so that "a clean base" is asserted over
  // the one durable BroBot write that is neither the ledger nor a provider home (`380`'s documents
  // tree held that place until D-016). ⚑ Kept where the app keeps one: `resources/<sha256>/<name>`.
  const reply = '# a reply\n'
  const kept = join(userData, 'resources', createHash('sha256').update(reply).digest('hex'))
  mkdirSync(kept, { recursive: true })
  writeFileSync(join(kept, 'report.md'), reply)
  mkdirSync(join(userData, 'exports', 'projects'), { recursive: true })
  mkdirSync(join(userData, 'Cache'), { recursive: true })
  mkdirSync(join(userData, 'Local Storage', 'leveldb'), { recursive: true })
  writeFileSync(join(userData, 'brobot2.sqlite'), 'ledger\n')
  writeFileSync(join(userData, 'brobot2.sqlite-wal'), 'wal\n')
  writeFileSync(join(userData, 'brobot-workspace', 'CLAUDE.md'), '# instructions\n')
  writeFileSync(join(userData, 'brobot-workspace', 'notes-from-an-agent.md'), 'work\n')
  writeFileSync(join(userData, 'exports', 'a1.brobot-session.json'), '{"version":1}\n')
  writeFileSync(join(userData, 'Cache', 'data_0'), 'chromium\n')
  writeFileSync(join(userData, 'Local Storage', 'leveldb', 'LOG'), 'x\n')
  // ⚠️ **The Chromium leaves a live app has at the top level, as SYMLINKS** — measured on a real
  // launch of this build, where `SingletonLock` pointed at `alex-laptop.local-3541`. They are
  // why the manifest's kind comes from the dirent: an entry the reset does not recognise can still
  // be a link, and a link is unlinked by name.
  //
  // ⛔ **The target has to be REALISTIC or the fixture tests something else.** The first draft
  // pointed it at a path; `readSingletonLock` could not parse that, correctly answered `unknown`,
  // and every test in this file refused. `DEAD_PID` is above macOS's maximum, so this is the
  // ordinary shape a crash leaves: a well-formed lock naming a process that is gone.
  symlinkSync(`${hostname()}-${String(DEAD_PID)}`, join(userData, 'SingletonLock'))
  symlinkSync('4412747004272557171', join(userData, 'SingletonCookie'))
  extra({ userData, codex, claude })
  expect(existsSync(join(codex, CODEX_AUTH)), 'the fixture credential was not planted').toBe(true)
  return userData
}
