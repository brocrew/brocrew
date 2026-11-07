import { neutralHostDeps } from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { FakeRuntime } from '@brobot2/runtime'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import {
  aRealisticProfile,
  EXTREME,
  OWNER,
  scaled,
  TYPICAL,
  type RealisticProfile,
} from './fixtures/a-realistic-profile'

function aHostOver(store: SessionStore, profile: RealisticProfile, folder: string): RuntimeHost {
  return new RuntimeHost({
    store,
    archived: profile.archive(),
    ...neutralHostDeps(() => folder),
    createRuntime: (provider) => new FakeRuntime(provider),
    prepareProviderHome: (provider) => join(folder, 'homes', provider),
    providerHomePath: (provider) => join(folder, 'homes', provider),
    resolveCwd: (sessionId, requested) => requested ?? join(folder, 'scratch', sessionId),
    newSessionId: () => `sess_${String(Math.random()).slice(2)}`,
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CODEX_HOME',
      model: 'm',
      authNote: null,
      files: [],
    }),
  })
}

/** The generator's own guards: the same seed writes the same rows, and the rows mean what it says. */
describe('a realistic profile', () => {
  const size = scaled(TYPICAL, 0.1)
  let directory: string
  let profile: RealisticProfile
  let db: AppDatabase
  let store: SessionStore

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'fictional-profile-'))
    profile = aRealisticProfile(join(directory, 'one.sqlite'), size, 7)
    db = openDatabase(profile.file)
    store = createSessionStore(db)
  }, 60_000)

  afterAll(() => {
    db?.close()
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  })

  it('writes the same rows for the same seed, and other rows for another', () => {
    const again = aRealisticProfile(join(directory, 'two.sqlite'), size, 7)
    const other = aRealisticProfile(join(directory, 'three.sqlite'), size, 8)
    expect(again.digest).toBe(profile.digest)
    expect(other.digest).not.toBe(profile.digest)
    expect(profile.counts['question_asked']).toBe(size.questions)
  })

  it('writes every conversation as one that has started and can be resumed', () => {
    expect(store.resumable().length).toBe(profile.live.length + profile.expected.archived.length)
    expect(store.unresumable()).toEqual([])
    // A host settles what its start finds open, so it reads its own copy of the same profile.
    const copy = aRealisticProfile(join(directory, 'host.sqlite'), size, 7)
    const other = openDatabase(copy.file)
    try {
      const host = aHostOver(createSessionStore(other), copy, directory)
      expect(
        host
          .resumableSessions()
          .map((one) => one.sessionId)
          .sort(),
      ).toEqual([...copy.live].sort())
    } finally {
      other.close()
    }
  })

  it('at the extreme size, a host lists only the live conversations while the archived ones keep their routed history', () => {
    const extreme = aRealisticProfile(join(directory, 'extreme.sqlite'), scaled(EXTREME, 0.02), 3)
    const other = openDatabase(extreme.file)
    try {
      const its = createSessionStore(other)
      const host = aHostOver(its, extreme, directory)
      expect(extreme.expected.archived.length).toBeGreaterThan(0)
      expect(
        host
          .resumableSessions()
          .map((one) => one.sessionId)
          .sort(),
      ).toEqual([...extreme.live].sort())
      const askers = new Set(its.whoRoutedToWhom().map((one) => one.asker))
      expect(extreme.expected.archived.some((id) => askers.has(id))).toBe(true)
    } finally {
      other.close()
    }
  })

  it('holds the open pieces it chose, owner by owner', () => {
    for (const id of profile.live) {
      expect(store.openPiecesOf(id).length, id).toBe(profile.expected.openPieces.get(id) ?? 0)
    }
  })

  it('holds the open routed requests it chose, with their recipients', () => {
    for (const [asker, open] of profile.expected.openRoutes) {
      const read = store
        .routedRequestsOf(asker)
        .filter((one) => REQUEST_IS_OPEN[one.state] && one.parent !== null)
      expect(new Map(read.map((one) => [one.requestId, one.parent])), asker).toEqual(open)
    }
  })

  it('holds what a person must answer and decide', () => {
    const questions = store
      .questionsAPersonMustAnswer()
      .rows.map((one) => `${one.askedBy} ${one.requestId}`)
    expect(questions.sort()).toEqual([...profile.expected.personQuestions].sort())
    const decisions = store
      .decisionsAwaitingAPerson()
      .rows.map((one) => `${one.askedBy} ${one.requestId}`)
    expect(decisions.sort()).toEqual(profile.expected.decisions)
  })

  it('finds each passed-up copy where it was written', () => {
    for (const [request, holders] of profile.expected.copyHolders) {
      expect([...store.conversationsHoldingACopyOf(request)].sort(), request).toEqual(
        [...holders].sort(),
      )
    }
  })

  it('holds its asks, replacements and children', () => {
    expect(store.instructionAsksWaiting()).toHaveLength(profile.expected.instructionAsks)
    expect(store.mcpServerRequestsWaiting()).toHaveLength(profile.expected.mcpRequests)
    expect(new Map(store.replacements().map((one) => [one.replaced, one.by]))).toEqual(
      profile.expected.replacements,
    )
    expect(
      store
        .spawnedBy(OWNER)
        .rows.map((one) => one.conversation)
        .sort(),
    ).toEqual([...profile.expected.children].sort())
  })
})
