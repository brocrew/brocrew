import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { claudeProjectDirName } from '@brobot2/runtime/claude'
import type { Provider } from '@brobot2/shared'
import type { SessionStore } from '../src/main/db/session-store'
import { nativeTranscriptPath } from '../src/main/archive/native-file'
import { deriveLedger } from '../src/main/archive/derive-ledger'
import { asyncLedgerGenerations } from '../src/main/database/sqlite/ledger/generations'
import { linesOf } from './helpers/provider-lines'
import type { RuntimeHost, RuntimeHostDeps } from '../src/main/runtime/runtime-host'
import type { ImportedRecording } from '../src/shared/runtime-ipc'
import { hostsOverAScratchDatabase, providerConfigOf } from './lib/hosts-over-a-scratch-database'

const here = dirname(fileURLToPath(import.meta.url))
const CLAUDE_FIXTURE = join(here, 'fixtures/claude-transcript.jsonl')
const ID = 'sess_child'

describe('one ledger, two hosts, one import', () => {
  let dir: string
  let store: SessionStore
  let hostA: RuntimeHost
  let hostB: RuntimeHost
  /** Host B's press, made from inside host A's import. Null until A gets that far. */
  let pressedByB: Promise<ImportedRecording> | null
  /** How many times host B got as far as looking for the transcript. */
  let bReachedTheHome: number

  const scratch = hostsOverAScratchDatabase('brobot2-two-hosts-')

  /** Everything a host needs, minus the one seam each test wants to reach into. */
  const deps = (lookUp: typeof nativeTranscriptPath): Partial<RuntimeHostDeps> => ({
    nativeTranscriptPath: lookUp,
    prepareProviderHome: (provider, profileId) => homeOf(provider, profileId),
    providerHomePath: (provider, profileId) => join(dir, 'homes', profileId ?? 'none', provider),
    newSessionId: () => `sess_${Math.floor(1)}`,
    readProviderConfig: providerConfigOf('X', 'm'),
  })

  const homeOf = (provider: Provider, profileId: string): string =>
    join(dir, 'homes', profileId, provider)

  beforeEach(() => {
    dir = scratch.dir
    store = scratch.store
    pressedByB = null
    bReachedTheHome = 0

    // Host B is built first so host A's seam can name it.
    hostB = scratch.host(
      deps((provider, home, ref) => {
        bReachedTheHome += 1
        return nativeTranscriptPath(provider, home, ref)
      }),
    )
    hostA = scratch.host(
      deps((provider, home, ref) => {
        // Inside A's import, after its claim and before it reads a byte, B presses Import.
        if (pressedByB === null) pressedByB = hostB.importRecordedSession(ID)
        return nativeTranscriptPath(provider, home, ref)
      }),
    )
  })

  /** An app-owned adopted row: found in a home we provisioned, so it carries a profile. */
  function adoptChild(): void {
    store.adopt({
      id: ID,
      provider: 'claude',
      sessionId: `${ID}-thread`,
      cwd: join(dir, 'work'),
      profileId: 'default',
      updatedAt: 2_000,
      createdAt: 1_000,
      child: { parentSessionId: 'parent-thread', depth: 1, nickname: 'Turing' },
    })
  }

  /** The conversation, in the home this app provisioned for it. */
  function plantOwnTranscript(): void {
    const projectDir = join(
      homeOf('claude', 'default'),
      'projects',
      claudeProjectDirName(join(dir, 'work')),
    )
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, `${ID}-thread.jsonl`), readFileSync(CLAUDE_FIXTURE, 'utf8'))
  }

  it('admits exactly one claimant, and the other is told the work is in flight', async () => {
    adoptChild()
    plantOwnTranscript()
    expect(store.recorded()[0]?.hasTranscript, 'the fixture must start with nothing to read').toBe(
      false,
    )

    const fromA = await hostA.importRecordedSession(ID)
    const fromB = await pressedByB

    expect(pressedByB, 'host B never pressed Import — nothing was contended').not.toBeNull()
    expect([fromA.outcome, fromB?.outcome].sort()).toEqual(['imported', 'in-use'].sort())
    expect(fromB?.note, 'the loser must say what it saw, not fail').toContain('open right now')
    expect(bReachedTheHome, 'the refused host archived and derived regardless').toBe(0)

    const whole = store.events(ID)
    expect(whole.length).toBeGreaterThan(0)
    expect(store.ledgerStatus(ID).present).toBe(true)
    expect(store.ledgerStatus(ID).derived).not.toBe('rebuilding')

    // Uncontended, a second press finds the work done.
    const again = await hostB.importRecordedSession(ID)
    expect(again.outcome).toBe('skipped')
    expect(store.events(ID)).toHaveLength(whole.length)
  })

  it('the flip reports whether it flipped, and both answers are distinguishable', async () => {
    adoptChild()
    const mine = store.beginGeneration(ID)
    const theirs = store.beginGeneration(ID)
    expect(theirs, 'the second open must replace the first').toBeGreaterThan(mine)

    expect(
      store.promoteGeneration(ID, mine, { normalizerVersion: 1, derivedThrough: 0 }),
      'a promotion of a generation nobody is holding must say it flipped nothing',
    ).toBe(false)
    expect(
      store.promoteGeneration(ID, theirs, { normalizerVersion: 1, derivedThrough: 0 }),
      'and the holder’s promotion must still flip',
    ).toBe(true)
  })

  it('a derive whose promotion is refused says `superseded` and leaves the reader whole', async () => {
    adoptChild()
    plantOwnTranscript()
    const archived = await hostB.importRecordedSession(ID)
    expect(archived.outcome, 'the fixture needs a real projection behind it').toBe('imported')
    const wasReadable = store.events(ID).length
    expect(wasReadable).toBeGreaterThan(0)

    // Replace the marker after the derive's own beginGeneration, via the per-batch cancel check.
    let replaced = false
    const lines = readFileSync(CLAUDE_FIXTURE, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
    const outcome = await deriveLedger(
      asyncLedgerGenerations(store),
      ID,
      'claude',
      linesOf(lines),
      {
        fallbackAt: 1_000,
        rebuild: true,
        cancelled: () => {
          if (!replaced && store.ledgerStatus(ID).derived === 'rebuilding') {
            replaced = true
            store.beginGeneration(ID) // somebody else's derive, opening its own
          }
          return false
        },
      },
    )

    expect(replaced, 'the marker was never replaced — the derive promoted its own generation').toBe(
      true,
    )
    expect(outcome, 'a derive whose promotion was refused reported success').toBe('superseded')
    expect(store.events(ID)).toHaveLength(wasReadable)
    expect(store.ledgerStatus(ID).present).toBe(true)
  })
})
