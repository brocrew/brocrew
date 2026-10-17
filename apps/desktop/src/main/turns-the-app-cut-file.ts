import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { providerSchema, type Provider } from '@brobot2/shared'
import { MAX_INSTANT } from '../shared/clock'

/**
 * **The turns that were cut while they ran** — by this app's own quit, a crash, the provider's
 * program stopping, or a usage limit — and what this app did about each:
 * `<userData>/turns-the-app-cut.json`.
 *
 * A cut turn is continued at most once, and only on the account it ran on: a quit's or a crash's at
 * the next launch, a program's once the conversation is started again, a limit's after its reset.
 * So the cut is recorded with the account its life ran on, frozen, and each step taken about it is
 * written before the step is taken: a crash at any moment leaves a record the next launch reads as
 * "not done", "maybe done" or "done", and never one that lets it start or send twice.
 *
 * ⚑ `lives` names the account of each conversation's latest life, once known, with that life's own
 * `launched` row: a crash's cut takes it at the next launch only if that row is the newest launch
 * before the cut turn, so that very life opened it. A cut's own `expected` never changes after it is
 * written.
 *
 * ⛔ No email or credential is kept: a Claude account is named by a digest keyed with `salt`, made
 * here once, and anything else by a tag the provider's runtime already makes.
 *
 * ⚑ Written beside it and renamed, so a reader never sees half a file. ⚑ A file that is missing or
 * cannot be read authorizes nothing: no cut is continued from it.
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
  /** The key Claude account digests are made with; `null` until the first is needed. */
  readonly salt: string | null
  readonly lives: Readonly<Record<string, LifeRecord>>
  readonly cuts: Readonly<Record<string, CutRecord>>
}

/** Nothing kept. */
export const NO_CUTS_KEPT: KeptCuts = { salt: null, lives: {}, cuts: {} }

/** The most conversations each part holds; past it, the ones changed longest ago go. */
export const MAX_CUT_CONVERSATIONS = 500

/** How long an ended or sent cut is kept, for a person to be told of later: a week. */
export const CUT_KEPT_FOR_MS = 7 * 24 * 60 * 60_000

/** Where a data folder keeps its cuts. */
export function turnsTheAppCutFile(userData: string): string {
  return join(userData, 'turns-the-app-cut.json')
}

/** A new id for the words a cut's continuation is held under: a held message's own shape. */
export const newNoticeId = (): string => `msg_${randomUUID()}`

/** A new key for Claude account digests. */
export const newSalt = (): string => randomBytes(32).toString('hex')

/** Whether a cut has ended, sent or not. */
export function isFinal(state: CutState): boolean {
  return typeof state !== 'string' || state === 'sent'
}

const CUT_KINDS: readonly CutKind[] = ['quit', 'crash', 'program', 'limit']

const aRecord = (said: unknown): Record<string, unknown> =>
  typeof said === 'object' && said !== null && !Array.isArray(said)
    ? (said as Record<string, unknown>)
    : {}

const aTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_INSTANT

const aCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const someText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

function aState(said: unknown): CutState | null {
  if (said === 'pending' || said === 'starting' || said === 'queued' || said === 'sent') {
    return said
  }
  const why = aRecord(said)['ended']
  const known = NOT_CONTINUED_BECAUSE.find((one) => one === why)
  return known === undefined ? null : { ended: known }
}

/** What `file` holds, each part checked, or nothing: a file missing, not JSON, or holding else. */
export function readKeptCuts(file: string): KeptCuts {
  let said: unknown
  try {
    said = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return NO_CUTS_KEPT
  }
  const whole = aRecord(said)
  const salt = whole['salt']
  const lives: Record<string, LifeRecord> = {}
  for (const [id, row] of Object.entries(aRecord(whole['lives']))) {
    const { since, identity, generation, launched } = aRecord(row)
    if (
      someText(id, 200) &&
      aTime(since) &&
      someText(identity, 200) &&
      aCount(generation) &&
      aCount(launched)
    ) {
      lives[id] = { since, identity, generation, launched }
    }
  }
  const cuts: Record<string, CutRecord> = {}
  for (const [id, row] of Object.entries(aRecord(whole['cuts']))) {
    const r = aRecord(row)
    const state = aState(r['state'])
    const provider = providerSchema.safeParse(r['provider'])
    if (
      !someText(id, 200) ||
      !someText(r['turn'], 200) ||
      !aTime(r['generation']) ||
      !CUT_KINDS.includes(r['kind'] as CutKind) ||
      !(r['resetsAt'] === undefined || aTime(r['resetsAt'])) ||
      !(r['inARow'] === undefined || aCount(r['inARow'])) ||
      !aTime(r['cutAt']) ||
      !provider.success ||
      !someText(r['profile'], 200) ||
      !(r['expected'] === null || someText(r['expected'], 200)) ||
      !someText(r['noticeId'], 200) ||
      typeof r['aPersonStartedIt'] !== 'boolean' ||
      state === null ||
      !aTime(r['at'])
    ) {
      continue
    }
    cuts[id] = {
      turn: r['turn'],
      generation: r['generation'],
      kind: r['kind'] as CutKind,
      cutAt: r['cutAt'],
      ...(aTime(r['resetsAt']) ? { resetsAt: r['resetsAt'] } : {}),
      ...(aCount(r['inARow']) ? { inARow: r['inARow'] } : {}),
      provider: provider.data,
      profile: r['profile'],
      expected: r['expected'],
      noticeId: r['noticeId'],
      aPersonStartedIt: r['aPersonStartedIt'],
      state,
      at: r['at'],
    }
  }
  return {
    salt: typeof salt === 'string' && /^[0-9a-f]{64}$/.test(salt) ? salt : null,
    lives: newest(lives, (one) => one.since),
    cuts: newest(cuts, (one) => one.at),
  }
}

/** The records changed most recently, at most {@link MAX_CUT_CONVERSATIONS}. */
function newest<T>(rows: Readonly<Record<string, T>>, at: (one: T) => number): Record<string, T> {
  const entries = Object.entries(rows)
  if (entries.length <= MAX_CUT_CONVERSATIONS) return { ...rows }
  return Object.fromEntries(
    entries.sort(([, a], [, b]) => at(b) - at(a)).slice(0, MAX_CUT_CONVERSATIONS),
  )
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

/** Write what is kept, replacing what the file held. */
export function writeKeptCuts(file: string, kept: KeptCuts): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  try {
    const whole = {
      salt: kept.salt,
      lives: newest(kept.lives, (one) => one.since),
      cuts: newest(kept.cuts, (one) => one.at),
    }
    writeFileSync(temporary, `${JSON.stringify(whole)}\n`, { mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
