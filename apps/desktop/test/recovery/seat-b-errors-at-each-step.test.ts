import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StartupVerdict } from '../../src/shared/recovery'
import { listCheckpoints, type CheckpointStep } from '../../src/main/recovery/checkpoint'
import { FAULT_CODES, type RecoveryFaults } from '../../src/main/recovery/coordinator'
import { STEPS, type Step } from '../../src/main/recovery/contract'
import type { RecoveryFs } from '../../src/main/recovery/files'
import {
  FAMILY,
  copyNameOf,
  databaseFile,
  preservedDir,
  stagedRoot,
} from '../../src/main/recovery/layout'
import { START_FAILURES, failedWords } from '../../src/renderer/src/lib/recovery-words'
import {
  Scratch,
  UNFLUSHED,
  aBuildWithOneMoreMigration,
  aCopyOf,
  aService,
  aTemplate,
  crashingAt,
  filesIn,
  journalStep,
  offerOf,
  quiet,
  sha256,
  stepBefore,
  type Move,
  type Template,
} from './lib/seat-b-folders'
import { ONE_NEWER, THIS_BUILD } from './lib/recovery-fixture'

/**
 * A file held open by another program (EBUSY), a full disk (ENOSPC) and a refused permission
 * (EACCES), at every step of a copy, a restore and a return, through the real service. A stop
 * before the copy being restored was checked leaves every file as it was, and its verdict is a
 * failure the recovery window has words for, with a retry that works once the cause is gone. A
 * stop after it is finished at once, as the next start would finish it.
 */

const scratch = new Scratch()
afterAll(() => scratch.clear())

let template: Template
let restoreMoves: readonly Move[]
let returnMoves: readonly Move[]

beforeAll(async () => {
  template = await aTemplate(scratch, {
    migrations: ONE_NEWER,
    checkpoints: [THIS_BUILD, ONE_NEWER],
    drafts: true,
    crashed: true,
  })
  const userData = await aCopyOf(scratch, template)
  const restoring = crashingAt(userData, null)
  const offer = offerOf(await aService(userData, { fs: restoring.fs }).inspect())
  await aService(userData, { fs: restoring.fs }).restore(offer.id, quiet)
  restoreMoves = [...restoring.moves]
  const returning = crashingAt(userData, null)
  await aService(userData, { fs: returning.fs }).returnToNewer(quiet)
  returnMoves = [...returning.moves]
  expect(restoreMoves.length).toBeGreaterThan(3)
  expect(returnMoves.length).toBeGreaterThan(3)
})

/** Every point a fault can stop a restore or return at: each side of each step, and each rename. */
function faultsOf(moves: readonly Move[], error: RecoveryFaults['error']): RecoveryFaults[] {
  return [
    ...STEPS.flatMap((at): RecoveryFaults[] => [
      { at, error },
      { at, after: true, error },
    ]),
    ...moves.map((move): RecoveryFaults => ({ at: { move: move.live, to: move.to }, error })),
  ]
}

function saidOf(faults: RecoveryFaults): string {
  const { at } = faults
  const where =
    typeof at === 'object'
      ? `after ${at.move} moves ${at.to}`
      : `${faults.after === true ? 'after' : 'before'} ${at}`
  return `${String(faults.error)} ${where}`
}

/** The step the journal names when a fault stops the work: moves happen once the gate stands. */
function journalWhenStopped(faults: RecoveryFaults): string | null {
  return typeof faults.at === 'object' ? 'gate-installed' : stepBefore(faults.at as Step)
}

/** A failure the recovery window words: a known reason, a heading, and what to do next. */
function expectWorded(verdict: StartupVerdict, said: string): void {
  if (verdict.kind !== 'failed')
    throw new Error(`${said}: not a failure: ${JSON.stringify(verdict)}`)
  expect(START_FAILURES, said).toContain(verdict.reason)
  const words = failedWords(verdict)
  expect(words.heading.length, said).toBeGreaterThan(0)
  expect(words.body.length, said).toBeGreaterThan(1)
  expect(words.body.at(-1), said).toBe(verdict.canRetry ? 'Try again.' : words.body.at(-1))
  expect(
    words.actions.map((action) => action.kind),
    said,
  ).toEqual(verdict.canRetry ? ['retry', 'close'] : ['close'])
  expect(words.detail, said).toBe(verdict.detail)
}

/** The live family and drafts, each by its sha256 or null. */
function liveOf(userData: string): Record<string, string | null> {
  return Object.fromEntries(
    [...FAMILY, 'drafts.json'].map((name) => {
      const path = join(userData, name)
      return [name, existsSync(path) ? sha256(readFileSync(path)) : null]
    }),
  )
}

describe.each(FAULT_CODES)('%s at each step of a restore', (code) => {
  it('stops with nothing changed and words for it, or finishes once the copy was checked', async () => {
    const outcomes = new Set<string>()
    for (const faults of faultsOf(restoreMoves, code)) {
      const said = saidOf(faults)
      const userData = await aCopyOf(scratch, template)
      const service = aService(userData, { fs: UNFLUSHED, faults })
      const first = await service.inspect()
      const offer = offerOf(first)
      const before = filesIn(userData)

      const verdict = await service.restore(offer.id, quiet)
      const stoppedAt = journalWhenStopped(faults)
      if (stoppedAt === null || stoppedAt === 'planned') {
        expect(verdict, said).toMatchObject({
          kind: 'failed',
          reason: 'restore-failed',
          during: 'restore',
          canRetry: true,
        })
        expect(verdict.kind === 'failed' ? verdict.detail : '', said).toContain(code)
        expectWorded(verdict, said)
        // "Nothing was deleted", as the window says: every file is as it was.
        expect(filesIn(userData), said).toEqual(before)
        expect(await service.retry(), said).toEqual(first)
        // The cause gone, the same restore goes through.
        expect(await service.restore(offer.id, quiet), said).toMatchObject({ kind: 'history-only' })
        outcomes.add('stopped')
      } else {
        expect(verdict, said).toMatchObject({
          kind: 'history-only',
          gate: { checkpointId: offer.id },
        })
        outcomes.add('finished')
      }
      expect(journalStep(userData), said).toBeNull()
    }
    expect([...outcomes].sort()).toEqual(['finished', 'stopped'])
  })
})

describe.each(FAULT_CODES)('%s at each step of a return', (code) => {
  it('stops with the restored copy in place and words for it, or finishes the return', async () => {
    const outcomes = new Set<string>()
    for (const faults of faultsOf(returnMoves, code)) {
      const said = saidOf(faults)
      const userData = await aCopyOf(scratch, template)
      const plain = aService(userData, { fs: UNFLUSHED })
      const first = await plain.inspect()
      const restored = await plain.restore(offerOf(first).id, quiet)
      expect(restored.kind, said).toBe('history-only')
      const before = filesIn(userData)

      const service = aService(userData, { fs: UNFLUSHED, faults })
      const verdict = await service.returnToNewer(quiet)
      if (journalWhenStopped(faults) === null) {
        expect(verdict, said).toMatchObject({
          kind: 'failed',
          reason: 'restore-failed',
          during: 'return',
          canRetry: true,
        })
        expect(verdict.kind === 'failed' ? verdict.detail : '', said).toContain(code)
        expectWorded(verdict, said)
        if (verdict.kind === 'failed') {
          expect(failedWords(verdict).heading, said).toMatch(/return to the newer data/)
        }
        expect(filesIn(userData), said).toEqual(before)
        expect(await service.retry(), said).toEqual(restored)
        outcomes.add('stopped')
      } else {
        expect(verdict, said).toEqual(first)
        outcomes.add('finished')
      }
      expect(journalStep(userData), said).toBeNull()
    }
    expect([...outcomes].sort()).toEqual(['finished', 'stopped'])
  })
})

describe.each(FAULT_CODES)('%s at each step of a copy made before a migration', (code) => {
  const points: readonly (readonly [CheckpointStep, boolean])[] = [
    ['copy', false],
    ['copy', true],
    ['verify', false],
    ['verify', true],
    ['files', false],
    ['files', true],
    ['manifest', false],
  ]

  it('refuses the start with words for it, keeps no copy, and leaves the data as it was', async () => {
    const workspace = await aTemplate(scratch, {
      migrations: THIS_BUILD,
      checkpoints: [],
      drafts: true,
    })
    const migrationsFolder = await aBuildWithOneMoreMigration(scratch)
    for (const [at, after] of points) {
      const said = `${code} ${after ? 'after' : 'before'} ${at}`
      const userData = await aCopyOf(scratch, workspace)
      const live = liveOf(userData)
      const service = aService(userData, {
        migrationsFolder,
        faults: { at, ...(after ? { after } : {}), error: code },
      })
      const verdict = await service.inspect()
      expect(verdict, said).toMatchObject({
        kind: 'failed',
        reason: 'checkpoint-failed',
        canRetry: true,
      })
      expect(verdict.kind === 'failed' ? verdict.detail : '', said).toContain(code)
      expectWorded(verdict, said)
      expect(liveOf(userData), said).toEqual(live)
      expect(await listCheckpoints(userData), said).toEqual([])
      // The cause gone, a retry makes the copy.
      expect(await service.retry(), said).toEqual({ kind: 'open', checkpoint: 'made' })
      expect(await listCheckpoints(userData), said).toHaveLength(1)
      expect(liveOf(userData), said).toEqual(live)
    }
  })
})

describe('the same errors from the file system itself', () => {
  /** UNFLUSHED, with every call `when` picks failing with `code`. */
  function failing(
    code: string,
    pick: { readonly copyInto?: string; readonly renameTo?: (to: string) => boolean },
  ): RecoveryFs {
    const coded = (): Error => Object.assign(new Error(`${code}: made up by the test`), { code })
    return {
      ...UNFLUSHED,
      copyFile: (from, to, mode) =>
        pick.copyInto !== undefined && to.startsWith(pick.copyInto)
          ? Promise.reject(coded())
          : UNFLUSHED.copyFile(from, to, mode),
      rename: (from, to) =>
        pick.renameTo?.(to) === true ? Promise.reject(coded()) : UNFLUSHED.rename(from, to),
    }
  }

  it('a disk that fills while the copy is staged stops the restore and changes nothing', async () => {
    const userData = await aCopyOf(scratch, template)
    const first = await aService(userData).inspect()
    const before = filesIn(userData)
    const service = aService(userData, {
      fs: failing('ENOSPC', { copyInto: stagedRoot(userData) }),
    })
    const verdict = await service.restore(offerOf(first).id, quiet)
    expect(verdict).toMatchObject({ kind: 'failed', reason: 'restore-failed', canRetry: true })
    expect(verdict.kind === 'failed' ? verdict.detail : '').toContain('ENOSPC')
    expectWorded(verdict, 'ENOSPC while staging')
    expect(filesIn(userData)).toEqual(before)
  })

  it('a database held open by another program stays live, and the next start finishes the restore', async () => {
    const userData = await aCopyOf(scratch, template)
    const newer = liveOf(userData)
    const first = await aService(userData).inspect()
    const held = failing('EBUSY', {
      renameTo: (to) =>
        dirname(dirname(to)).endsWith('preserved') && to.endsWith('database.sqlite'),
    })
    const verdict = await aService(userData, { fs: held }).restore(offerOf(first).id, quiet)
    expect(verdict).toMatchObject({ kind: 'failed', reason: 'restore-failed', canRetry: true })
    expect(verdict.kind === 'failed' ? verdict.detail : '').toContain('EBUSY')
    expectWorded(verdict, 'EBUSY on the database')
    // Its sidecars went aside first and wait there; the journal stays, so no start opens the
    // database without them before it is settled.
    expect(liveOf(userData)['brobot2.sqlite']).toBe(newer['brobot2.sqlite'])
    expect(journalStep(userData)).not.toBeNull()
    const next = await aService(userData).inspect()
    if (next.kind !== 'history-only') throw new Error(`not settled: ${JSON.stringify(next)}`)
    const preserved = preservedDir(userData, next.gate.restoreId)
    for (const name of [...FAMILY, 'drafts.json']) {
      const kept = join(preserved, copyNameOf(name))
      expect(existsSync(kept) ? sha256(readFileSync(kept)) : null, name).toBe(newer[name])
    }
  })

  it('a copy that cannot be put in place leaves no database rather than an empty one, until the next start', async () => {
    const userData = await aCopyOf(scratch, template)
    const first = await aService(userData).inspect()
    const refused = failing('EACCES', { renameTo: (to) => to === databaseFile(userData) })
    const service = aService(userData, { fs: refused })
    const verdict = await service.restore(offerOf(first).id, quiet)
    expect(verdict).toMatchObject({ kind: 'failed', reason: 'restore-failed', canRetry: true })
    expect(verdict.kind === 'failed' ? verdict.detail : '').toContain('EACCES')
    expectWorded(verdict, 'EACCES on the copy')
    expect(existsSync(databaseFile(userData))).toBe(false)
    expect(journalStep(userData)).not.toBeNull()
    // Trying again while it is still refused fails the same way and makes nothing.
    expect(await service.retry()).toMatchObject({ kind: 'failed', reason: 'restore-failed' })
    expect(existsSync(databaseFile(userData))).toBe(false)
    expect(await aService(userData).inspect()).toMatchObject({ kind: 'history-only' })
    expect(sha256(readFileSync(databaseFile(userData)))).toBe(
      template.fixture.checkpoints[0]?.manifest.database.sha256,
    )
  })
})
