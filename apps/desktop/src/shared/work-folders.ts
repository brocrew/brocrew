/**
 * 🔴 **W4.189 · a give's folder, as this app used it — and the places it says plainly.**
 *
 * A give can grant an existing helper conversation its work folder until that work ends, without changing its cwd. Report a folder that meets a protected place to the giver and person rather than refuse it for that location.
 */

/** A place this app names when a give's folder meets it ({@link ProtectedPlaceNotice}). */
export type ProtectedPlaceKind =
  /** `/` itself. */
  | 'filesystem-root'
  /** The person's home folder itself, or a folder holding it — never one inside it (`~/dev/x`). */
  | 'home-folder'
  /** Claude Code's own folder: `~/.claude`, or the `CLAUDE_CONFIG_DIR` it is redirected to. */
  | 'claude-config-home'
  /** Codex's own folder: `~/.codex`, or the `CODEX_HOME` it is redirected to. */
  | 'codex-config-home'
  /** The folder holding every profile's provider homes, in this app's data folder. */
  | 'profile-homes'
  /** This app's data folder, but for its workspace folder (where agents work). */
  | 'app-data-folder'
  /** Another workspace's data folder this app lists, but for that one's workspace folder. */
  | 'another-workspace-data-folder'

/** Where a folder stands against a place: that place, inside it, or holding it. */
export type ProtectedPlaceStanding = 'is' | 'inside' | 'holds'

/**
 * ⚑ **D's notice** — said, never a refusal. `could-not-check`: a folder needed to compare could not
 * be read, so whether it meets one of the places is not known, and that is said too.
 */
export type ProtectedPlaceNotice =
  | {
      readonly kind: ProtectedPlaceKind
      /** The place, as this app spells it. */
      readonly place: string
      readonly stands: ProtectedPlaceStanding
    }
  | { readonly kind: 'could-not-check' }

/** How this app used a give's folder. */
export type GivenFolderUse =
  /** The folder a conversation the give started works in. */
  | 'working-folder'
  /** A grant on a conversation that already existed: it may also work there while the piece is open. */
  | 'grant'

/**
 * ⚑ **A give's folder, as recorded on the give** (`WorkGivenEvent.givenFolder`, `WorkSentEvent`'s
 * too) — absent on a give that named none, and on every give recorded before this build: an older
 * row's folder is never read as a grant.
 */
export interface GivenFolder {
  /** The folder, as resolved: a relative one is read from the giver's own folder. */
  readonly folder: string
  readonly use: GivenFolderUse
  /** A default parallel-piece output folder, named separately from a native working directory. */
  readonly output?: true
  /** ⚑ D: present when the folder meets one of the places this app names. */
  readonly notice?: ProtectedPlaceNotice
}

/**
 * ⚑ **A grant a conversation holds now** (`SessionLiveness.workFolders`) — one per open piece that
 * granted a folder. `queued`: the piece's brief has not reached it yet, or the turn that carries it
 * has not started; `applied`: the turn it is in, or the last one, was started with it.
 */
export interface WorkFolderGrant {
  readonly folder: string
  readonly piece: string
  readonly label: string
  /** The conversation that gave the piece. */
  readonly givenBy: string
  readonly state: 'queued' | 'applied'
}

const PLACE_NAMED: Readonly<Record<ProtectedPlaceKind, string>> = {
  'filesystem-root': 'the top of the disk',
  'home-folder': 'the home folder',
  'claude-config-home': 'Claude Code’s own folder, where its sign-in and settings are',
  'codex-config-home': 'Codex’s own folder, where its sign-in and settings are',
  'profile-homes': 'the folder holding every agent profile’s Claude and Codex homes',
  'app-data-folder': 'this app’s data folder, where its database is',
  'another-workspace-data-folder': 'another workspace’s data folder, where its database is',
}

const STANDING_SAID: Readonly<Record<ProtectedPlaceStanding, string>> = {
  is: 'is',
  inside: 'is inside',
  holds: 'holds',
}

/**
 * 🔴 **D's words, one sentence for every surface** — the giver's receipt and the window — so no two
 * say it differently. ⛔ It refuses nothing and says nothing was refused: R92.
 */
export function protectedPlaceSaid(folder: string, notice: ProtectedPlaceNotice): string {
  if (notice.kind === 'could-not-check') {
    return `Whether ${folder} is or holds one of the places this app names (a provider’s own folder, this app’s data, the home folder) could not be checked: a folder needed to compare could not be read. It was used all the same.`
  }
  const named = PLACE_NAMED[notice.kind]
  const where = notice.stands === 'is' ? named : `${named} (${notice.place})`
  return `${folder} ${STANDING_SAID[notice.stands]} ${where}. It was used all the same: nothing here refuses a folder.`
}
