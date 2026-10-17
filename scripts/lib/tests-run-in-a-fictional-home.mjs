// Every test process runs in a fictional home, so no test, and no planted defect that removes a
// test's own isolation, can read a person's sign-in, saved key or data folder.
//
// A vitest config calls `theTestsEnv()` for each of its projects' `env` and names `THE_GUARD` in
// their `setupFiles`. The folder is made once per run, in the process that reads the configs, and
// removed when it exits. Test processes get the variables below before any test code loads; the
// process that runs vitest itself keeps its own home.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The setup file that refuses to run a test file whose process can see the real home. */
export const THE_GUARD = fileURLToPath(
  new URL('./a-test-sees-no-real-home.setup.mjs', import.meta.url),
)

/**
 * Names the folder to the configs read after the first in the same run, with the pid of the process
 * that made it: a value inherited from anywhere else is not believed.
 */
export const MADE = 'BROBOT_TESTS_HOME_MADE'

/** How every fictional home's folder name begins. */
export const THE_TESTS_HOME_IS_NAMED = 'brobot2-tests-home-'

/** The variable a test process reads its fictional home from. */
export const TESTS_HOME = 'BROBOT_TESTS_HOME'

/** What the stand-in Keychain program holds: it answers as a computer with no login does. */
export const THE_STAND_IN_KEYCHAIN_PROGRAM = '#!/bin/sh\nexit 44\n'

/**
 * Variables that hold a credential by themselves. No test process keeps one: the setup file removes
 * each before a test file loads, so a failed comparison of a child's environment prints none.
 */
export const NO_TEST_HOLDS = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
]

/**
 * Every variable a program reads a person's own folders from, each to a place in the fictional
 * home: the home itself on every system, the providers' own folders (Claude Code's second name for
 * where it keeps a login and Codex's for its database among them), where Node versions are kept,
 * the XDG folders, and where Windows keeps an app's data.
 */
export function theVariablesFor(home) {
  return {
    HOME: home,
    USERPROFILE: home,
    CFFIXED_USER_HOME: home,
    CODEX_HOME: join(home, '.codex'),
    CODEX_SQLITE_HOME: join(home, '.codex'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CLAUDE_SECURESTORAGE_CONFIG_DIR: join(home, '.claude'),
    NVM_DIR: join(home, '.nvm'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    XDG_CACHE_HOME: join(home, '.cache'),
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
  }
}

function made() {
  const [maker, ...path] = (process.env[MADE] ?? '').split(':')
  if (maker === String(process.pid) && path.length > 0 && existsSync(path.join(':'))) {
    return path.join(':')
  }
  // Its own real path, as a person's home is: a test may compare a path under the home with one
  // the disk resolved.
  const home = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), THE_TESTS_HOME_IS_NAMED)))
  // A test that commits to a scratch repository needs an identity; this one is nobody's.
  writeFileSync(
    join(home, '.gitconfig'),
    '[user]\n\tname = A Test\n\temail = a-test@example.invalid\n[init]\n\tdefaultBranch = main\n',
  )
  // macOS keeps Claude Code's login in the Keychain, read with the `security` program by name. This
  // one comes first on a test process's path and finds nothing, as on a computer with no login.
  const bin = join(home, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'security'), THE_STAND_IN_KEYCHAIN_PROGRAM)
  chmodSync(join(bin, 'security'), 0o755)
  process.env[MADE] = `${process.pid}:${home}`
  process.on('exit', () => rmSync(home, { recursive: true, force: true }))
  return home
}

/** What a project's `env` is: the fictional home, by every name, with its `bin` first on the path. */
export function theTestsEnv() {
  const home = made()
  return {
    ...theVariablesFor(home),
    [TESTS_HOME]: home,
    PATH: `${join(home, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
  }
}
