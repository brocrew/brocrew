import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AuthUnavailableError,
  ClaudeRuntime,
  CodexRuntime,
  claudeAuthHealthAsync,
  whyNoClaudeLogin,
  claudeKeychainTokenProvider,
  claudeKeychainTokenProviderForALaunch,
  claudeLoginNotRenewed,
  claudeCommandIn,
  defaultKeychainReaderForALaunch,
  type ClaudeLoginRenewal,
  claudeKeychainTokenProviderAsync,
  claudeLoginState,
  claudeLoginStateWithAKey,
  codexAuthHealth,
  createSpawnTransportFactory,
  ensureCodexMemoryConfig,
  probeCodexAuthInHome,
  personalCodexAuthPath,
  provisionCodexAuth,
  replaceARefusedCodexCopy,
  type CodexCopySource,
  type CodexCopyIdentity,
  provisionProviderHome,
  removeStaleCodexPermissionConfig,
  reprovisionCodexAuth,
  startCodexLogin,
  type AgentRuntime,
  type AuthHealth,
  type AuthState,
  type CodexKeyChange,
  type CodexKeyOutcome,
  type CodexLoginOutcome,
  type ReprovisionOutcome,
  type TransportFactory,
} from '@brobot2/runtime'
import { providerSchema, providerValue, type Provider } from '@brobot2/shared'
import { ApiKeyUnreadableError } from './api-keys'
import {
  DEFAULT_PROFILE_ID,
  PATH_SEGMENT_RULE,
  isPathSegment,
  profileAlreadyNamed,
} from '../../shared/runtime-ipc'

/**
 * The app-layer half of provider-home isolation: the runtime owns the *mechanism*
 * (safe provisioning, sanitized child env, auth bridges) and deliberately leaves
 * path derivation and auth wiring to whoever runs the app. This module is that
 * wiring.
 *
 * Layout — `<userData>/provider-homes/default/<profileId>/<provider>` ({@link HOME_FOLDER}). The
 * managed root is `<userData>/provider-homes`, which is what containment is
 * enforced against, so no id can ever redirect a home outside it. The profile is the caller's —
 * {@link DEFAULT_PROFILE_ID} when none is asked for.
 */

/** The managed root directory name under Electron's `userData`. */
export const PROVIDER_HOMES_DIRNAME = 'provider-homes'

/**
 * ⛔ **The one folder under {@link PROVIDER_HOMES_DIRNAME} that every provider home lives in**
 * (D-016).
 *
 * ⚠️ **`default` because it was a project's slug.** Until D-016 this path segment was a project,
 * and every home was made under the same one: each writer of the recorded segment passed
 * `DEFAULT_PROJECT_ID` (`'default'`), whatever project a conversation was placed in, and `0018`
 * backfilled the literal. So every home on disk is under it, and a conversation resumes into the
 * folder it always did.
 * ⛔ **It names a folder and nothing else** — no project, no row, and nothing anybody chooses.
 */
export const HOME_FOLDER = 'default'

/**
 * The profile a session gets when none is asked for.
 *
 * ⚠️ **Declared in `shared/runtime-ipc.ts` since 167 and re-exported here**, because the LAUNCHER
 * now needs it too — to preselect the default, to label it as BroBot, and to refuse a "new" name
 * that is already taken. Every import site in the main process is unchanged; what changed is that
 * there is one literal instead of the renderer carrying its own copy.
 */
export { DEFAULT_PROFILE_ID }

export interface ProviderHomeIdentity {
  profileId: string
  provider: Provider
}

/** The root every provider home must live under. */
export function providerHomesRoot(userData: string): string {
  return join(userData, PROVIDER_HOMES_DIRNAME)
}

/**
 * Ids become path segments, so they are restricted to a conservative alphabet and length —
 * the same rule the IPC boundary and the launcher check against, so none of the three can
 * drift. Containment is enforced again when the home is provisioned; rejecting here just turns
 * a bad id into an obvious error instead of a path that walks out of the root.
 */
function assertPathSegment(label: string, value: string): void {
  if (!isPathSegment(value)) {
    throw new Error(`invalid ${label} "${value}": expected ${PATH_SEGMENT_RULE}`)
  }
}

/** The per-profile home path for one provider. Pure — provisions nothing. */
export function deriveProviderHome(userData: string, identity: ProviderHomeIdentity): string {
  assertPathSegment('profileId', identity.profileId)
  return join(providerHomesRoot(userData), HOME_FOLDER, identity.profileId, identity.provider)
}

/** The folder of a profile's saved methods, beside its provider homes. */
export const SAVED_METHODS_FOLDER = 'runbooks'

/** Where a profile keeps its saved methods, shared by its Claude and Codex homes. Pure. */
export function savedMethodsFolder(userData: string, profileId: string): string {
  assertPathSegment('profileId', profileId)
  return join(providerHomesRoot(userData), HOME_FOLDER, profileId, SAVED_METHODS_FOLDER)
}

/** A home that exists on disk, and the identity the path itself says it belongs to. */
export interface ExistingProviderHome extends ProviderHomeIdentity {
  path: string
}

/**
 * Every provider home this app has actually created, read back out of the managed root.
 *
 * Adoption needs this: a conversation found on disk belongs to the profile whose directory it
 * was in, and taking that from the path means the profile recorded for it is where it really
 * lives — not whatever profile happened to be selected when the scan was run.
 *
 * Only well-formed identities are returned. A directory that does not look like one this app
 * laid down is not one, and guessing an identity for it would produce homes that cannot be
 * provisioned.
 *
 * ⛔ **Only under {@link HOME_FOLDER}, because that is the only folder this app lays a home down
 * in** (D-016). A folder beside it is not a home this app made, and a conversation adopted out of
 * one would be recorded — and resumed — as if it were under {@link HOME_FOLDER}, which is a home it
 * never ran in.
 */
export function listProviderHomes(userData: string): ExistingProviderHome[] {
  const root = join(providerHomesRoot(userData), HOME_FOLDER)
  if (!existsSync(root)) return []

  const homes: ExistingProviderHome[] = []
  for (const profileId of subdirectories(root)) {
    if (!isPathSegment(profileId)) continue
    for (const provider of subdirectories(join(root, profileId))) {
      const parsed = providerSchema.safeParse(provider)
      if (!parsed.success) continue
      homes.push({ profileId, provider: parsed.data, path: join(root, profileId, provider) })
    }
  }
  return homes
}

function subdirectories(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

/**
 * 🔴 **Every profile a person can choose** (167) — {@link DEFAULT_PROFILE_ID} first, the rest sorted.
 *
 * ## ⛔ There is no profile registry, and this is why there does not need to be one
 *
 * A profile has never been an entity in this app: it is a directory under the managed root, brought
 * into existence by {@link prepareProviderHome} the first time a session runs in it. So the list of
 * profiles IS the directory listing, read back the same way {@link listProviderHomes} reads it for
 * adoption — and a list derived from the thing itself cannot fall out of step with it. A registry
 * file would be a second answer, and the first time the two disagreed the wrong one would win
 * silently.
 *
 * ⚑ **{@link DEFAULT_PROFILE_ID} is always in the answer, on disk or not.** A fresh install has no
 * `provider-homes` directory at all, and "there are no profiles" would be a false report of an app
 * whose main agent you can start a conversation with right now. It is first rather than sorted into
 * place, because it is the product's own identity rather than one name among several (167 §2).
 *
 * ⚠️ **Only under {@link HOME_FOLDER}, and that is a live constraint rather than tidiness** — see
 * {@link listProviderHomes}. Every launch this app makes is under it; listing a profile found in
 * some other folder would name a home the launcher cannot open — choosing it would provision a NEW
 * directory under {@link HOME_FOLDER} with the same name, which is the silent-third-profile failure
 * 167 §1.2 asks to be prevented, arriving from the one direction the user could not have caused.
 *
 * ⚠️ **A profile whose home was deleted from outside the app is not in this list**, and that is the
 * honest report: nothing of it exists any more. Its recorded sessions still resume — the row carries
 * the id, and `prepareProviderHome` recreates the directory — and typing the same name into the
 * launcher reaches the same home. The menu is what exists, not what has ever existed.
 */
export function listProfileIds(userData: string): string[] {
  const found = new Set<string>()
  for (const home of listProviderHomes(userData)) {
    if (home.profileId !== DEFAULT_PROFILE_ID) found.add(home.profileId)
  }
  // Plain code-unit order, not `localeCompare`: this is a short list of ASCII path segments (the
  // alphabet is `isPathSegment`'s), and a deterministic order is worth more here than a locale-aware
  // one that varies with the ICU build a machine happens to have.
  return [DEFAULT_PROFILE_ID, ...[...found].sort()]
}

/**
 * ⛔ **A launch may not bring a second spelling of an existing profile into existence** (187 §1,
 * from 168 M5).
 *
 * ⚑ **{@link profileAlreadyNamed} is the rule**, and it is the same call the launcher makes — see
 * its doc for the ruling (refuse, never fold) and for why the policy split lives at the call sites.
 * What this adds is the half that was missing: the launcher's check reaches a person typing into a
 * field, and **nothing at all reached a caller that is not a person** — the IPC schema validates
 * shape and the host provisioned whatever spelling it was handed. A PM spawning agents through an
 * MCP tool is that caller.
 *
 * ## ⛔ It guards CREATION, and only creation — and that boundary was measured, not chosen
 *
 * ⚠️ **The first draft of this ran inside {@link prepareProviderHome}, which is also the RESUME
 * path, and a test written for it caught what that costs.** On the default macOS volume format
 * `mkdir Developer` beside an existing `developer` creates nothing — the directory listing keeps
 * saying `developer`. So a row recorded under `Developer` *before* this rule existed (which is
 * exactly what 168 M5 describes happening) has no `Developer` in {@link listProfileIds}, and a
 * refusal on the resume path would have **stranded that conversation permanently** — 149's failure
 * shape, introduced by the fix for a different one.
 *
 * ⛔ **Resuming an id this app already wrote is not creating an identity**; it opens the folder the
 * session already ran in, which on that volume is the same folder either way. So resume is
 * untouched, and the refusal lives on the one path where a new profile can appear.
 *
 * ⚠️ **The list is the caller's**, so the boundary refuses against exactly the set the launcher's
 * menu is built from. Two lists here would be the drift this whole section is about.
 */
export function assertProfileMayBeCreated(profileId: string, existing: readonly string[]): void {
  const owner = profileAlreadyNamed(profileId, existing)
  if (owner === null || owner === profileId) return
  throw new Error(variantRefusal(profileId, owner))
}

/** The one sentence for a spelling that is an existing profile in different case. */
function variantRefusal(profileId: string, owner: string): string {
  return (
    `profile "${profileId}" is the profile "${owner}" spelled differently — ` +
    'a profile is its folder, and these are one folder on a case-insensitive volume ' +
    `and two on a case-sensitive one. Use "${owner}".`
  )
}

/**
 * ⛔ **What a gesture that is not a launch may name** (197 §2, from 190 H2): an existing profile,
 * spelled the way it exists, and nothing else.
 *
 * ## ⛔ The hole this closes — a read-looking question that created an identity
 *
 * {@link assertProfileMayBeCreated} guards CREATION, and 187 put it on session creation alone —
 * deliberately, because putting it on {@link prepareProviderHome} would have stranded every
 * conversation recorded under a folded spelling. ⚠️ **But the credential gestures do not go through
 * session creation, and they PROVISION a home before they ask their question.** So a valid direct or
 * stale IPC command manufactured the exact second spelling the create boundary promises to refuse:
 *
 * ```ts
 * { kind: "checkProviderAuth", provider: "codex", profileId: "Brobot" }
 * ```
 *
 * ⛔ **620 · the worked example is spelled from {@link DEFAULT_PROFILE_ID} and `592` moved it.**
 * ⚠️ It read `"Default"` against a synthetic `default`; the mechanism is the case fold and is
 * unchanged, but an example naming a profile this app no longer seeds cannot be walked through.
 *
 * On the shipped case-insensitive macOS volume that lands on the same physical directory as
 * {@link DEFAULT_PROFILE_ID} while the dirent can keep the capital, so the next profile list holds
 * the synthetic id AND a physical `Brobot`, and a later `createSession` with `Brobot` passes the
 * exact-first branch — two identities over one home, credentials, memory and all. On a
 * case-sensitive volume it is two homes instead. ⛔ **And a gesture that FAILS still poisons the
 * set**: the directory is made before the transport is built, and nothing rolls it back.
 *
 * ## ⚠️ Why the rule is here and not one level down
 *
 * ⛔ **Not in {@link prepareProviderHome}** — 187 measured what that costs and 190 says so again:
 * that function is the RESUME path, and a refusal there strands a conversation recorded before the
 * rule existed. **A home that is merely OPENED is not a home being created.** The credential
 * gestures are the third thing: they open a home, but they open it by NAME from the wire rather
 * than from a row this app already wrote, and a name from the wire is a name that can be new.
 *
 * ⚑ **{@link DEFAULT_PROFILE_ID} needs no exception.** {@link listProfileIds} always contains it, on
 * disk or not, so its own exact spelling is an exact hit here and the app's own first Codex
 * sign-in still provisions it. A capitalised variant is not, and that is the whole finding.
 * ⛔ **620 · this named that spelling as `default`**, which `592` renamed.
 */
export function assertProfileMayBeOpened(profileId: string, existing: readonly string[]): void {
  const owner = profileAlreadyNamed(profileId, existing)
  if (owner === profileId) return
  throw new ProfileUnopenable(
    owner === null
      ? `there is no profile "${profileId}". A profile comes into existence when a conversation ` +
          'is started in it; asking about its sign-in may not create one.'
      : variantRefusal(profileId, owner),
  )
}

/**
 * ⚠️ **A named class, because one caller has to tell this refusal apart from a provider failure.**
 *
 * `RuntimeHost.checkProviderAuth` turns every throw into `{state:'unknown', reason:'Could not ask
 * <provider> about this profile's sign-in.'}` — which is true of a spawn that hung and false of
 * this, where the app declined to ask and knows exactly why. 086: do not misdescribe the refusal.
 */
export class ProfileUnopenable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProfileUnopenable'
  }
}

/**
 * The credential seams, defaulted to the real ones. They are injectable so tests —
 * and `pnpm run ci` — never read the machine Keychain or the personal `~/.codex`.
 */
export interface ProviderHomeSeams {
  provisionHome?: (managedRoot: string, providerHome: string) => void | Promise<void>
  provisionCodexAuth?: (providerHome: string) => void | Promise<void>
  /** Where this computer keeps its own Codex sign-in; `~/.codex/auth.json` when not given. */
  machineCodexAuthPath?: () => string
  claudeAuthHealth?: () => AuthHealth | Promise<AuthHealth>
  /** The API key a person entered for a provider, or null — see `api-keys.ts`. */
  apiKey?: (provider: Provider) => string | null | Promise<string | null>
  /** 🔒 The person's Codex key, and Codex's own login with it — see {@link CodexKeySeam}. */
  codexKey?: CodexKeySeam
  /** {@link ProviderRuntimeSeams.claudeProgramFound}. */
  claudeProgramFound?: () => string | null
}

/**
 * Claude Code as the person runs it in their shell: the program they have, by its full path
 * (`claudeCommandIn`). Asked only when a sentence says it.
 */
function claudeCommandFor(seams: {
  readonly claudeProgramFound?: () => string | null
}): () => string {
  return () => claudeCommandIn(seams.claudeProgramFound?.() ?? null, process.platform)
}

/**
 * 🔒 **The person's Codex API key, and the login that puts it in a profile home** — the key comes
 * from `api-keys.ts`; the login is Codex's own (`changeCodexKeyInHome`), so Codex keeps the key in
 * its own `auth.json` in that home (`0600`), as it keeps a ChatGPT login.
 */
export interface CodexKeySeam {
  /** The key and when it was saved, or `null`. Throws when a saved key cannot be read. */
  current():
    | { readonly key: string; readonly setAt: number }
    | null
    | Promise<{ readonly key: string; readonly setAt: number } | null>
  /** Presence alone never needs to decrypt a key. */
  isSaved?(): boolean
  change(providerHome: string, change: CodexKeyChange): Promise<CodexKeyOutcome>
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
  userData: string,
  home: string,
  seams: ProviderHomeSeams,
): { managedRoot: string; sourceAuthPath?: string; fallbackAuthPath?: string } {
  const own = deriveProviderHome(userData, { profileId: DEFAULT_PROFILE_ID, provider: 'codex' })
  return {
    managedRoot: providerHomesRoot(userData),
    ...(seams.machineCodexAuthPath === undefined
      ? {}
      : { sourceAuthPath: seams.machineCodexAuthPath() }),
    ...(home === own ? {} : { fallbackAuthPath: join(own, 'auth.json') }),
  }
}

/**
 * Provision the home and make the machine login usable inside it, then hand the
 * path back as launch context.
 *
 *  - **Codex** copies the personal `auth.json` into the profile home once, `0600`.
 *  - **Claude** has nothing to place on disk — its token is injected transiently
 *    into the child env by {@link createProviderRuntime} — so the health of the
 *    machine login is checked here instead, turning "not logged in" into an
 *    explicit error at session creation rather than an opaque provider failure.
 *
 * Either way an unavailable credential is an {@link AuthUnavailableError}; the
 * personal `~/.claude` / `~/.codex` is never used as a fallback.
 *
 * ⚠️ **Uniqueness is NOT checked here** — see {@link assertProfileMayBeCreated} for why this
 * function is the wrong place for it: it is the resume path as well as the launch path, and the two
 * want different answers.
 *
 * ## ⚠️ Asynchronous since 243, and the `await`s below are load-bearing
 *
 * `provisionProviderHome` and `provisionCodexAuth` became `Promise`-returning when the provisioning
 * lock's wait stopped blocking the thread. ⛔ **The seams are typed `void | Promise<void>` and each
 * call is explicitly `await`ed, and BOTH halves of that matter**: a seam typed `=> void` accepts a
 * `=> Promise<void>` implementation under TypeScript's void-return bivariance and then **drops the
 * promise silently** — the whole tree still compiled, with this function handing back a home whose
 * directory did not exist yet and whose credential had not been copied. It typechecked; it was
 * wrong. There are no type-aware lint rules configured here to have caught it.
 */
export async function prepareProviderHome(
  userData: string,
  identity: ProviderHomeIdentity,
  seams: ProviderHomeSeams = {},
): Promise<string> {
  const home = deriveProviderHome(userData, identity)
  await (seams.provisionHome ?? provisionProviderHome)(providerHomesRoot(userData), home)
  if (providerValue(identity.provider, { claude: false, codex: true })) {
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
    if (
      seams.codexKey !== undefined &&
      (await bringTheCodexKeyTo(home, seams.codexKey)) === 'the-key'
    ) {
      return home
    }
    // ⛔ **The real writer is told the managed root; a seam is not** (293 §1). `provisionCodexAuth`
    // re-proves the home's ancestry immediately before it creates the credential, because the
    // ancestor can be swapped between `provisionHome` returning and this line — the same escape one
    // function later. The seam keeps its one-argument shape: a test double has no ancestry to check
    // and no credential to leak.
    if (seams.provisionCodexAuth) await seams.provisionCodexAuth(home)
    else await provisionCodexAuth(home, theCodexCopy(userData, home, seams))
    return home
  }
  const health = await (
    seams.claudeAuthHealth ?? (() => claudeHealth(seams.apiKey, claudeCommandFor(seams)))
  )()
  if (!health.ok) {
    throw new AuthUnavailableError('claude', health.reason ?? 'Claude machine login unavailable')
  }
  return home
}

/**
 * A Claude start on the person's own login: their Claude Code renews the login first when it needs
 * renewing (`renew`), then the home is prepared, which reads the login. `loginRenewed` when the
 * renewal renewed it. A start the login still cannot run says why, with how to renew it by hand.
 */
export async function prepareOnTheLogin(
  prepare: () => string | Promise<string>,
  renew: () => Promise<ClaudeLoginRenewal>,
  /** Claude Code as the person runs it in their shell (`claudeCommandIn`), asked only to say it. */
  command: () => string = () => 'claude',
): Promise<{ readonly home: string; readonly loginRenewed: boolean }> {
  const renewal = await renew()
  try {
    return { home: await prepare(), loginRenewed: renewal === 'renewed' }
  } catch (error) {
    if (
      error instanceof AuthUnavailableError &&
      (renewal === 'not-renewed' || renewal === 'not-installed')
    ) {
      throw new AuthUnavailableError(
        'claude',
        claudeLoginNotRenewed(renewal, process.platform, command()),
      )
    }
    throw error
  }
}

/**
 * Whether a Claude launch has something to run on: the person's API key, else the machine login.
 * ⚑ A key that is set but can no longer be opened is NOT a reason to fall back to the login — the
 * person chose the key — so it answers not-ok, in its own words.
 */
async function claudeHealth(
  apiKey: ((provider: Provider) => string | null | Promise<string | null>) | undefined,
  command: () => string,
): Promise<AuthHealth> {
  try {
    return await claudeAuthHealthAsync(
      claudeKeychainTokenProviderForALaunch(),
      apiKey === undefined ? undefined : () => apiKey('claude'),
      command,
    )
  } catch (error) {
    if (error instanceof ApiKeyUnreadableError) return { ok: false, reason: error.message }
    throw error
  }
}

/**
 * What the composition root must supply to build a runtime. `codexCommand` is the absolute path
 * of the codex executable the app ships (014) — REQUIRED, so no caller can fall back to the bare
 * `codex` PATH lookup that only ever worked on a developer's shell. It is a thunk, resolved per
 * launch inside `createSession`'s error path: a missing binary becomes the actionable command
 * error the surface shows, not a raw `spawn ENOENT` — and never at startup, where nothing could
 * display it. Claude launches never invoke it.
 */
export interface ProviderRuntimeSeams {
  managedProviderHomesRoot?: string
  codexCommand: () => string
  /**
   * The absolute path of the person's Claude Code (`claude-program.ts`). Called at every Claude
   * launch, so a program installed, moved or removed is seen by the next one; it throws the error a
   * person reads when there is none. Codex launches never call it.
   */
  claudeProgram: () => string
  /**
   * The API key a person entered for a provider, or null — see `api-keys.ts`. Read on every launch;
   * absent in tests and for a library caller, which then run on the machine login.
   */
  apiKey?: (provider: Provider) => string | null | Promise<string | null>
  /** 🔒 The person's Codex key, and Codex's own login with it — see {@link CodexKeySeam}. */
  codexKey?: CodexKeySeam
  keyStatus?: (provider: Provider) => { set: boolean; unreadableReason?: string }
  /** Where this computer keeps its own Codex sign-in; `~/.codex/auth.json` when not given. */
  machineCodexAuthPath?: () => string
  /**
   * The person's own Claude Code by its full path, or `null` when none is installed: what a sentence
   * tells them to run to sign in. Never a copy this app's own checkout carries. Absent: `null`.
   */
  claudeProgramFound?: () => string | null
}

/**
 * The adapter for a provider, wired with its auth seam: Claude gets the Keychain
 * token bridge (re-read per launch, fails closed when expired) and the person's
 * own Claude Code, Codex gets the managed-credential health check that runs before
 * the app-server is spawned and the bundled binary, spawned by absolute path.
 * Everything else stays on the adapters' defaults.
 */
export function createProviderRuntime(
  provider: Provider,
  seams: ProviderRuntimeSeams,
): AgentRuntime {
  return providerValue(provider, { claude: true, codex: false })
    ? // Readers of one credential, none blocking the main process: a launch's, which a machine
      // that ran short still throws from, and the turn gate's, which never throws. The blocking
      // one is only the adapter's fallback.
      // ⚑ …and the person's API key, which a launch runs on whenever one is set.
      // …and the person's own Claude Code, looked up now: a computer without one is refused here.
      new ClaudeRuntime(
        undefined,
        undefined,
        claudeKeychainTokenProvider(),
        claudeKeychainTokenProviderAsync(),
        undefined,
        seams.apiKey === undefined ? undefined : () => seams.apiKey?.('claude') ?? null,
        undefined,
        // …and what a launch with nothing to run on says, naming the Claude Code the person has.
        () => whyNoClaudeLogin({ command: claudeCommandFor(seams) }),
        seams.claudeProgram(),
        claudeKeychainTokenProviderForALaunch(),
        seams.managedProviderHomesRoot,
      )
    : new CodexRuntime(createSpawnTransportFactory(seams.codexCommand()), codexAuthHealth)
}

/**
 * The three credential gestures a person can make about a profile home (098), composed here for the
 * same reason every other credential decision is: the runtime owns the mechanism and this module
 * owns which mechanism a provider gets.
 *
 * ⚠️ **`signIn` is the only one that ends the problem, and `reprovision` is the only one that is
 * cheap — they are not alternatives to each other, they are a fast fix and a real one.** See
 * `codex-login.ts` for the measurement of why re-copying breaks again.
 */
export interface ProviderAuthOps {
  /**
   * 🔴 **The home whose authentication state a gesture would change — the identity, not a
   * provisioning** (265 §2, from 259 lens B finding 2).
   *
   * ⛔ **Two writers reached one home with no shared admission.** `signIn` runs an OAuth flow the
   * app-server completes by writing `auth.json`; `reprovision` takes the provider-home lock and
   * atomically replaces the same file — and the app-server participates in no filesystem lock at
   * all. Either operation's success result can therefore be false: a re-copy reports `replaced` and
   * a pending OAuth overwrites it afterwards, or a sign-in probes account A as usable while a late
   * re-copy leaves account B's machine credential on disk. `RuntimeHost` serializes them, and it
   * needs a key to serialize them BY.
   *
   * ⚑ **Pure and synchronous — it is a name, not a directory.** An admission key that had to be
   * awaited would be taken after the window it is meant to close, and one that provisioned would
   * make asking the question create the very identity `assertProfileMayBeOpened` refuses to
   * manufacture (197 §2). Both real gestures still do their own resolving and their own refusing.
   *
   * ⚠️ **The `signIns` reservation does NOT subsume this and must not be re-keyed to it** (257 §1):
   * that one is provider-wide because the OAuth redirect PORT is, and this one is per home because
   * the credential file is. They are two resources and a gesture can need both.
   */
  credentialHome(provider: Provider, profileId: string): string
  /**
   * Ask the provider whether this profile's credential can run a turn. Never spends or refreshes it.
   *
   * ⛔ **`signal` reaches the app-server; the caller's deadline does not** (185). For Codex this
   * spawns a real detached child, and a host that has given up waiting has released only itself.
   */
  check(provider: Provider, profileId: string, signal?: AbortSignal): Promise<AuthState>
  /**
   * Re-copy the machine credential over the profile's. Explicit, user-initiated, does NOT end the race.
   *
   * ⚠️ **The union is what keeps every existing double honest** (243). The real implementation
   * became promise-returning when the provisioning lock did; a test double that answers
   * `'replaced'` outright is still describing the same gesture, and narrowing this to `Promise<…>`
   * would have made it a compile error to say so.
   */
  reprovision(
    provider: Provider,
    profileId: string,
  ): ReprovisionOutcome | Promise<ReprovisionOutcome>
  /**
   * Sign this profile into its own account. Resolves when the browser flow settles.
   *
   * ⛔ **`signal` is the only thing that can stop the sign-in before this resolves** (185): the
   * handle that cancels it does not exist until then, so the whole spawn-and-handshake interval is
   * otherwise unreachable by Cancel and by quit.
   */
  signIn(provider: Provider, profileId: string, signal?: AbortSignal): Promise<CodexSignIn>
  /**
   * 🔒 **Bring every existing home of a provider in line with its API key** — at once, when a
   * person saves or removes the key ({@link bringTheCodexKeyTo}); each home that cannot is brought
   * in line at its next launch instead. ⚑ Answers `null`, or a sentence saying how many could not.
   * Claude keeps nothing in its homes: always `null`.
   */
  bringTheKeyToItsHomes(provider: Provider): Promise<string | null>
  /**
   * Replace a profile's Codex sign-in that Codex has just refused with a fresh copy of the same
   * account, from this computer's own or BroBot's own, whichever Codex refreshed last and later than
   * the copy, only while the copy on disk is still the one that was refused (`refused`), and only
   * while whoever asked still wants it, asked again once the home's lock is held. Says
   * where the copy came from, or that none was made; never while an API key is saved,
   * never for Claude. BroBot's own profile is one of its own candidates, and is never later than
   * itself.
   */
  replaceARefusedCopy(
    provider: Provider,
    profileId: string,
    refused: CodexCopyIdentity,
    stillWanted: () => boolean,
  ): Promise<CodexCopySource | 'not-tried'>
}

/** A sign-in in flight: a URL for the host to open, and the promise of how it ended. */
export interface CodexSignIn {
  authUrl: string
  completed: Promise<CodexLoginOutcome>
  cancel(): Promise<void>
}

/**
 * ⚠️ **Every operation here is Codex-only, and the `claude` arms are refusals rather than stubs.**
 *
 * That asymmetry is the answer to the ticket, not an omission: Claude keeps no credential in the
 * profile home to check, re-copy, or sign in — `claudeKeychainTokenProvider` re-reads the machine
 * Keychain per launch. `capabilities.ts`'s `signIn` entry carries the same fact as data, so a
 * surface asks THAT and never reaches these refusals; they exist so that a caller which does reach
 * them gets a sentence instead of a plausible-looking no-op.
 */
export function createProviderAuthOps(
  userData: string,
  // No Claude program to run: no credential gesture runs Claude Code.
  seams: Omit<ProviderRuntimeSeams, 'claudeProgram'>,
): ProviderAuthOps {
  const transports = (): TransportFactory => createSpawnTransportFactory(seams.codexCommand())
  /**
   * 🔒 **A saved Codex key outranks a sign-in**, so a gesture that would put one in a profile's
   * `auth.json` is refused while a key is saved — else the profile would quietly run on the sign-in
   * while the Providers screen said the key was in use. ⚑ The refusal says how to switch back.
   */
  const refuseWhileAKeyIsSaved = (): void => {
    let saved: boolean
    try {
      if (seams.codexKey?.isSaved !== undefined) saved = seams.codexKey.isSaved()
      else {
        const current = seams.codexKey?.current()
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
  const claudeRefusal = (verb: string): Error =>
    new Error(
      `Claude sessions run on the API key saved in Providers or on your machine login directly — there is no profile credential to ${verb}.`,
    )

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
  const homePathFor = (provider: Provider, profileId: string): string => {
    assertProfileMayBeOpened(profileId, listProfileIds(userData))
    return deriveProviderHome(userData, { profileId, provider })
  }
  const homeFor = async (provider: Provider, profileId: string): Promise<string> => {
    const home = homePathFor(provider, profileId)
    await provisionProviderHome(providerHomesRoot(userData), home)
    return home
  }

  return {
    // ⚠️ **`deriveProviderHome` and NOT `homePathFor`** — no `assertProfileMayBeOpened`. This answers
    // *"which file would this gesture write"* so two gestures can be told apart, and it is asked
    // before either of them has decided whether it is allowed to run. Refusing here would put the
    // 197 §2 boundary in a second place, where a divergence between the two would be invisible; the
    // gestures below still refuse, in the one place that ruling lives.
    //
    // ⛔ It still throws for an id that is not a path segment, because such an id names no home at
    // all — and a gesture admitted under a key nobody else can compute is the defect this closes.
    credentialHome(provider, profileId) {
      return deriveProviderHome(userData, { profileId, provider })
    },
    async check(provider, profileId, signal) {
      if (providerValue(provider, { claude: true, codex: false })) {
        // Claude's credential is the machine's, so "absent" is the only not-ok this can be: there is
        // no copy here that could have gone stale. Saying `stale` would invite a re-copy button for
        // a file that does not exist. ⚑ A saved key is what runs, else the login's own facts — its
        // kind, plan and expiry, never its token (`claudeLoginState`).
        const apiKey = seams.apiKey
        try {
          // A saved key is what runs, and is judged without the login, as before. Without one the
          // login is read without blocking the thread, then judged the same way.
          const status = seams.keyStatus?.('claude')
          if (status?.set) {
            if (status.unreadableReason !== undefined)
              return { state: 'absent', reason: status.unreadableReason }
            return claudeLoginStateWithAKey()
          }
          const keyed = status === undefined ? await apiKey?.('claude') : null
          if (keyed) return claudeLoginStateWithAKey()
          const login = await defaultKeychainReaderForALaunch()
          // ⚑ Its sentence names Claude Code as the person runs it, by the path BroBot found.
          return claudeLoginState(
            () => login,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            claudeCommandFor(seams),
          )
        } catch (error) {
          if (error instanceof ApiKeyUnreadableError) {
            return { state: 'absent', reason: error.message }
          }
          throw error
        }
      }
      const providerHome = await homeFor(provider, profileId)
      // `cwd` is the home itself — nothing here reads the project, and pointing an app-server at a
      // user directory it has no reason to see would be a wider spawn than the question (the same
      // rule `CodexRuntime.listModels` follows).
      return await probeCodexAuthInHome(transports(), providerHome, providerHome, signal)
    },
    // ⚠️ **Deliberately NOT `async`** (243). Both of this gesture's refusals — the Claude arm and
    // `assertProfileMayBeOpened` — are decisions made before any I/O, and an `async` keyword here
    // would turn them into rejections a caller has to `await` to see. The provisioning that follows
    // is the only part that was ever asynchronous, so it is the only part that returns a promise.
    reprovision(provider, profileId) {
      if (providerValue(provider, { claude: true, codex: false })) throw claudeRefusal('re-copy')
      refuseWhileAKeyIsSaved()
      const home = homePathFor(provider, profileId)
      return provisionProviderHome(providerHomesRoot(userData), home).then(() =>
        reprovisionCodexAuth(home),
      )
    },
    async signIn(provider, profileId, signal) {
      if (providerValue(provider, { claude: true, codex: false })) throw claudeRefusal('sign in')
      refuseWhileAKeyIsSaved()
      const providerHome = await homeFor(provider, profileId)
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
    async replaceARefusedCopy(provider, profileId, refused, stillWanted) {
      if (providerValue(provider, { claude: true, codex: false })) return 'not-tried'
      try {
        refuseWhileAKeyIsSaved()
      } catch {
        return 'not-tried'
      }
      const home = homePathFor(provider, profileId)
      const own = deriveProviderHome(userData, { profileId: DEFAULT_PROFILE_ID, provider })
      const managedRoot = providerHomesRoot(userData)
      return await replaceARefusedCodexCopy(home, {
        managedRoot,
        refused,
        stillWanted,
        candidates: [
          {
            from: 'the-computers',
            sourceAuthPath: seams.machineCodexAuthPath?.() ?? personalCodexAuthPath(),
          },
          { from: 'brobots-own', fallback: { path: join(own, 'auth.json'), managedRoot } },
        ],
      })
    },
    async bringTheKeyToItsHomes(provider) {
      const codexKey = seams.codexKey
      if (providerValue(provider, { claude: true, codex: false }) || codexKey === undefined)
        return null
      // ⚑ Every Codex home this app has laid down, one at a time — never one it has not.
      const homes = listProfileIds(userData)
        .map((profileId) => deriveProviderHome(userData, { profileId, provider }))
        .filter((home) => existsSync(home))
      let failed = 0
      for (const home of homes) {
        try {
          if ((await bringTheCodexKeyTo(home, codexKey)) === 'its-login') {
            // ⚑ The copied login comes back where there is one to copy; where there is none, the
            // home simply has no login now, and its next launch says so in its own words.
            await provisionCodexAuth(home, { managedRoot: providerHomesRoot(userData) }).catch(
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
