import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { providerSchema, type Provider } from '@brobot2/shared'
import type { AppDatabase } from './db/connection'
import { importSideFile, objectIn } from './db/side-file-import'

/**
 * The turns that were cut while they ran — by this app's own quit, a crash, the provider's program
 * stopping, or a usage limit — and what this app did about each.
 *
 * A cut turn is continued at most once, and only on the account it ran on. So the cut is recorded
 * with the account its life ran on, frozen, and each step taken about it is committed before the
 * step is taken: a crash at any moment leaves a record the next launch reads as "not done", "maybe
 * done" or "done", and never one that lets it start or send twice.
 *
 * `lives` names the account of each conversation's latest life, once known, with that life's own
 * `launched` row: a crash's cut takes it at the next launch only if that row is the newest launch
 * before the cut turn, so that very life opened it. A cut's own `expected` never changes after it is
 * written.
 *
 * Accounts use existing account record IDs or confirmed native account IDs. Historical credential
 * tags remain readable but cannot prove a match to a newly confirmed account.
 */

/** Why a cut was not, or will not be, continued. */
export const NOT_CONTINUED_BECAUSE = [
  // Not a cut the app may continue.
  'too-old',
  'blocked',
  'not-cut',
  // Two automatic continuations of it came just before, in a row: a third cut waits for a person.
  'continued-twice',
  'elsewhere',
  'not-startable',
  'kept-stopped',
  // A service's that is no longer on the piece it was cut on: that piece stalls, and its caller is told.
  'a-service',
  // The account.
  'account-not-known',
  'not-same-account',
  'not-same-account-cohort',
  // Something else took the conversation first.
  'overtaken',
  'stopped',
  // Its provider's usage limit holds: the words would wait past the moment they are true for.
  'limited',
  // A limit's: its reset is not known, or too far off to wait for, or it needs credits bought.
  'no-reset',
  'reset-too-far',
  'credits-required',
  // A step that may or may not have happened, which is never taken again.
  'start-failed',
  'start-uncertain',
  'never-queued',
  'handover-uncertain',
] as const

export type NotContinuedBecause = (typeof NOT_CONTINUED_BECAUSE)[number]

/**
 * Where a cut stands. Each moves only forward: `pending` → `starting` → `queued` → `sent`, or to an
 * ending. ⚑ `starting` is written before this app's own start, and `queued` before the words are
 * held: found at a later launch, each says that step may have happened, so it is never taken again.
 */
export type CutState =
  'pending' | 'starting' | 'queued' | 'sent' | { readonly ended: NotContinuedBecause }

/** What cut a turn: this app's quit, a crash, its provider's program stopping, or a usage limit. */
export type CutKind = 'quit' | 'crash' | 'program' | 'limit'

export interface CutRecord {
  /** The cut turn's row, and the generation it is in. */
  readonly turn: string
  readonly generation: number
  readonly kind: CutKind
  /**
   * When it was cut: the quit's moment, the program's or the limit's; for a crash, the
   * conversation's last recorded activity before it, since a crash leaves no moment of its own.
   */
  readonly cutAt: number
  /** A limit's: when its provider said it resets, epoch ms. */
  readonly resetsAt?: number
  /**
   * How many automatic continuations of this conversation came just before this cut, in a row,
   * whatever cut each: `0` when the cut turn was not itself a continuation.
   */
  readonly inARow?: number
  readonly provider: Provider
  readonly profile: string
  /** The account the cut life ran on, frozen; `null` when it was not known. */
  readonly expected: string | null
  /** The id the words are held under, so holding them again is the same message. */
  readonly noticeId: string
  /** Whether a person's words started the cut turn: such conversations are woken first. */
  readonly aPersonStartedIt: boolean
  readonly state: CutState
  /** When this record last changed, epoch ms. */
  readonly at: number
}

export interface LifeRecord {
  /** When the life began, epoch ms. */
  readonly since: number
  readonly identity: string
  /** The generation and ordinal of the life's own `launched` row, as it was recorded. */
  readonly generation: number
  readonly launched: number
}

export interface KeptCuts {
  readonly lives: Readonly<Record<string, LifeRecord>>
  readonly cuts: Readonly<Record<string, CutRecord>>
}

/** Nothing kept. */
export const NO_CUTS_KEPT: KeptCuts = { lives: {}, cuts: {} }

/** The most conversations each part holds; past it, the ones changed longest ago go. */
export const MAX_CUT_CONVERSATIONS = 500

/** How long an ended or sent cut is kept, for a person to be told of later: a week. */
export const CUT_KEPT_FOR_MS = 7 * 24 * 60 * 60_000

/** The file older builds kept these in, imported once into `cut_turn` and `cut_life`. */
export const TURNS_THE_APP_CUT_FILE = 'turns-the-app-cut.json'

/** A new id for the words a cut's continuation is held under: a held message's own shape. */
export const newNoticeId = (): string => `msg_${randomUUID()}`

/** Whether a cut has ended, sent or not. */
export function isFinal(state: CutState): boolean {
  return typeof state !== 'string' || state === 'sent'
}

/** What is kept, without the final cuts older than {@link CUT_KEPT_FOR_MS}. */
export function withoutOldCuts(kept: KeptCuts, now: number): KeptCuts {
  const cuts = Object.fromEntries(
    Object.entries(kept.cuts).filter(
      ([, one]) => !(isFinal(one.state) && now - one.at > CUT_KEPT_FOR_MS),
    ),
  )
  return { ...kept, cuts }
}

export interface CutsKept {
  read(): KeptCuts
  write(kept: KeptCuts): void
}

export function turnsTheAppCutIn(database: AppDatabase): CutsKept {
  const cuts = database.prepare('SELECT id, record FROM cut_turn')
  const lives = database.prepare('SELECT conversation_id AS id, record FROM cut_life')
  const rows = (statement: typeof cuts) =>
    Object.fromEntries(
      (statement.all() as { id: string; record: string }[]).map(({ id, record }) => [
        id,
        JSON.parse(record) as unknown,
      ]),
    )
  return {
    read: () => ({
      lives: rows(lives) as Record<string, LifeRecord>,
      cuts: rows(cuts) as Record<string, CutRecord>,
    }),
    write: database.transaction((kept: KeptCuts) => replaceCuts(database, kept)),
  }
}

function replaceCuts(database: AppDatabase, kept: KeptCuts): void {
  database.prepare('DELETE FROM cut_turn').run()
  database.prepare('DELETE FROM cut_life').run()
  const cut = database.prepare('INSERT INTO cut_turn (id, record, at) VALUES (?, ?, ?)')
  const life = database.prepare(
    'INSERT INTO cut_life (conversation_id, record, since) VALUES (?, ?, ?)',
  )
  for (const [id, one] of Object.entries(kept.cuts)) cut.run(id, JSON.stringify(one), one.at)
  for (const [id, one] of Object.entries(kept.lives)) life.run(id, JSON.stringify(one), one.since)
  database
    .prepare(
      'DELETE FROM cut_turn WHERE id NOT IN (SELECT id FROM cut_turn ORDER BY at DESC LIMIT ?)',
    )
    .run(MAX_CUT_CONVERSATIONS)
  database
    .prepare(
      `DELETE FROM cut_life WHERE conversation_id NOT IN
       (SELECT conversation_id FROM cut_life ORDER BY since DESC LIMIT ?)`,
    )
    .run(MAX_CUT_CONVERSATIONS)
}

/** Old keyed/double-digest tags supply no evidence of the account now launching. */
const legacyIdentity = (identity: unknown): boolean =>
  typeof identity === 'string' && /^[a-z]+(?:-launch)?:[0-9a-f]{32}$/.test(identity)

const CUT_STATES = ['pending', 'starting', 'queued', 'sent']

/**
 * Imports `turns-the-app-cut.json` from `userData` once. A cut or life it cannot use is skipped,
 * which authorizes nothing; a life on a legacy identity is skipped and a cut's legacy `expected`
 * becomes `null`, so neither can prove the account now launching.
 */
export function importTurnsTheAppCutFile(database: AppDatabase, userData: string): void {
  importSideFile(database, join(userData, TURNS_THE_APP_CUT_FILE), (said) => {
    const whole = objectIn(said)
    const number = (value: unknown): value is number =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    const text = (value: unknown): value is string => typeof value === 'string' && value !== ''
    const lives: Record<string, LifeRecord> = {}
    for (const [id, row] of Object.entries(objectIn(whole['lives']))) {
      const { since, identity, generation, launched } = objectIn(row)
      if (
        [since, generation, launched].every(number) &&
        text(identity) &&
        !legacyIdentity(identity)
      )
        lives[id] = { since, identity, generation, launched } as LifeRecord
    }
    const cuts: Record<string, CutRecord> = {}
    for (const [id, row] of Object.entries(objectIn(whole['cuts']))) {
      const r = objectIn(row)
      const ended = objectIn(r['state'])['ended']
      const stateKnown =
        CUT_STATES.includes(r['state'] as string) ||
        NOT_CONTINUED_BECAUSE.includes(ended as NotContinuedBecause)
      if (
        !stateKnown ||
        !providerSchema.safeParse(r['provider']).success ||
        !['quit', 'crash', 'program', 'limit'].includes(r['kind'] as string) ||
        ![r['turn'], r['profile'], r['noticeId']].every(text) ||
        ![r['generation'], r['cutAt'], r['at']].every(number) ||
        typeof r['aPersonStartedIt'] !== 'boolean' ||
        !(r['expected'] === null || text(r['expected']))
      )
        continue
      cuts[id] = {
        ...r,
        expected: legacyIdentity(r['expected']) ? null : r['expected'],
      } as CutRecord
    }
    replaceCuts(database, { lives, cuts })
  })
}
