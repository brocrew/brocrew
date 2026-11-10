/**
 * A provider's program as this computer runs it: what the program prints for `--version`, never a
 * constant, or `version: null` with a sentence when it cannot be said. `program` says which program
 * a launch runs and where it comes from — one a person installed (Claude Code) or the copy this app
 * carries (Codex).
 */
export type ProviderVersion =
  | { readonly version: string; readonly program: ProviderProgram }
  | { readonly version: null; readonly reason: string; readonly program?: ProviderProgram }

/** Where a provider's program came from, in the order the app looks. */
export type ProviderProgramFrom =
  /** The launch was given it (`--brobot-claude-code=<path>`). */
  | 'given'
  /** The copy a development checkout's dependencies carry. */
  | 'development-checkout'
  /** The provider's own installer. */
  | 'native-installer'
  | 'homebrew'
  | 'winget'
  /** npm's global folder. */
  | 'npm'
  /** A folder on `PATH`, installed some other way. */
  | 'path'
  /** The copy this app carries, in a download and in a source checkout alike. */
  | 'carried'

/**
 * How a program stands against the versions this build was tested with. Outside them it still
 * runs, and nothing refuses it. A copy this app carries is the one it was built with, so it is
 * `tested`. Which of them a person is warned about is {@link A_STANDING_WARNS}.
 */
export type ProviderProgramStanding =
  | 'tested'
  | 'older-than-tested'
  | 'newer-than-tested'
  /** Not on this computer: no conversation with that provider can start. */
  | 'missing'
  /** Found, but it did not say its version. */
  | 'unreadable'

/** Another copy of a program on this computer, which a launch does not run. */
export interface ProviderProgramCopy {
  readonly from: ProviderProgramFrom
  readonly path: string
  /** What it printed for `--version`, or `null` when it did not say. */
  readonly version: string | null
  /** One plain line the main process wrote: its version, where it came from, and its path. */
  readonly said: string
}

/** One command a person runs to update a provider's program. */
export interface ProviderProgramUpdate {
  readonly command: string
}

/** The program a launch runs, with its reported provenance and version facts. */
export interface ProviderProgram {
  readonly standing: ProviderProgramStanding
  /** `null` while `missing`. */
  readonly from: ProviderProgramFrom | null
  /** The path every launch passes, `null` while `missing`. */
  readonly path: string | null
  /** What it printed for `--version`, `null` while `missing` or `unreadable`. */
  readonly version: string | null
  /**
   * The oldest and newest version this build was tested with, or `null` where no range applies: a
   * copy this app carries is the one it was built with.
   */
  readonly tested: { readonly oldest: string; readonly newest: string } | null
  readonly said: string
  /** Where to install or update it, or `null` where there is nothing to install: a carried copy. */
  readonly help: { readonly label: string; readonly url: string } | null
  /**
   * The command that updates this copy, as the docs for the way it was installed give it, or `null`
   * where BroBot cannot say how it was installed (given to the launch, a checkout's own, or found on
   * `PATH`) or there is nothing to update (a carried copy, or none found).
   */
  readonly update: ProviderProgramUpdate | null
  /**
   * The other copies installed on this computer, which a launch does not run, in the order they are
   * looked for — so a person can see why updating one of them changed nothing here.
   */
  readonly others: readonly ProviderProgramCopy[]
  /**
   * The version it ran before it last changed while this app ran, or `null` — so an update a person
   * made is seen to land, until the next one.
   */
  readonly updatedFrom: string | null
}

/** A provider may run its own harness without publishing an external program version. */
export interface ProviderProgramOperations {
  version?(): Promise<ProviderVersion>
  installedPath?(): string | null
}
