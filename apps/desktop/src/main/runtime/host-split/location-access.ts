import type { Provider } from '@brobot2/shared'
import type { SessionHandle } from '@brobot2/runtime'
import type {
  ConfigFileResult,
  MessagePath,
  MessagePathAsk,
  MessagePathTarget,
  OpenMessagePathResult,
  ProviderConfigInfo,
  RevealResult,
  SessionPathTarget,
} from '../../../shared/runtime-ipc'
import type { ResumableSession, SessionStore } from '../../db/session-store'
import { readConfigFile } from '../../config-file'
import {
  THIS_COMPUTER,
  openMessagePath,
  resolveMessagePaths,
  revealMessagePath,
  type MessagePathPlace,
} from '../../message-paths'
import { realPathOf } from '../../read-text-file'

interface LiveLocation {
  readonly provider: Provider
  readonly cwd: string
  readonly providerHome: string
  readonly handle: Pick<SessionHandle, 'instructionSources'>
}

interface LocationDependencies {
  readonly store: Pick<SessionStore, 'find'>
  readProviderConfig(provider: Provider, providerHome: string): ProviderConfigInfo
  openPath?(path: string): Promise<string>
  revealPath?(path: string): void
  readonly messagePathPlace?: MessagePathPlace
}

/** Where a conversation's files are: its live session's places, or the ones its record names. */
export class LocationAccess {
  constructor(
    private readonly deps: LocationDependencies,
    private readonly liveSession: (sessionId: string) => LiveLocation | null | undefined,
    private readonly providerHomeFor: (
      row: Pick<ResumableSession, 'adoptedAt' | 'profileId' | 'provider'>,
    ) => string,
  ) {}

  /**
   * **Show one of this session's paths in the file manager** (356 §1).
   *
   * ⛔ **The renderer names a ROW, and the string is looked up here.** Every file door in this app
   * refuses a renderer-supplied path by construction, and a reveal that accepted one would invert
   * that ruling for the sake of a smaller diff. Each target below is something this host already
   * holds for the session: the directory it launched in, the home it launched against, one of the
   * files `readProviderConfig` reports, or one row of the provider's own list.
   *
   * ⚠️ **`no-path` and `gone` are different sentences.** `no-path` means the row named nothing this
   * host holds — a config file this provider does not have, an index past the end of the list.
   * `gone` means there is a name but nothing at it, which is the ordinary state of a file that was
   * deleted after the session read it.
   */
  revealPath(sessionId: string, target: SessionPathTarget): RevealResult {
    // 🔴 **736 · `733` F-5 — an ENDED conversation is revealed from its ledger row**, as its Open
    // reads from it ({@link readConfigFile}): the panel still draws its folder, its home and its
    // config files, and until `736` each Finder press answered *"this session has no such path"*.
    // ⚠️ Not a provider-reported instruction source: that list lives on the live handle only and is
    // never recorded, so an ended conversation's provider row still answers `no-path`.
    const session = this.liveSession(sessionId) ?? this.endedPlacesOf(sessionId)
    if (!session) return { ok: false, reason: 'no-path' }
    const path = ((): string | null => {
      switch (target.of) {
        case 'cwd':
          return session.cwd
        case 'home':
          return session.providerHome
        case 'config-file':
          return (
            this.deps
              .readProviderConfig(session.provider, session.providerHome)
              .files.find((file) => file.name === target.name)?.path ?? null
          )
        case 'instruction-source':
          return session.handle?.instructionSources?.[target.index] ?? null
      }
    })()
    if (path === null || path === '') return { ok: false, reason: 'no-path' }
    // ⛔ **Resolved before it is handed over, and the result is discarded.** `realPathOf` is here to
    // answer *"is there anything at this name"* — a reveal of a path that is gone opens a Finder
    // window on nothing, and the panel would have no way to say so. ⚠️ What is REVEALED is the
    // original path, not the resolved one: a person who pressed the row expects the folder the row
    // named, and following a link somewhere else would be answering a question nobody asked.
    if (!realPathOf(path).ok) return { ok: false, reason: 'gone' }
    this.deps.revealPath?.(path)
    return { ok: true, path }
  }

  /** The working folder a message's relative paths are read from, or `null` for none. */
  private messageFolderOf(sessionId: string | null): string | null {
    if (sessionId === null) return null
    const where = this.liveSession(sessionId) ?? this.endedPlacesOf(sessionId)
    return where?.cwd || null
  }

  /** What each path-like text in one message names now ({@link resolveMessagePaths}). */
  resolveMessagePaths(ask: MessagePathAsk): Promise<MessagePath[]> {
    return resolveMessagePaths(
      ask.texts,
      this.messageFolderOf(ask.sessionId),
      this.deps.messagePathPlace ?? THIS_COMPUTER,
      { mayOpen: true },
    )
  }

  /** A press on a message's path: opened if it is a document on the allowlist, else shown. */
  openMessagePath(target: MessagePathTarget): Promise<OpenMessagePathResult> {
    return openMessagePath(
      target.text,
      this.messageFolderOf(target.sessionId),
      this.deps.messagePathPlace ?? THIS_COMPUTER,
      { open: this.deps.openPath, reveal: this.deps.revealPath },
    )
  }

  /** A message's path shown in the file manager, never opened. */
  revealMessagePath(target: MessagePathTarget): Promise<RevealResult> {
    return revealMessagePath(
      target.text,
      this.messageFolderOf(target.sessionId),
      this.deps.messagePathPlace ?? THIS_COMPUTER,
      this.deps.revealPath,
    )
  }

  /**
   * 🔴 **736 · where an ENDED conversation ran, off its ledger row** — its provider, its folder and
   * its home — for {@link revealPath}, or `null` for an id this app has no record of. ⚑ The home is
   * {@link providerHomeFor}'s, the rule {@link readConfigFile}'s ended branch reads it by, so a
   * config file's Open and its Finder name the same file. No handle: nothing is running.
   */
  private endedPlacesOf(
    sessionId: string,
  ): { provider: Provider; cwd: string; providerHome: string; handle?: undefined } | null {
    const row = this.deps.store.find(sessionId)
    if (row === null) return null
    return { provider: row.provider, cwd: row.cwd, providerHome: this.providerHomeFor(row) }
  }

  /**
   * 🔴 **733 · one config file this session's home holds, read now** — the Info panel's Open
   * (`731` F-2, R92). See `main/config-file.ts`.
   *
   * ⚠️ **The same two steps as {@link readInstructionSource}**: the list comes off what this host
   * already reports for the session — `readProviderConfig`, the same call {@link revealPath} looks
   * a config row up in — and only then is one NAME of it handed to a reader.
   *
   * ⚑ **An ENDED conversation is read from its ledger row** (`733` review): the panel still draws
   * its config files, and R92 is *"opened if it exists and is readable"* — so the home comes from
   * the row, as {@link readChildWork}'s does, rather than from a slot that closing removed. ⛔ Only
   * an id this app has no record of answers `no-path`.
   */
  readConfigFile(sessionId: string, name: string): ConfigFileResult {
    const live = this.liveSession(sessionId)
    if (live) {
      return readConfigFile(
        this.deps.readProviderConfig(live.provider, live.providerHome).files,
        name,
      )
    }
    const row = this.deps.store.find(sessionId)
    if (row === null) return { ok: false, reason: 'no-path' }
    const home = this.providerHomeFor(row)
    return readConfigFile(this.deps.readProviderConfig(row.provider, home).files, name)
  }
}
