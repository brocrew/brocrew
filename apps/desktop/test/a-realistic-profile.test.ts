import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { REQUEST_IS_OPEN } from '../src/shared/questions'
import {
  aRealisticProfile,
  OWNER,
  scaled,
  TYPICAL,
  type RealisticProfile,
} from './fixtures/a-realistic-profile'

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
