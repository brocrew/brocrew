import { keptRules } from './kept-rules'
import { skills } from './skills'
import { snapshot } from './snapshot'
import { instructions } from './instructions'
import { memory } from './memory'
import { transcripts } from './transcripts'
import { discovery } from './discovery'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AuthUnavailableError,
  CodexRuntime,
  codexAuthHealth,
  createSpawnTransportFactory,
  ensureCodexMemoryConfig,
  probeCodexAuthInHome,
  personalCodexAuthPath,
  provisionCodexAuth,
  replaceARefusedCodexCopy,
  provisionProviderHome,
  removeStaleCodexPermissionConfig,
  reprovisionCodexAuth,
  startCodexLogin,
  type AgentRuntime,
  type TransportFactory,
} from '@brobot2/runtime'
import { ApiKeyUnreadableError } from '../../runtime/api-keys'
import { prepareStateHome } from '../home'
import type {
  HomeAuthOperations,
  ProviderHomePaths,
  ProvisionHome,
  ProviderHomeStrategy,
  ProviderModule,
} from '../module'
import type { CodexKeySeam } from './types'

export interface CodexRuntimeSeams {
  readonly command: () => string
}
export interface CodexHomeSeams {
  readonly provisionHome?: ProvisionHome
  readonly provisionCodexAuth?: (home: string) => void | Promise<void>
  readonly machineAuthPath?: () => string
  readonly key?: CodexKeySeam
}
export interface CodexAuthSeams {
  readonly command: () => string
  readonly key?: CodexKeySeam
  readonly machineAuthPath?: () => string
}

/**
 * ⚑ **Which key a Codex home was logged in with**, by the moment it was saved — never the key. A
 * home whose stamp is not the current key's is logged in again; a home with a stamp and no key set
 * is logged out, and takes the copied login again.
 */
const CODEX_KEY_STAMP = 'brobot-api-key-login.json'

function codexKeyStampOf(home: string): number | null {
  try {
    const read = JSON.parse(readFileSync(join(home, CODEX_KEY_STAMP), 'utf8')) as {
      setAt?: unknown
    }
    return typeof read.setAt === 'number' ? read.setAt : null
  } catch {
    return null
  }
}

/**
 * 🔴 **Bring one Codex home in line with the person's key** — and say what it runs on now.
 *
 * - **A key is set** and the home was not logged in with it: Codex logs the home in with it. ⚑ The
 *   key outranks a copied ChatGPT login, which Codex's own login replaces.
 * - **No key is set** and the home was logged in with one: Codex logs it out, so the copied login
 *   can take its place again (the caller copies it).
 *
 * ⛔ A login that fails, or that leaves the home on anything but the key, refuses the launch in this
 * app's own words — never by falling back to the copied login the person chose to put aside.
 */
export function bringTheCodexKeyTo(
  home: string,
  codexKey: CodexKeySeam,
): Promise<'the-key' | 'its-login'> {
  // ⚑ **One at a time per home**: two saves in quick succession, or a save beside a launch, must
  // not let an older login land after a newer one's stamp.
  const before = keyChangesInFlight.get(home) ?? Promise.resolve()
  const mine = before.catch(() => undefined).then(() => bringTheCodexKeyToNow(home, codexKey))
  const settled = mine.then(
    () => undefined,
    () => undefined,
  )
  keyChangesInFlight.set(home, settled)
  void settled.then(() => {
    if (keyChangesInFlight.get(home) === settled) keyChangesInFlight.delete(home)
  })
  return mine
}

/** ⚑ The key change running for each Codex home — {@link bringTheCodexKeyTo}'s queue. */
const keyChangesInFlight = new Map<string, Promise<void>>()

async function bringTheCodexKeyToNow(
  home: string,
  codexKey: CodexKeySeam,
): Promise<'the-key' | 'its-login'> {
  let current: Awaited<ReturnType<CodexKeySeam['current']>>
  try {
    current = await codexKey.current()
  } catch (error) {
    if (error instanceof ApiKeyUnreadableError)
      throw new AuthUnavailableError('codex', error.message)
    throw error
  }
  const stamp = codexKeyStampOf(home)
  if (current !== null) {
    // ⚑ The stamp says what BroBot did; the home must still hold a login for it to stand.
    if (stamp === current.setAt && existsSync(join(home, 'auth.json'))) return 'the-key'
    const done = await codexKey.change(home, { to: 'the-key', apiKey: current.key })
    if (!done.ok) throw new AuthUnavailableError('codex', `${done.reason} Try again in a moment.`)
    if (done.authMethod !== 'apikey') {
      throw new AuthUnavailableError(
        'codex',
        'Codex did not take the API key saved under “API key” on the Codex card in Providers. ' +
          'Save it again there, or remove it to use your sign-in instead.',
      )
    }
    writeFileSync(join(home, CODEX_KEY_STAMP), `${JSON.stringify({ setAt: current.setAt })}\n`, {
      mode: 0o600,
    })
    return 'the-key'
  }
  if (stamp === null) return 'its-login'
  const done = await codexKey.change(home, { to: 'no-key' })
  if (!done.ok) throw new AuthUnavailableError('codex', `${done.reason} Try again in a moment.`)
  rmSync(join(home, CODEX_KEY_STAMP), { force: true })
  return 'its-login'
}

/**
 * Where a Codex home's first start copies its sign-in from: this computer's own, else BroBot's own
 * profile's, so an agent can start on a computer signed in to Codex only inside BroBot. Its writer
 * is told the managed root, so it re-proves the home it writes into.
 */
function theCodexCopy(
  paths: ProviderHomePaths,
  home: string,
  seams: CodexHomeSeams,
): { managedRoot: string; sourceAuthPath?: string; fallbackAuthPath?: string } {
  const own = paths.homeOf(paths.defaultProfile)
  return {
    managedRoot: paths.managedRoot,
    ...(seams.machineAuthPath === undefined ? {} : { sourceAuthPath: seams.machineAuthPath() }),
    ...(home === own ? {} : { fallbackAuthPath: join(own, 'auth.json') }),
  }
}

export function codexRuntime(seams: CodexRuntimeSeams): AgentRuntime {
  return new CodexRuntime(createSpawnTransportFactory(seams.command()), codexAuthHealth)
}

export async function prepareCodexHome(
  paths: ProviderHomePaths,
  profileId: string,
  seams: CodexHomeSeams,
): Promise<string> {
  const home = await prepareStateHome(paths, profileId, seams.provisionHome)

  // ⛔ **160's migration runs HERE too, and not only on the launch path** (188 §1, from 168 L2).
  // The adapter clears a stale 157 `config.toml` on `start` and `resume`, which reaches every home
  // that is relaunched — and no home that is not. A profile the user only ever ADOPTED sessions
  // into, or one whose conversations have all ended, keeps a deny-list over `~/.claude`, `~/.codex`
  // and `userData` that its own first line calls *"rewritten on every session launch"* and that
  // nothing rewrites. This is the one function every Codex home passes through on its way to a
  // run — a start, a resume or a model probe. ⚠️ Reading old history does not come here: an
  // import reads files and asks for no credential (`RuntimeHost.archiveAndImportOne`).
  removeStaleCodexPermissionConfig(home)
  // ⛔ **And 314's two gates, HERE as well as on the launch path**, for the same reason the line
  // above is here (188 §1): this is the one function every Codex home passes through on its way to
  // a run, and a home a model probe asks about is reached by no `start` and no `resume`. ⚠️ The
  // disclosure in `provider-config.ts` names this file as the place BroBot declares memory, so a
  // home the app has prepared and never launched must not be a home where that sentence is false.
  ensureCodexMemoryConfig(home)
  // 🔒 **A person's API key outranks the copied login** — the home is logged in with it, and
  // nothing is copied. With none set, a home that held one is logged out first.
  if (seams.key !== undefined && (await bringTheCodexKeyTo(home, seams.key)) === 'the-key') {
    return home
  }
  // ⛔ **The real writer is told the managed root; a seam is not** (293 §1). `provisionCodexAuth`
  // re-proves the home's ancestry immediately before it creates the credential, because the
  // ancestor can be swapped between `provisionHome` returning and this line — the same escape one
  // function later. The seam keeps its one-argument shape: a test double has no ancestry to check
  // and no credential to leak.
  if (seams.provisionCodexAuth) await seams.provisionCodexAuth(home)
  else await provisionCodexAuth(home, theCodexCopy(paths, home, seams))
  return home
}

export function codexAuth(paths: ProviderHomePaths, seams: CodexAuthSeams): HomeAuthOperations {
  const transports = (): TransportFactory => createSpawnTransportFactory(seams.command())
  /**
   * 🔒 **A saved Codex key outranks a sign-in**, so a gesture that would put one in a profile's
   * `auth.json` is refused while a key is saved — else the profile would quietly run on the sign-in
   * while the Providers screen said the key was in use. ⚑ The refusal says how to switch back.
   */
  const refuseWhileAKeyIsSaved = (): void => {
    let saved: boolean
    try {
      if (seams.key?.isSaved !== undefined) saved = seams.key.isSaved()
      else {
        const current = seams.key?.current()
        if (current instanceof Promise) {
          void current.catch(() => undefined)
          throw new Error('An asynchronous key reader needs a presence check')
        }
        saved = current != null
      }
    } catch {
      saved = true // a key that cannot be read is still a key the person saved
    }
    if (saved) {
      throw new Error(
        'An API key is saved for Codex, and it is what Codex runs on. Remove it under “API key” on ' +
          'the Codex card in Providers to use a sign-in instead.',
      )
    }
  }

  /**
   * ⚠️ **The home, WITHOUT the auth copy — and that distinction is the whole reason these ops
   * resolve their own home rather than taking one** (098, review findings 4/17/19).
   *
   * They used to be handed `prepareProviderHome`'s answer, which is the SESSION-launch path: it
   * provisions the directory *and* runs `provisionCodexAuth`. Three things went wrong with that, all
   * of them in exactly the situation this feature exists for:
   *
   *  1. On a machine with no `~/.codex/auth.json` at all, `provisionCodexAuth` **throws**, so "is
   *     this profile signed in?" answered with an exception instead of `absent` — the one state it
   *     was built to distinguish.
   *  2. Pressing **Copy my machine sign-in** on an empty profile silently copied first and then
   *     reported `unchanged`, because the copy-once path had already done the work.
   *  3. Merely ASKING a question wrote a credential to disk.
   *
   * `provisionProviderHome` is the directory half on its own: containment-checked, `0700`, no
   * credential. Every other guarantee — path-segment validation, the managed root — is unchanged,
   * because it lives in the same two functions.
   */
  // ⛔ **The one door every credential gesture goes through, so the rule is on the door** (197 §2,
  // from 190 H2). Each of the three used to reach `provisionProviderHome` with whatever spelling
  // the wire carried, and a directory made here is a profile — so *asking* whether a profile was
  // signed in could bring a second spelling of an existing one into existence. ⚠️ **Before the
  // mkdir**, because 190 measured that a gesture which then fails (no binary, refused spawn,
  // cancelled sign-in) leaves the directory behind with nothing to roll it back.
  //
  // ⚑ **`listProfileIds`, re-read**, so this and the launcher's menu are built from one list —
  // and a profile created a moment ago by a launch is openable immediately.
  //
  // ⚠️ **Split in two by 243, and the seam is where the I/O starts.** The rule and the derivation
  // are decisions about a STRING and stay synchronous; only the provisioning became a `Promise`.
  // Keeping them apart means a gesture aimed at a profile that does not exist is still refused
  // **before** anything is awaited — which is what it always was, and what a caller can still
  // observe as a throw rather than as a rejection.
  const homePathFor = (profileId: string): string => {
    paths.assertMayOpen(profileId)
    return paths.homeOf(profileId)
  }
  const homeFor = async (profileId: string): Promise<string> => {
    const home = homePathFor(profileId)
    await provisionProviderHome(paths.managedRoot, home)
    return home
  }
  return {
    credentialHome(profileId) {
      return paths.homeOf(profileId)
    },
    async check(profileId, signal) {
      const providerHome = await homeFor(profileId)
      // `cwd` is the home itself — nothing here reads the project, and pointing an app-server at a
      // user directory it has no reason to see would be a wider spawn than the question (the same
      // rule `CodexRuntime.listModels` follows).
      return await probeCodexAuthInHome(transports(), providerHome, providerHome, signal)
    },
    reprovision(profileId) {
      refuseWhileAKeyIsSaved()
      const home = homePathFor(profileId)
      return provisionProviderHome(paths.managedRoot, home).then(() => reprovisionCodexAuth(home))
    },
    async signIn(profileId, signal) {
      refuseWhileAKeyIsSaved()
      const providerHome = await homeFor(profileId)
      const { login, start } = await startCodexLogin(
        transports(),
        providerHome,
        providerHome,
        signal,
      )
      return {
        authUrl: start.authUrl,
        completed: login.completed(),
        cancel: () => login.cancel(),
      }
    },
    async replaceARefusedCopy(profileId, refused, stillWanted) {
      try {
        refuseWhileAKeyIsSaved()
      } catch {
        return 'not-tried'
      }
      const home = homePathFor(profileId)
      const own = paths.homeOf(paths.defaultProfile)
      const managedRoot = paths.managedRoot
      return await replaceARefusedCodexCopy(home, {
        managedRoot,
        refused,
        stillWanted,
        candidates: [
          {
            from: 'the-computers',
            sourceAuthPath: seams.machineAuthPath?.() ?? personalCodexAuthPath(),
          },
          { from: 'brobots-own', fallback: { path: join(own, 'auth.json'), managedRoot } },
        ],
      })
    },
    async bringTheKeyToItsHomes() {
      const codexKey = seams.key
      if (codexKey === undefined) return null
      // ⚑ Every Codex home this app has laid down, one at a time — never one it has not.
      const homes = paths
        .profiles()
        .map((profileId) => paths.homeOf(profileId))
        .filter((home) => existsSync(home))
      let failed = 0
      for (const home of homes) {
        try {
          if ((await bringTheCodexKeyTo(home, codexKey)) === 'its-login') {
            // ⚑ The copied login comes back where there is one to copy; where there is none, the
            // home simply has no login now, and its next launch says so in its own words.
            await provisionCodexAuth(home, { managedRoot: paths.managedRoot }).catch(
              (error: unknown) => {
                if (!(error instanceof AuthUnavailableError)) throw error
              },
            )
          }
        } catch (error) {
          failed += 1
          console.warn(
            `could not bring a Codex profile in line with its API key: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      }
      if (failed === 0) return null
      return failed === homes.length
        ? 'BroCrew could not update Codex’s login in any profile yet; each is updated when it next starts.'
        : `BroCrew could not update Codex’s login in ${String(failed)} of ${String(homes.length)} profiles yet; each is updated when it next starts.`
    },
  }
}

export interface CodexModuleSeams {
  readonly runtime: CodexRuntimeSeams
  readonly home: CodexHomeSeams
  readonly auth: CodexAuthSeams
}

/** The same factories serve bound modules and the legacy facade adapters. */
export const codexModuleFactory = {
  runtime:
    (seams: CodexRuntimeSeams): (() => AgentRuntime) =>
    () =>
      codexRuntime(seams),
  home: (paths: ProviderHomePaths, seams: CodexHomeSeams): ProviderHomeStrategy => ({
    prepare: (profileId) => prepareCodexHome(paths, profileId, seams),
  }),
  auth: codexAuth,
}

export function createCodexModule(
  paths: ProviderHomePaths,
  seams: CodexModuleSeams,
): ProviderModule {
  return {
    transcripts,
    instructions,
    memory,
    snapshot,
    skills,
    keptRules,
    discovery,
    createRuntime: codexModuleFactory.runtime(seams.runtime),
    home: codexModuleFactory.home(paths, seams.home),
    auth: codexModuleFactory.auth(paths, seams.auth),
  }
}
