import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OfferedCheckpoint, StartupVerdict } from '../../src/shared/recovery'
import { STEPS } from '../../src/main/recovery/contract'
import {
  FAMILY,
  copyNameOf,
  databaseFile,
  preservedDir,
  recoveryDir,
  restoredAsideDir,
} from '../../src/main/recovery/layout'
import { ONE_NEWER, THIS_BUILD, type FixtureCheckpoint } from './lib/recovery-fixture'
import {
  Scratch,
  UNFLUSHED,
  aCopyOf,
  aService,
  aTemplate,
  conversationsIn,
  crashingAt,
  filesIn,
  journalStep,
  offerOf,
  quiet,
  saidOf,
  sha256,
  stepBefore,
  type CrashPoint,
  type Move,
  type Template,
} from './lib/seat-b-folders'

/**
 * A restore or a return the process stops in, at every point: before and after each journaled
 * step, and just before and just after each rename of each family member. The stop is a crash: the
 * file system refuses every change from that point on, so even the clean-up the service tries at
 * once cannot touch the disk. The next start, a new service on the same folder, must then finish
 * the work or put the data back, and the folder must hold one whole database family: never an
 * empty or missing database, and never a sidecar beside a main file it did not come with.
 *
 * The workspace was left by a crash, so its newest conversation lives only in its `-wal`: a family
 * split from its `-wal` reads back without it.
 */

const scratch = new Scratch()
afterAll(() => scratch.clear())

/** The live names a restore moves: the database family and the drafts that go with it. */
const LIVE_NAMES = [...FAMILY, 'drafts.json'] as const

type Standing = Record<string, string | null>

/** Each live name's sha256, or null where there is no file. */
function standingOf(userData: string): Standing {
  return Object.fromEntries(
    LIVE_NAMES.map((name) => {
      const path = join(userData, name)
      return [name, existsSync(path) ? sha256(readFileSync(path)) : null]
    }),
  )
}

/** Each live name's sha256 in a folder that holds the family under its recovery names. */
function setAsideIn(folder: string): Standing {
  return Object.fromEntries(
    LIVE_NAMES.map((name) => {
      const path = join(folder, copyNameOf(name))
      return [name, existsSync(path) ? sha256(readFileSync(path)) : null]
    }),
  )
}

let template: Template
let restored: FixtureCheckpoint
/** The workspace's own family, as the crash left it. */
let NEWER: Standing
/** The family a finished restore leaves: the copy alone, with its drafts. */
let RESTORED: Standing
let restoreMoves: readonly Move[]
let returnMoves: readonly Move[]

beforeAll(async () => {
  template = await aTemplate(scratch, {
    migrations: ONE_NEWER,
    checkpoints: [THIS_BUILD, ONE_NEWER],
    drafts: true,
    crashed: true,
  })
  const first = template.fixture.checkpoints[0]
  if (first === undefined) throw new Error('the fixture made no copy')
  restored = first
  NEWER = standingOf(template.userData)
  const drafts = restored.manifest.files.find((file) => file.name === 'drafts.json')
  RESTORED = {
    ...Object.fromEntries(LIVE_NAMES.map((name) => [name, null])),
    'brobot2.sqlite': restored.manifest.database.sha256,
    'drafts.json': drafts?.present === true ? drafts.sha256 : null,
  }

  // The renames an uninterrupted restore and return make, in order.
  const userData = await aCopyOf(scratch, template)
  const restoring = crashingAt(userData, null)
  const service = aService(userData, { fs: restoring.fs })
  const offer = offerOf(await service.inspect())
  expect(await service.restore(offer.id, quiet)).toMatchObject({ kind: 'history-only' })
  restoreMoves = [...restoring.moves]
  const returning = crashingAt(userData, null)
  expect(await aService(userData, { fs: returning.fs }).returnToNewer(quiet)).toMatchObject({
    kind: 'newer',
  })
  returnMoves = [...returning.moves]
})

/** Every point to crash at: each side of each step, and each side of each rename. */
function pointsOf(moves: readonly Move[]): CrashPoint[] {
  return [
    ...STEPS.flatMap((step): CrashPoint[] => [{ before: step }, { after: step }]),
    ...moves.flatMap((move): CrashPoint[] => [
      { move, when: 'before' },
      { move, when: 'after' },
    ]),
  ]
}

/** The step the journal names after a crash at `point`; moves happen once the gate is installed. */
function journalAfter(point: CrashPoint): string | null {
  if ('before' in point) return stepBefore(point.before)
  if ('after' in point) return stepBefore(point.after)
  return 'gate-installed'
}

/** What a settled folder must hold: one whole family, and the other kept where it was set aside. */
async function expectOneWholeFamily(
  userData: string,
  as: 'newer' | 'restored',
  restoreId: string,
  said: string,
): Promise<void> {
  expect(existsSync(join(recoveryDir(userData), 'restore-journal.json')), said).toBe(false)
  if (as === 'newer') {
    expect(standingOf(userData), said).toEqual(NEWER)
    expect(await conversationsIn(databaseFile(userData)), said).toEqual(
      template.fixture.conversations,
    )
  } else {
    expect(standingOf(userData), said).toEqual(RESTORED)
    expect(await conversationsIn(databaseFile(userData)), said).toEqual(restored.conversations)
    // Nothing of the newer family is lost: it waits whole where the restore set it aside.
    expect(setAsideIn(preservedDir(userData, restoreId)), said).toEqual(NEWER)
  }
}

describe('a restore the process stops in, then the next start', () => {
  it('found each rename the restore makes', () => {
    // The newer family and its drafts go aside, and only then do the copy and its drafts arrive.
    expect(new Set(restoreMoves.map((move) => `${move.live} ${move.to}`))).toEqual(
      new Set([
        'brobot2.sqlite aside',
        'brobot2.sqlite-wal aside',
        'brobot2.sqlite-shm aside',
        'drafts.json aside',
        'brobot2.sqlite live',
        'drafts.json live',
      ]),
    )
    const lastAside = restoreMoves.map((move) => move.to).lastIndexOf('aside')
    expect(restoreMoves.findIndex((move) => move.to === 'live')).toBeGreaterThan(lastAside)
  })

  it('finishes the restore or puts the newer data back, at every point', async () => {
    const outcomes = new Set<string>()
    for (const point of pointsOf(restoreMoves)) {
      const said = saidOf(point)
      const userData = await aCopyOf(scratch, template)
      const first = await aService(userData, { fs: UNFLUSHED }).inspect()
      const offer: OfferedCheckpoint = offerOf(first)

      const crashing = crashingAt(userData, point)
      await aService(userData, { fs: crashing.fs }).restore(offer.id, quiet)
      expect(crashing.crashed(), `${said}: the point was reached`).toBe(true)
      const left = journalStep(userData)
      expect(left, `${said}: the journal it left`).toBe(journalAfter(point))

      const next = await aService(userData, { fs: UNFLUSHED }).inspect()
      if (left === null) {
        // Nothing was recorded, so nothing had moved: the same offer stands.
        expect(next, said).toEqual(first)
        expect(filesIn(recoveryDir(userData)), `${said}: nothing left in recovery/`).toEqual({})
        await expectOneWholeFamily(userData, 'newer', '', said)
        outcomes.add('as it was')
      } else if (left === 'planned') {
        // The copy was never confirmed checked, so the newer data is put back.
        expect(next, said).toMatchObject({
          kind: 'failed',
          reason: 'restore-failed',
          during: 'restore',
          canRetry: true,
        })
        await expectOneWholeFamily(userData, 'newer', '', said)
        expect(await aService(userData, { fs: UNFLUSHED }).inspect(), said).toEqual(first)
        outcomes.add('put back')
      } else {
        expect(next, said).toMatchObject({
          kind: 'history-only',
          gate: { checkpointId: offer.id, checkpointCreatedAt: offer.createdAt },
        })
        if (next.kind !== 'history-only') throw new Error(said)
        await expectOneWholeFamily(userData, 'restored', next.gate.restoreId, said)
        outcomes.add('finished')
      }
    }
    expect([...outcomes].sort()).toEqual(['as it was', 'finished', 'put back'])
  })
})

describe('a return the process stops in, then the next start', () => {
  it('found each rename the return makes', () => {
    // The restored copy and its drafts go aside, then the newer family and its drafts come back.
    expect(new Set(returnMoves.map((move) => `${move.live} ${move.to}`))).toEqual(
      new Set([
        'brobot2.sqlite aside',
        'drafts.json aside',
        'brobot2.sqlite live',
        'brobot2.sqlite-wal live',
        'brobot2.sqlite-shm live',
        'drafts.json live',
      ]),
    )
  })

  it('finishes the return or leaves the restored copy behind its gate, at every point', async () => {
    const outcomes = new Set<string>()
    for (const point of pointsOf(returnMoves)) {
      const said = saidOf(point)
      const userData = await aCopyOf(scratch, template)
      const service = aService(userData, { fs: UNFLUSHED })
      const offer = offerOf(await service.inspect())
      const before: StartupVerdict = await service.restore(offer.id, quiet)
      if (before.kind !== 'history-only') throw new Error(`${said}: the restore did not finish`)
      const { restoreId } = before.gate

      const crashing = crashingAt(userData, point)
      await aService(userData, { fs: crashing.fs }).returnToNewer(quiet)
      expect(crashing.crashed(), `${said}: the point was reached`).toBe(true)
      const left = journalStep(userData)
      expect(left, `${said}: the journal it left`).toBe(journalAfter(point))

      const next = await aService(userData, { fs: UNFLUSHED }).inspect()
      if (left === null) {
        expect(next, said).toEqual(before)
        await expectOneWholeFamily(userData, 'restored', restoreId, said)
        outcomes.add('still restored')
      } else {
        expect(next, said).toMatchObject({ kind: 'newer', offers: { id: offer.id } })
        await expectOneWholeFamily(userData, 'newer', restoreId, said)
        // The restored copy is kept aside, not deleted.
        expect(setAsideIn(restoredAsideDir(userData, restoreId)), said).toEqual(RESTORED)
        outcomes.add('returned')
      }
    }
    expect([...outcomes].sort()).toEqual(['returned', 'still restored'])
  })
})

describe('the crash this file simulates', () => {
  it('control: a family split from its -wal is caught, since the newest conversation is only there', async () => {
    const userData = await aCopyOf(scratch, template)
    await rm(`${databaseFile(userData)}-wal`)
    await rm(`${databaseFile(userData)}-shm`)
    const read = await conversationsIn(databaseFile(userData))
    expect(read).not.toEqual(template.fixture.conversations)
    expect(read).toEqual(template.fixture.conversations.slice(0, -1))
    expect(standingOf(userData)).not.toEqual(NEWER)
  })

  it('control: it stops every change once reached, so nothing after the point happens', async () => {
    const userData = await aCopyOf(scratch, template)
    const offer = offerOf(await aService(userData, { fs: UNFLUSHED }).inspect())
    const firstOut = restoreMoves[0]
    if (firstOut === undefined) throw new Error('the restore made no move')
    const crashing = crashingAt(userData, { move: firstOut, when: 'after' })
    await aService(userData, { fs: crashing.fs }).restore(offer.id, quiet)
    // The first file went aside and nothing else moved, not even by the service's own clean-up.
    expect(standingOf(userData)).toEqual({ ...NEWER, [firstOut.live]: null })
    expect(journalStep(userData)).toBe('gate-installed')
  })
})
