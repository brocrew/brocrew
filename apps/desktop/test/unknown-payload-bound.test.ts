import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_UNKNOWN_RAW_BYTES,
  boundRaw,
  wrapUnknown,
  type DiscardedPayload,
  type RuntimeEvent,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { toWireEvent } from '../src/main/runtime/event-wire'
import { applyEvent, createTranscript, type UnknownItem } from '../src/renderer/src/lib/transcript'

/**
 * `unknown{raw}` carries provider output VERBATIM and, until 052, carried it in any size (048 §3
 * examined this field and ruled it correct — that ruling was about correctness, and nobody bounded
 * the size).
 *
 * ## The shape this is built from, and what it is not
 *
 * Codex returns a generated image as base64 INSIDE the event. Measured in the real database: one
 * `imageGeneration` payload of **2,147,667 bytes** against a corpus where the other 1,068 unknown
 * payloads average 420 bytes and top out at 3,854 — the odd one out is 557× the largest legitimate
 * one. The fixture below reproduces that SHAPE at that SIZE and is entirely synthetic: the base64
 * is generated here, and no field holds anything from a real session.
 *
 * ## What this test is not claiming
 *
 * It is **not** the reproduction of the 26 GB incident. That was measured live for 052 and this
 * payload is not the cause — two end-to-end reproductions through this exact path peaked at
 * 0.72 GB. This bound is here because an unbounded verbatim copy of provider output is a hazard on
 * its own, which is a different and smaller claim.
 *
 * ## Every stage the payload crosses, and the three doors
 *
 * The bound is applied where a payload ENTERS something that will hold it: at construction
 * (`wrapUnknown`, `toRuntimeEvent`), and at the database on the way in AND on the way out. The
 * third of those was missed on the first pass and found in review — bounding at construction does
 * nothing about a row already on disk, and the database that prompted this dispatch has exactly
 * one. The assertions below drive each stage with the real production function: main's wire
 * boundary, the structured clone Electron performs on IPC, the renderer's fold, the row written,
 * and the row replayed.
 */

/** The real shape, at the real size, from characters generated here. */
function imageGenerationPayload(): Record<string, unknown> {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  // Built by fill+map rather than by `+=` in a loop: a 2 MB rope re-flattened 2 million times is
  // slow enough to notice in a test suite.
  const base64 = Array.from({ length: 2_146_332 }, (_, i) => alphabet[i % 64]).join('')
  return {
    type: 'imageGeneration',
    id: 'call_synthetic052',
    status: 'completed',
    revisedPrompt: 'a synthetic fixture — no session content',
    result: base64,
    savedPath: '/tmp/brobot2-test/generated.png',
  }
}

const PAYLOAD = imageGenerationPayload()
/** The event as the Codex adapter builds it — `wrapUnknown` is the adapter's only door. */
const event = (): RuntimeEvent => wrapUnknown('codex', PAYLOAD, 'activity', 'imageGeneration')

/** How big a value is once serialized — the same measure the bound and the database both use. */
const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8')

const marker = (raw: unknown): DiscardedPayload => raw as DiscardedPayload

describe('the size bound on unknown payloads (052)', () => {
  it('the fixture really is the multi-megabyte shape, or this test proves nothing', () => {
    expect(jsonBytes(PAYLOAD)).toBeGreaterThan(2_000_000)
    expect(jsonBytes(PAYLOAD)).toBeGreaterThan(MAX_UNKNOWN_RAW_BYTES * 30)
  })

  it('replaces an oversized payload at creation with a marker, and never a fragment of it', () => {
    const created = event()
    expect(created.type).toBe('unknown')
    if (created.type !== 'unknown') throw new Error('unreachable')

    const raw = marker(created.raw)
    expect(raw.brobot2Discarded).toBe(true)
    expect(raw.reason).toBe('too-large')
    expect(raw.bytes).toBe(jsonBytes(PAYLOAD))
    expect(raw.limitBytes).toBe(MAX_UNKNOWN_RAW_BYTES)
    expect(raw.label).toBe('imageGeneration')
    expect(raw.note).toMatch(/DROPPED — not truncated/)

    // NOT TRUNCATED: no run of the payload survives anywhere in the event. A truncated blob would
    // still be megabytes and would still look like real data to everything downstream, which is
    // the failure mode the marker exists to avoid.
    const serialized = JSON.stringify(created)
    expect(serialized).not.toContain(PAYLOAD['result']?.toString().slice(0, 200))
    expect(jsonBytes(created)).toBeLessThan(2_000)
  })

  /**
   * ⚠️ **What the marker SAYS, and why the wording is a test rather than prose** (067).
   *
   * An oversized unknown line remains recoverable even before a live session has a raw
   * archive. A measured case had a 450-byte marker in `events`, zero `raw_frame` frames, and
   * the provider’s on-disk line at 2,921,839 bytes. The notice must not imply permanent loss
   * from the missing archive.
   *
   * So the note must name the thing that is true *while you are reading it*. These assertions pin
   * exactly that, because the failure mode is not a crash — it is a sentence quietly drifting back
   * to being reassuring about the wrong moment.
   */
  it('⚠️ the note is true for a LIVE session — no condition the reader cannot yet satisfy', () => {
    const created = event()
    if (created.type !== 'unknown') throw new Error('unreachable')
    const note = String(marker(created.raw).note)

    // Still says the thing 052 built it to say.
    expect(note).toMatch(/DROPPED — not truncated/)
    // The old conditional, gone: it made the ONE case where this is on screen the case it did not
    // cover. Asserted as an absence, on the exact phrase, so a rewrite that reintroduces the idea
    // has to reintroduce the words.
    expect(note).not.toMatch(/[Ww]here the session has a raw archive/)
    // And says where the bytes actually are: the provider's own file, the only place they are kept.
    expect(note).toMatch(/session file on disk/)
    expect(note).not.toMatch(/archive/)
    // ⚠️ And it promises a PLACE TO LOOK, never that the bytes still exist: a provider's file can be
    // deleted, and swearing otherwise would be the same kind of wrong in the other direction.
    expect(note).toMatch(/for as long as that file is kept/)
    expect(note).not.toMatch(/always|guaranteed|never lost|not gone/)
  })

  it('⚠️ the note does not promise a re-import gives the payload back — because it would not', () => {
    // Codex's importer keeps `response_item` lines and skips every `event_msg`, and `event_msg` is
    // the only kind the biggest payloads arrive as — measured across both rollouts on this machine.
    // The archive holds the bytes; the re-derived ledger does not. The old note's "and that is what
    // export reassembles" was the half of the sentence that could be read as saying otherwise.
    const created = event()
    if (created.type !== 'unknown') throw new Error('unreachable')
    expect(String(marker(created.raw).note)).not.toContain('export reassembles')
  })

  it('⚠️ the ceiling itself is unchanged at 64 KiB — 067 did not move it (acceptance 6)', () => {
    // 067 makes images cheap by never putting them through this door, NOT by widening it. Written
    // as the literal number as well as the constant, so "raise it a bit" cannot pass by editing one
    // place. The bound was never the thing standing between the app and images.
    expect(MAX_UNKNOWN_RAW_BYTES).toBe(64 * 1024)
    expect(MAX_UNKNOWN_RAW_BYTES).toBe(65_536)
  })

  it('keeps the label, which is the part the UI actually shows', () => {
    const created = event()
    if (created.type !== 'unknown') throw new Error('unreachable')
    // The event's own label is untouched — a bounded payload still says WHAT it was.
    expect(created.label).toBe('imageGeneration')
    expect(created.category).toBe('activity')
  })

  it('survives the wire boundary and Electron’s structured clone', () => {
    const wire = toWireEvent('codex', event())
    expect(jsonBytes(wire)).toBeLessThan(2_000)
    // `webContents.send` puts every event through structured clone; this is that step, run for
    // real rather than described.
    expect(jsonBytes(structuredClone(wire))).toBeLessThan(2_000)
  })

  it('reaches the renderer fold as the marker, and renders as readable text', () => {
    const state = createTranscript()
    applyEvent(state, toWireEvent('codex', event()))

    const item = state.items.find((i): i is UnknownItem => i.kind === 'unknown')
    expect(item).toBeDefined()
    expect(marker(item?.raw).brobot2Discarded).toBe(true)

    // What `UnknownEntry.vue` does with it: pretty-print into a <pre>. The bound is what keeps
    // that from being a two-megabyte text node.
    const rendered = JSON.stringify(item?.raw, null, 2)
    expect(rendered.length).toBeLessThan(2_000)
    // The reason must be the specific one — `unmeasurable` would render just as small and would be
    // a different (and wrong) claim about what happened to the payload.
    expect(rendered).toContain('too-large')
    expect(rendered).toContain('imageGeneration')
  })

  it('leaves legitimate payloads exactly as they were', () => {
    // The largest real unknown payload in the measured corpus is 3,854 bytes. Nothing at that
    // scale may be touched, or the bound has broken the variant it was meant to protect.
    const realistic = { type: 'task_progress', detail: 'x'.repeat(3_800) }
    const created = wrapUnknown('claude', realistic, 'activity', 'task_progress')
    if (created.type !== 'unknown') throw new Error('unreachable')
    expect(created.raw).toEqual(realistic)
    expect(created.raw).toBe(realistic) // the same object, not a copy
  })

  it('is idempotent, so the two creation doors need not coordinate', () => {
    const once = boundRaw(PAYLOAD, 'imageGeneration')
    const twice = boundRaw(once, 'imageGeneration')
    expect(twice).toBe(once)
  })

  it('says so honestly when a payload cannot be measured at all', () => {
    const circular: Record<string, unknown> = { type: 'weird' }
    circular['self'] = circular
    const raw = marker(boundRaw(circular, 'weird'))
    expect(raw.brobot2Discarded).toBe(true)
    // NOT reported as too-large: it may have been tiny. The claim made is the one that is true.
    expect(raw.reason).toBe('unmeasurable')
    expect(raw.bytes).toBeUndefined()
  })

  it('leaves `undefined` alone rather than inventing a marker for nothing', () => {
    expect(boundRaw(undefined)).toBeUndefined()
  })
})

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe('the bound reaches the database (052)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-bound-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a small row where an unbounded payload would have written megabytes', () => {
    const sessionId = 'sess_bound'
    store.create({
      id: sessionId,
      provider: 'codex',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })

    store.append(sessionId, 0, toWireEvent('codex', event()), 1)

    const row = db
      .prepare('SELECT payload FROM events WHERE session_id = ? AND ordinal = 0')
      .get(sessionId) as { payload: string }
    expect(row.payload.length).toBeLessThan(2_000)
    expect(row.payload).toContain('brobot2Discarded')

    // Even when the event skips `wrapUnknown` entirely — built literally, as `importBundle` does
    // when it replays a ledger straight out of a file — the store's own door still bounds it.
    const literal = {
      type: 'unknown',
      provider: 'codex',
      category: 'activity',
      label: 'imageGeneration',
      raw: PAYLOAD,
    } as RuntimeEvent
    store.append(sessionId, 1, literal, 2)
    const second = db
      .prepare('SELECT payload FROM events WHERE session_id = ? AND ordinal = 1')
      .get(sessionId) as { payload: string }
    expect(second.payload.length).toBeLessThan(2_000)
  })

  /**
   * The door 052's first pass missed, and the review found (P1).
   *
   * Bounding at construction does nothing for a row that is ALREADY on disk. The database that
   * prompted this dispatch contains exactly one such row — a 2,147,667-byte payload written before
   * any of this existed — and replaying that session would have handed it straight back out
   * through `events()`, into an IPC structured clone, and into the renderer's fold.
   */
  it('bounds a row that was already on disk before the bound existed', () => {
    const sessionId = 'sess_legacy'
    store.create({
      id: sessionId,
      provider: 'codex',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })

    // Straight past every application door, exactly as a pre-052 row is.
    const legacy = JSON.stringify({
      type: 'unknown',
      provider: 'codex',
      category: 'activity',
      label: 'imageGeneration',
      raw: PAYLOAD,
    })
    db.prepare(
      'INSERT INTO events (id, session_id, ordinal, type, payload, created_at) VALUES (?,?,?,?,?,?)',
    ).run('evt_legacy', sessionId, 0, 'unknown', legacy, 1)

    // NON-VACUITY: the row really is oversized on disk, so the assertion below is the read path
    // doing the work and not a fixture that was small all along.
    const onDisk = db.prepare('SELECT payload FROM events WHERE id = ?').get('evt_legacy') as {
      payload: string
    }
    expect(onDisk.payload.length).toBeGreaterThan(2_000_000)

    const replayed = store.events(sessionId)
    expect(replayed).toHaveLength(1)
    const event = replayed[0]?.event
    expect(event?.type).toBe('unknown')
    expect(jsonBytes(event)).toBeLessThan(2_000)
    expect(marker(event?.type === 'unknown' ? event.raw : null).reason).toBe('too-large')
  })
})

/**
 * `wrapUnknown` is the only door (052).
 *
 * The bound lives at construction, so a second place that builds the variant literally is a second
 * place that skips it — which is exactly what `import-claude.ts` did before this change. Checked
 * structurally rather than by review, in the same spirit as the navigation guard's own check (050).
 */
describe('no production source builds an unknown event around the bound', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  // The RENDERER is scanned too, and so are `.vue` files: `transcript.ts` copies `event.raw`
  // verbatim into the item it renders, and `applyEvent` is called from components — so a component
  // that built its own unknown event would reach the DOM without passing any door.
  const roots = [
    join(here, '..', 'src', 'main'),
    join(here, '..', 'src', 'renderer'),
    join(here, '..', '..', '..', 'packages', 'runtime', 'src'),
  ]

  /** Where the bound itself is applied — the two doors, and the only permitted constructions. */
  const doors = ['events.ts']

  function sources(dir: string): string[] {
    const found: string[] = []
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) found.push(...sources(path))
      else if (entry.endsWith('.ts') || entry.endsWith('.vue')) found.push(path)
    }
    return found
  }

  it('constructs `type: ‘unknown’` only where the bound is applied', () => {
    const offenders: string[] = []
    for (const root of roots) {
      for (const file of sources(root)) {
        if (doors.includes(file.split('/').pop() ?? '')) continue
        const text = readFileSync(file, 'utf8')
        // `type: 'unknown'` appears in TYPE positions too — `Extract<RuntimeEvent, {type:'unknown'}>`
        // is the ordinary way to name the variant and carries no payload. What matters is a value
        // being BUILT with one, so a match only counts when the same literal also sets `raw`.
        //
        // The window is deliberately generous. The permitted construction in `events.ts` already
        // spans 343 characters between `type` and `raw` because of the comment between them, so a
        // tight window would miss exactly the shape it is looking for; over-matching only ever
        // costs a loud failure that a reviewer resolves, where under-matching is silent.
        for (const match of text.matchAll(/type:\s*['"]unknown['"]/g)) {
          const literal = text.slice(match.index, match.index + 2_000)
          if (/\braw\s*:/.test(literal)) {
            offenders.push(file)
            break
          }
        }
      }
    }
    expect(
      offenders,
      'these build an unknown event directly and so skip the size bound in `wrapUnknown`',
    ).toEqual([])
  })
})
