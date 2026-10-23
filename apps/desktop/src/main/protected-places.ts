import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { SUPPORTED_PROVIDERS, providerRecord, type Provider } from '@brobot2/shared'
import { providerDefinitions } from './providers/definitions'
import { sameFolder } from './same-folder'
import { readWorkspaceList } from './workspaces'
import { whereItStands } from '../../../../scripts/lib/safe-remove.mjs'
import type {
  ProtectedPlaceKind,
  ProtectedPlaceNotice,
  ProtectedPlaceStanding,
} from '../shared/work-folders'

/**
 * Describe protected places met by a supplied work folder without refusing it. See `shared/work-folders.ts` for the wording.
 *
 * ⚑ **Compared by what the folders ARE, never by how they are spelled** — `whereItStands` (the
 * reset guard's own comparison, W4.124: device and file id, through links, case and macOS's
 * `/System/Volumes/Data` spelling). ⚑ **A comparison that cannot be answered is said**, as
 * `could-not-check` — the notice's way of failing closed, since nothing is refused.
 *
 * ⚑ **Which place, when a folder meets several**: one it IS, then one it is INSIDE — the most
 * specific (a profile's provider home, not this data folder around it) — then one it HOLDS — the
 * broadest (the data folder, not the provider homes inside it; the home folder, not the providers'
 * folders inside that).
 */

/** Where the places are, for this computer and this run. */
export interface ThePlaces {
  /** The person's home folder. */
  readonly home: string
  /** Claude Code's and Codex's own folders: the conventional ones and any redirected one. */
  readonly providerConfigHomes: Readonly<Record<Provider, readonly string[]>>
  /** The folder holding every profile's provider homes. */
  readonly providerHomesRoot: string
  /** This app's data folder, and the workspace folder inside it that is not named. */
  readonly appData: { readonly folder: string; readonly workspace: string }
  /** Every other workspace's data folder this app lists, and each one's workspace folder. */
  readonly otherWorkspaces: readonly { readonly folder: string; readonly workspace: string }[]
}

/**
 * ⚑ **The places as this computer has them** — the providers' own folders where they conventionally
 * are AND where this process's environment redirects them (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, read
 * as adoption reads them), the provider homes, this data folder and every other listed workspace's,
 * each with its own workspace folder. ⚠️ A redirection set only in a shell profile is not in the
 * environment of an app launched from the Finder, and is not known here.
 */
export function thePlacesOnThisComputer(args: {
  /** The person's home folder; this process's own by default. */
  readonly home?: string
  readonly userData: string
  readonly providerHomesRoot: string
  /**
   * The file that lists this computer's workspaces (`workspaceListFile`) — every other data folder
   * it names is one of the places. ⚑ Read here, where nothing chooses a launch's folder.
   */
  readonly workspaceList: string
  readonly workspaceOf: (dataFolder: string) => string
  readonly env?: NodeJS.ProcessEnv
}): ThePlaces {
  const env = args.env ?? process.env
  const home = args.home ?? homedir()
  return {
    home,
    providerConfigHomes: providerRecord((provider) =>
      providerDefinitions[provider].discovery.configHomes(home, env),
    ),
    providerHomesRoot: args.providerHomesRoot,
    appData: { folder: args.userData, workspace: args.workspaceOf(args.userData) },
    otherWorkspaces: readWorkspaceList(args.workspaceList)
      .map((one) => one.path)
      .filter((folder) => !sameFolder(folder, args.userData))
      .map((folder) => ({ folder, workspace: args.workspaceOf(folder) })),
  }
}

type Standing = ProtectedPlaceStanding | null | undefined

/**
 * ⚑ **Where a path really is** — through every link, in the spelling on the disk
 * (`realpathSync.native`, which also settles case on a case-blind disk). `null`: nothing is there;
 * `undefined`: it could not be asked. ⚠️ `whereItStands` walks the folders ABOVE a path as spelled,
 * so a link INTO a place, or a place that is itself a link, is only met once both are real (the
 * W4.189 review measured both missed).
 */
function realOf(path: string): string | null | undefined {
  try {
    return realpathSync.native(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR' ? null : undefined
  }
}

/**
 * Where `folder` stands against `place`, by what each IS — `undefined`: it could not be compared;
 * `null` for a place that is not there.
 */
const standing = (folder: string, place: string): Standing => {
  const there = realOf(place)
  if (there === null) return null
  const here = realOf(folder)
  if (here === undefined || there === undefined) return undefined
  return whereItStands(here ?? folder, there) as Standing
}

/**
 * ⚑ **The notice for `folder`, or `null`: it meets none of the places.** Each rule says which of
 * *is*, *inside* and *holds* it names:
 *  - a provider's own folder, the provider homes, a data folder: all three — but a data folder's
 *    workspace folder, and anything inside it, is where agents work, and is not named;
 *  - the home folder: itself, or a folder holding it — never one inside it;
 *  - `/`: itself only, since everything is inside it.
 */
export function aProtectedPlace(folder: string, places: ThePlaces): ProtectedPlaceNotice | null {
  let unknown = false
  const meets = (
    kind: ProtectedPlaceKind,
    place: string,
    names: readonly ProtectedPlaceStanding[],
  ): ProtectedPlaceNotice | null => {
    const stands = standing(folder, place)
    if (stands === undefined) {
      unknown = true
      return null
    }
    return stands !== null && names.includes(stands) ? { kind, place, stands } : null
  }
  const all: readonly ProtectedPlaceStanding[] = ['is', 'inside', 'holds']
  /** A data folder, its workspace excepted. */
  const dataFolder = (
    kind: ProtectedPlaceKind,
    data: { readonly folder: string; readonly workspace: string },
  ): ProtectedPlaceNotice | null => {
    const inTheWorkspace = standing(folder, data.workspace)
    if (inTheWorkspace === undefined) {
      unknown = true
      return null
    }
    if (inTheWorkspace === 'is' || inTheWorkspace === 'inside') return null
    return meets(kind, data.folder, all)
  }
  const checks: (() => ProtectedPlaceNotice | null)[] = [
    ...SUPPORTED_PROVIDERS.flatMap((provider) =>
      places.providerConfigHomes[provider].map(
        (place) => () =>
          meets(providerDefinitions[provider].discovery.protectedPlaceKind, place, all),
      ),
    ),
    () => meets('profile-homes', places.providerHomesRoot, all),
    () => dataFolder('app-data-folder', places.appData),
    ...places.otherWorkspaces.map(
      (other) => () => dataFolder('another-workspace-data-folder', other),
    ),
    () => meets('home-folder', places.home, ['is', 'holds']),
    () => meets('filesystem-root', '/', ['is']),
  ]
  const found = checks.flatMap((check) => {
    const one = check()
    return one === null ? [] : [one]
  })
  const thoseItStands = (wanted: ProtectedPlaceStanding): ProtectedPlaceNotice[] =>
    found.filter((one) => 'stands' in one && one.stands === wanted)
  const named =
    thoseItStands('is')[0] ?? thoseItStands('inside')[0] ?? thoseItStands('holds').at(-1)
  return named ?? (unknown ? { kind: 'could-not-check' } : null)
}
