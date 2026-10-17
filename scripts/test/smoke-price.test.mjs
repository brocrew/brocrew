import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RATES,
  RATES_AS_OF,
  describePrice,
  priceRow,
  priceRun,
  priceTally,
  tallyUsage,
} from '../lib/smoke-price.mjs'

/**
 * 211 · **What a live run cost, printed by the run that spent it** (criterion 8).
 *
 * ⛔ **Every dispatch that has reported a smoke price computed it by hand afterwards** — `209` and
 * `210` both did, out of the same evidence directory the run leaves behind. A number that needs its
 * own expedition is a number that eventually stops being reported, so it moved into `lib/` and the
 * smoke prints it.
 *
 * ⚑ **`lib/`, for the reason `196` gave and `206` H1 restated**: a live step cannot be run by
 * `pnpm run ci`, so the arithmetic it depends on is lifted out to where a test can kill it. What
 * stays unreachable is the WIRING — that `ui-live-smoke.mjs` calls this at the end of a run — and
 * `smoke-claims.test.mjs`'s source-reading precedent is the only instrument that could reach it.
 */

const billed = (id, model, usage) => ({ message: { id, model, usage } })

describe('what the provider recorded', () => {
  it('adds up one model’s tokens across many messages', () => {
    const rows = tallyUsage([
      billed('m1', 'claude-haiku-4-5-20251001', {
        input_tokens: 10,
        output_tokens: 100,
        cache_read_input_tokens: 1_000,
        cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 30 },
      }),
      billed('m2', 'claude-haiku-4-5-20251001', { input_tokens: 5, output_tokens: 50 }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      model: 'claude-haiku-4-5-20251001',
      messages: 2,
      input: 15,
      output: 150,
      cacheRead: 1_000,
      cacheWrite5m: 20,
      cacheWrite1h: 30,
    })
  })

  it('⛔ counts a billed message ONCE, however many files replayed it', () => {
    // A resumed conversation replays its own transcript into a second file on disk, so the same
    // billed message is there twice. Counting both inflates every total on any run that reopens
    // anything — which is most of them.
    const one = billed('m1', 'claude-haiku-4-5-20251001', { output_tokens: 100 })
    const rows = tallyUsage([one, { ...one }, { ...one }])

    expect(rows[0].messages).toBe(1)
    expect(rows[0].output).toBe(100)
  })

  it('keeps two models apart, and sorts them so a run reads the same way twice', () => {
    const rows = tallyUsage([
      billed('s1', 'claude-sonnet-5', { output_tokens: 7 }),
      billed('h1', 'claude-haiku-4-5-20251001', { output_tokens: 3 }),
    ])
    expect(rows.map((row) => row.model)).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-5'])
  })

  it('ignores anything that is not a billed message, without throwing on it', () => {
    expect(
      tallyUsage([
        {},
        { message: null },
        { message: { id: 'x', model: 'claude-sonnet-5' } },
        { message: { usage: 'not an object' } },
        billed('real', 'claude-sonnet-5', { output_tokens: 1 }),
      ]),
    ).toHaveLength(1)
  })

  it('⚠️ an unknown cache TTL is charged at the CHEAPER rate, never the dearer one', () => {
    // The flat `cache_creation_input_tokens` shape does not say which TTL was used. Pricing an
    // unknown at the 1-hour rate would overstate what was spent, and a spend figure that runs high
    // is the one direction that quietly justifies work nobody paid for.
    const rows = tallyUsage([
      billed('m1', 'claude-haiku-4-5-20251001', { cache_creation_input_tokens: 1_000_000 }),
    ])
    expect(rows[0].cacheWrite5m).toBe(1_000_000)
    expect(rows[0].cacheWrite1h).toBe(0)
    expect(priceRow(rows[0])).toBeCloseTo(1.25, 6)
  })
})

describe('what it cost', () => {
  it('⛔ scans every registered provider home, deduplicates replays, and names missing evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-price-homes-'))
    const first = join(root, 'first', 'provider-homes')
    const second = join(root, 'second', 'provider-homes')
    const missing = join(root, 'deleted', 'provider-homes')
    mkdirSync(join(first, 'claude'), { recursive: true })
    mkdirSync(join(second, 'claude'), { recursive: true })
    const replay = billed('same', 'claude-haiku-4-5-20251001', { output_tokens: 10 })
    writeFileSync(join(first, 'claude', 'one.jsonl'), `${JSON.stringify(replay)}\n`)
    writeFileSync(
      join(second, 'claude', 'two.jsonl'),
      `${JSON.stringify(replay)}\n${JSON.stringify(
        billed('other', 'claude-haiku-4-5-20251001', { output_tokens: 20 }),
      )}\n`,
    )

    try {
      const answer = priceRun(root, { providerHomes: [first, second, first, missing] })
      expect(answer).toMatchObject({ expectedHomes: 3, missingHomes: 1, files: 2 })
      expect(answer.priced[0]).toMatchObject({ messages: 2, output: 30 })
      expect(answer.missingHomePaths).toEqual([missing])
      expect(describePrice(answer)).toContain('provider homes: 3 expected, 1 missing')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('prices every channel, not just the output tokens', () => {
    // One million of each, so a channel dropped from the sum is visible as its own rate.
    const row = {
      model: 'claude-haiku-4-5-20251001',
      messages: 1,
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 1_000_000,
      cacheWrite5m: 1_000_000,
      cacheWrite1h: 1_000_000,
    }
    const [i, o, r, w5, w1] = RATES['claude-haiku-4-5-20251001']
    expect(priceRow(row)).toBeCloseTo(i + o + r + w5 + w1, 6)
  })

  it('⛔ a model with NO rate is named and left OUT of the total, never added as zero', () => {
    const rows = tallyUsage([
      billed('a', 'claude-haiku-4-5-20251001', { output_tokens: 1_000_000 }),
      billed('b', 'claude-some-model-nobody-priced', { output_tokens: 9_000_000 }),
    ])
    const answer = priceTally(rows)

    expect(answer.total).toBeCloseTo(5, 6)
    expect(answer.unpriced.map((row) => row.model)).toEqual(['claude-some-model-nobody-priced'])
    // …and the line SAYS so, because a total that quietly omitted a model is worse than no total.
    const said = describePrice({ ...answer, asOf: RATES_AS_OF })
    expect(said).toContain('NOT PRICED')
    expect(said).toContain('claude-some-model-nobody-priced')
  })

  it('the line carries what it was derived from — the models, and the day the rates were read', () => {
    const answer = priceTally(
      tallyUsage([billed('a', 'claude-sonnet-5', { output_tokens: 2_000_000 })]),
    )
    const said = describePrice({ ...answer, asOf: RATES_AS_OF })

    expect(said).toContain('$30.0000')
    expect(said).toContain('claude-sonnet-5')
    expect(said).toContain(`rates as of ${RATES_AS_OF}`)
    // ⚑ Codex is named as ABSENT rather than silently missing — it runs on the signed-in plan and
    // exposes no incremental charge, and 210 declined to invent one in exactly these terms.
    expect(said).toContain('Codex ran on the signed-in plan')
  })

  it('⛔ a run that recorded nothing says how many files it looked in', () => {
    // The price is read when the run summarises, and a turn still in flight has not been written to
    // the provider's transcript yet — measured on a filtered run whose one session was still
    // `working` at the end. "Nothing ran" and "something ran and had not settled" are different
    // facts, and collapsing them into a bare $0.0000 is the tri-state defect wearing a dollar sign.
    const nothingRan = describePrice({
      priced: [],
      unpriced: [],
      total: 0,
      asOf: RATES_AS_OF,
      files: 0,
    })
    const notSettled = describePrice({
      priced: [],
      unpriced: [],
      total: 0,
      asOf: RATES_AS_OF,
      files: 3,
    })

    expect(nothingRan).toContain('$0.0000')
    expect(nothingRan).toContain('no billed provider message')
    expect(nothingRan).toContain(RATES_AS_OF)
    expect(nothingRan).toContain('0 transcript file(s)')
    expect(notSettled).toContain('3 transcript file(s)')
    expect(nothingRan).not.toBe(notSettled)
  })

  it('🔴 665 · a run whose transcripts include Codex is UNPRICED for them, never $0.0000', () => {
    // ⚑ The shape of a real Codex rollout, measured on `660`'s preserved run: `session_meta`,
    // `turn_context`, `event_msg`, `response_item` — and not one record carrying `message.usage`.
    const rollout = [
      { type: 'session_meta', payload: { id: 'planted' } },
      { type: 'turn_context', payload: {} },
      { type: 'event_msg', payload: { type: 'token_count', info: null } },
      { type: 'response_item', payload: { type: 'message' } },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n')
    const root = mkdtempSync(join(tmpdir(), 'brobot2-price-codex-'))
    const homes = join(root, 'provider-homes')
    mkdirSync(join(homes, 'default', 'default', 'codex', 'sessions'), { recursive: true })
    mkdirSync(join(homes, 'default', 'project-manager', 'claude', 'projects'), { recursive: true })
    const codexFile = join(homes, 'default', 'default', 'codex', 'sessions', 'rollout-1.jsonl')
    const claudeFile = join(homes, 'default', 'project-manager', 'claude', 'projects', 'one.jsonl')
    try {
      // ⛔ `660`'s case: Codex alone. The line OPENS with the word, and carries no dollar zero.
      writeFileSync(codexFile, `${rollout}\n`)
      const codexOnly = priceRun(root, { providerHomes: [homes] })
      expect(codexOnly).toMatchObject({ files: 1, codexFiles: 1, total: 0 })
      const said = describePrice(codexOnly)
      expect(said.startsWith('UNPRICED — 1 Codex transcript file(s)')).toBe(true)
      expect(said).not.toContain('$0.0000')

      // ⚑ Mixed: the Claude figure stands, and the Codex half is named as unpriced beside it.
      writeFileSync(
        claudeFile,
        `${JSON.stringify(billed('m', 'claude-haiku-4-5-20251001', { output_tokens: 1_000_000 }))}\n`,
      )
      const mixed = describePrice(priceRun(root, { providerHomes: [homes] }))
      expect(mixed.startsWith('$5.0000 — ')).toBe(true)
      expect(mixed).toContain(
        '⚠️ UNPRICED: Codex ran on the signed-in plan (1 transcript file(s)) and is not in this figure',
      )

      // ⚑ And the control: with no Codex transcript the zero is a zero, worded as it always was.
      rmSync(codexFile)
      rmSync(claudeFile)
      writeFileSync(claudeFile, `${JSON.stringify({ type: 'user', message: { role: 'user' } })}\n`)
      const zero = priceRun(root, { providerHomes: [homes] })
      expect(zero.codexFiles).toBe(0)
      expect(describePrice(zero)).toContain('$0.0000 — no billed provider message')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
