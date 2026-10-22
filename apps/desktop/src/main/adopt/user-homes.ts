import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { providerValue, type Provider } from '@brobot2/shared'
import {
  discoverSessionsIn,
  type DiscoveredSession,
  type ProviderDescription,
  type SkippedSession,
} from './discover-sessions'

/**
 * The user's OWN provider homes — `~/.claude` and `~/.codex` — and the sessions in them (046).
 *
 * ## Why this exists at all
 *
 * Everything else in this app reads and writes provider homes it PROVISIONED, under `userData`.
 * This module is the one exception, and it is deliberately the only file in the main process that
 * names the real ones. Measured on this machine on 2026-08-03:
 *
 * | | sessions | on disk | oldest |
 * |---|---|---|---|
 * | `~/.claude/projects` | 123 | 1.54 GB | **30.5 days** |
 * | `~/.codex/sessions`  | 1,720 | 10.00 GB | 330 days |
 *
 * Claude's cleanup is real and it is running, and the boundary is sharp: three transcripts sit at
 * 30.5 days, then **nothing** — not one file at 31 days or beyond, across 169 project directories.
 * Codex shows no cleanup at all over the same corpus. So the window is neither a rumour nor
 * generous, and the app cannot archive what it cannot see: until now it only ever looked in its own
 * homes.
 *
 * ## 🔒 It only ever READS
 *
 * These are real transcripts holding sensitive real-world content, and `~/.codex/state_5.sqlite` is
 * the live index Codex itself writes. Nothing here creates, moves or writes anything, and
 * `import-codex.test.ts` asserts structurally that no main-process source both names a user home and
 * writes — this file is exactly the one that check exists to watch.
 *
 * ## What a session found here is, and is not
 *
 * It is bytes worth keeping. It is **not** a session this app can resume: resume reopens a provider
 * in the app-owned home for the session's profile, and these were never in one. They are therefore
 * adopted with **no profile** — the honest answer to "which of our homes was it found in" — and
 * `session-store.ts` reads a profile-less adopted row as unresumable, with that as the reason.
 * Reading and exporting them works; reopening them does not, and says so.
 *
 * ## The other half of the split (043 → 046 §6)
 *
 * Claude's `listSessions()` takes no home option, so it reports whatever `CLAUDE_CONFIG_DIR`
 * resolves to and can never see sessions under our isolated homes. That is not a gap to close: OUR
 * sessions are already in our database, recorded as they ran, with lifecycle the provider's file
 * never held. So the split is by design — the provider homes are read for conversations we never
 * ran, and our own come from our own store. Neither side needs the other's source.
 */

/** One of the user's own provider homes. It belongs to no profile of ours — see the module note. */
export interface UserProviderHome {
  provider: Provider
  path: string
}

/**
 * Where a provider keeps its own home when nobody has told it otherwise, honouring the same
 * environment variables the adapters set on their children (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) so a
 * machine that relocates one is read where it actually lives rather than where it usually is.
 */
export function userProviderHomePath(provider: Provider, env = process.env): string {
  const override = providerValue(provider, { claude: true, codex: false })
    ? env['CLAUDE_CONFIG_DIR']
    : env['CODEX_HOME']
  if (typeof override === 'string' && override !== '') return override
  return join(homedir(), providerValue(provider, { claude: '.claude', codex: '.codex' }))
}

/**
 * ⛔ **`protectedUserHomes` used to live here, and 160 deleted it.**
 *
 * 153 added it to hand `~/.claude` and `~/.codex` to the confinement, so no session of ours could
 * read them. The reason given was that BroBot is unlike the CLI — many agents, some unattended —
 * and that reason does not survive contact: three terminals is three agents, an unattended
 * `--dangerously-skip-permissions` is the same posture as `auto`, and a CLI agent can already read
 * both directories today. Refusing them here made this app stricter than the client it is meant to
 * feel like, for nothing that is true only of BroBot.
 *
 * ⚑ **`726` · R92 removed the one that survived it**: `userData`, where this app puts the
 * credential COPIES it makes (`provisionCodexAuth`), is no longer refused to any session either —
 * *"BroBot and its agents have access to every folder, as Claude Code, Codex and ChatGPT do on
 * their own."*
 *
 * 🔒 **This module is still read-only about these directories**, which is the property that never
 * depended on the confinement: `import-codex.test.ts` asserts structurally that no main-process
 * source both names a user home and writes to it, and this file is the one it watches.
 */

/** The homes that actually exist. A machine with only one provider installed reports only that one. */
export function userProviderHomes(env = process.env): UserProviderHome[] {
  return (['claude', 'codex'] as const)
    .map((provider) => ({ provider, path: userProviderHomePath(provider, env) }))
    .filter((home) => existsSync(home.path))
}

/**
 * A conversation found in the user's own home, with what the sweep needs to archive it.
 *
 * `profileId` is narrowed to **null**, and that is the whole point of the type: there is no profile
 * of ours whose home this was found in, and any string there would be a claim that resume could act
 * on. The store reads a profile-less adopted row as unresumable and says why.
 */
export interface UserHomeSession extends Omit<DiscoveredSession, 'profileId'> {
  profileId: null
  /** The transcript's size on disk. The sweep budgets in bytes, because the files differ by 10^6. */
  bytes: number
}

export interface UserHomeDiscovery {
  found: UserHomeSession[]
  skipped: SkippedSession[]
}

/**
 * Every conversation in the user's own homes, with its size.
 *
 * The discovery itself is `discoverSessionsIn` unchanged — the same reader that finds sessions in
 * our own homes, pointed somewhere else. It already refuses anything it cannot describe from the
 * provider's own files, which matters more here than anywhere: a wrong pointer into someone's real
 * history is worse than no pointer.
 *
 * `profileId` is blanked to null on the way out. `discoverSessionsIn` stamps the profile of the
 * home it was told to read, and there is no truthful value for a directory this app does not own.
 */
export function discoverUserHomeSessions(
  homes: UserProviderHome[] = userProviderHomes(),
): UserHomeDiscovery {
  const found: UserHomeSession[] = []
  const skipped: SkippedSession[] = []

  for (const home of homes) {
    // The profile passed in is discarded below; `discoverSessionsIn` requires one, and a name that
    // says where these came from is more useful in a stack trace than an empty string.
    const discovery = discoverSessionsIn(home.provider, home.path, 'user-home')
    skipped.push(...discovery.skipped)
    for (const session of discovery.found) {
      const bytes = sizeOf(session.path)
      // A transcript that vanished between being listed and being measured is gone, not empty.
      if (bytes === null) {
        skipped.push({
          provider: session.provider,
          path: session.path,
          reason: 'its transcript disappeared while it was being read',
        })
        continue
      }
      found.push({ ...session, profileId: null, bytes })
    }
  }

  return { found, skipped }
}

function sizeOf(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

/** The shape of the SDK call we use, named here so a test can stand in for it without the SDK. */
export type ListClaudeSessions = () => Promise<
  { sessionId: string; summary?: string; customTitle?: string; firstPrompt?: string }[]
>

/**
 * What Claude's own index says about the sessions in the user's home, keyed by session id (047).
 *
 * ## Why the SDK here, and the state database for Codex
 *
 * The two providers are read by different means, and the asymmetry is deliberate rather than
 * historical:
 *
 *  - **Claude** — `listSessions()` is the SDK's own indexed read and it is genuinely READ-ONLY.
 *    Measured against a synthetic home before this was written: it returned the planted session and
 *    changed not one byte in the directory it read. It is also the only cheap way to get a Claude
 *    title, because the transcripts themselves reach a gigabyte.
 *  - **Codex** — the equivalent call, `thread/list`, requires a running `codex app-server`, and a
 *    server can only be pointed at a home by running it THERE. Measured the same way: starting one
 *    against a home wrote **71 files** into it — four SQLite databases with their WALs, an
 *    `installation_id`, and the whole `skills/.system` tree — before any request was sent, and 77
 *    once `thread/list` was issued. `useStateDbOnly: true` does not prevent this; it only skips the
 *    rollout rescan, so the writes it avoids are not the ones that matter. Running that against
 *    `~/.codex` would break this app's one hard rule, so Codex is read from the same `threads` table
 *    `thread/list` itself reads, through a copy — see `discoverCodexSessions`.
 *
 * ## The home it reads
 *
 * `listSessions()` takes no home option and resolves `CLAUDE_CONFIG_DIR`, falling back to
 * `~/.claude` — which is exactly what {@link userProviderHomePath} computes. They therefore agree by
 * construction rather than by coincidence, and `user-homes.test.ts` pins that agreement by planting
 * a session in a temp home and pointing the variable at it. The consequence is the one 043 named: a
 * session of OURS, in an isolated per-profile home, can never appear here — and must not, because
 * ours are already in our database with lifecycle their provider file never held.
 *
 * Failure is empty, not fatal: a machine with no Claude home, or an SDK that cannot read one, costs
 * the captions on those rows and nothing else. The sessions themselves come from the filesystem
 * scan, which does not need this.
 */
export async function claudeHomeDescriptions(
  listSessions?: ListClaudeSessions,
): Promise<Map<string, ProviderDescription>> {
  const described = new Map<string, ProviderDescription>()
  try {
    // Imported HERE rather than at module load: the SDK is a megabyte of bundle, and the sweep —
    // which imports this module for the homes alone — has no use for it.
    const list = listSessions ?? (await import('@anthropic-ai/claude-agent-sdk')).listSessions
    for (const session of await list()) {
      described.set(session.sessionId, {
        // `customTitle` is what the user typed; `summary` is what the SDK derived. Preferring the
        // user's own words is the one ordering decision here, and neither is invented.
        title: session.customTitle ?? session.summary ?? '',
        preview: session.firstPrompt ?? '',
      })
    }
  } catch {
    return described
  }
  return described
}
