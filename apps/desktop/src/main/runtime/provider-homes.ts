import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentRuntime } from '@brobot2/runtime'
import { providerSchema, type Provider } from '@brobot2/shared'
import { providerAuthFromHomes } from '../providers'
import { homeStrategyFor, legacyAuthOperations, runtimeFactoryFor } from '../providers/compat'
import type { ProviderAuthOps, ProviderHomeSeams, ProviderRuntimeSeams } from '../providers/compat'
import type { ProviderHomePaths } from '../providers/module'
import {
  DEFAULT_PROFILE_ID,
  PATH_SEGMENT_RULE,
  isPathSegment,
  profileAlreadyNamed,
} from '../../shared/runtime-ipc'

export { bringTheCodexKeyTo, prepareOnTheLogin } from '../providers'
export type { CodexKeySeam, CodexSignIn } from '../providers/codex/types'
export type { ProviderAuthOps, ProviderHomeSeams, ProviderRuntimeSeams } from '../providers/compat'

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
export function listProfileIds(userData: string, provider?: Provider): string[] {
  const found = new Set<string>()
  for (const home of listProviderHomes(userData)) {
    if (provider !== undefined && home.provider !== provider) continue
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

/** Bind the existing pure state paths; no home, credential or profile is created here. */
export function homePathsForProvider(userData: string, provider: Provider): ProviderHomePaths {
  return {
    managedRoot: providerHomesRoot(userData),
    defaultProfile: DEFAULT_PROFILE_ID,
    homeOf: (profileId) => deriveProviderHome(userData, { profileId, provider }),
    profiles: () => listProfileIds(userData),
    assertMayOpen: (profileId) => assertProfileMayBeOpened(profileId, listProfileIds(userData)),
  }
}

export async function prepareProviderHome(
  userData: string,
  identity: ProviderHomeIdentity,
  seams: ProviderHomeSeams = {},
  recordedLocation?: string,
): Promise<string> {
  return await homeStrategyFor(
    identity.provider,
    homePathsForProvider(userData, identity.provider),
    seams,
  ).prepare(identity.profileId, recordedLocation)
}

export function createProviderRuntime(
  provider: Provider,
  seams: ProviderRuntimeSeams,
): AgentRuntime {
  return runtimeFactoryFor(provider, seams)()
}

export function createProviderAuthOps(
  userData: string,
  seams: Omit<ProviderRuntimeSeams, 'claudeProgram'>,
): ProviderAuthOps {
  return providerAuthFromHomes(
    legacyAuthOperations((provider) => homePathsForProvider(userData, provider), seams),
  )
}
