import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Print the live run's estimated charge beside measured provider transcript token counts.
 * Rates are a dated table, so include `RATES_AS_OF` and the underlying tokens. Name unknown
 * models as unpriced instead of silently adding zero to a total.
 * Codex's signed-in plan exposes no incremental charge to this instrument; do not invent one.
 */

/** The day these rates were read off Anthropic's published pricing. Reported with every total. */
export const RATES_AS_OF = '2026-08-25'

/**
 * $ per 1M tokens, by model: `[input, output, cacheRead, cacheWrite5m, cacheWrite1h]`.
 *
 * ⚠️ **Keyed by the model id the PROVIDER wrote into its own transcript**, not by the id we asked
 * for — those differ (a request for `claude-haiku-4-5` is recorded as
 * `claude-haiku-4-5-20251001`), and pricing the string we sent would price a model that may not be
 * the one that answered.
 */
export const RATES = {
  'claude-haiku-4-5-20251001': [1.0, 5.0, 0.1, 1.25, 2.0],
  'claude-sonnet-5': [3.0, 15.0, 0.3, 3.75, 6.0],
  'claude-opus-5': [5.0, 25.0, 0.5, 6.25, 10.0],
}

/**
 * The usage a provider recorded for ONE model, over a whole run.
 *
 * ⚠️ **Deduplicated by message id.** A resumed conversation replays its own transcript into a second
 * file, so the same billed message appears more than once on disk; counting both would inflate every
 * total on any run that reopens anything — which is most of them.
 */
export function tallyUsage(records) {
  const seen = new Set()
  const per = new Map()
  for (const record of records) {
    const message = record?.message
    const usage = message?.usage
    if (typeof usage !== 'object' || usage === null) continue
    const id = message.id
    if (typeof id === 'string') {
      if (seen.has(id)) continue
      seen.add(id)
    }
    const model = typeof message.model === 'string' ? message.model : 'unknown'
    const row = per.get(model) ?? {
      model,
      messages: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    }
    row.messages += 1
    row.input += usage.input_tokens ?? 0
    row.output += usage.output_tokens ?? 0
    row.cacheRead += usage.cache_read_input_tokens ?? 0
    // Two shapes on the wire: a `cache_creation` object that splits the TTLs, and a flat
    // `cache_creation_input_tokens` that does not. The flat one is charged at the 5-minute rate,
    // which is the cheaper of the two — an unknown TTL priced at the dearer rate would overstate.
    const creation = usage.cache_creation
    if (typeof creation === 'object' && creation !== null) {
      row.cacheWrite5m += creation.ephemeral_5m_input_tokens ?? 0
      row.cacheWrite1h += creation.ephemeral_1h_input_tokens ?? 0
    } else {
      row.cacheWrite5m += usage.cache_creation_input_tokens ?? 0
    }
    per.set(model, row)
  }
  return [...per.values()].sort((a, b) => a.model.localeCompare(b.model))
}

/** What one model's usage costs, or `null` when this file has no rate for it. */
export function priceRow(row, rates = RATES) {
  const rate = rates[row.model]
  if (rate === undefined) return null
  const [input, output, cacheRead, write5m, write1h] = rate
  return (
    (row.input * input +
      row.output * output +
      row.cacheRead * cacheRead +
      row.cacheWrite5m * write5m +
      row.cacheWrite1h * write1h) /
    1_000_000
  )
}

/**
 * Price a whole tally.
 *
 * ⛔ **`unpriced` is a first-class part of the answer.** A model this file has no rate for is named
 * and its tokens are reported; it is NOT added to the total as zero, and the caller is expected to
 * say so out loud. That is the same rule the smoke's own tri-state follows: not knowing is a third
 * answer, and printing it as a small number is the one thing that must not happen.
 */
export function priceTally(rows, rates = RATES) {
  let total = 0
  const priced = []
  const unpriced = []
  for (const row of rows) {
    const cost = priceRow(row, rates)
    if (cost === null) unpriced.push(row)
    else {
      total += cost
      priced.push({ ...row, cost })
    }
  }
  return { priced, unpriced, total }
}

/** Every `*.jsonl` under a directory tree, deepest included. Missing directories read as none. */
function jsonlFiles(root) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) found.push(...jsonlFiles(path))
    else if (entry.name.endsWith('.jsonl')) found.push(path)
  }
  return found
}

/** Every JSON object on its own line, skipping anything unparseable. */
export function readJsonl(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const records = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      // A half-written last line is the ordinary case while a provider is still running.
    }
  }
  return records
}

/**
 * ⚑ **Is this transcript a Codex rollout?** — read off its RECORDS, never its path: a rollout's
 * lines are `session_meta` / `turn_context` / `event_msg` / `response_item`, and none of them
 * carries the `message.usage` {@link tallyUsage} bills.
 */
export function isCodexRollout(records) {
  return records.some((record) =>
    ['session_meta', 'turn_context', 'event_msg', 'response_item'].includes(record?.type),
  )
}

/**
 * ⛔ **What this run cost, read out of the provider homes the run itself created.**
 *
 * ⚑ **`user-data/provider-homes` and nothing else**: those are the ISOLATED homes this run laid
 * down, so the answer is about this run alone. 🔒 It never reads the personal `~/.claude`, which is
 * both the standing rule and the only way the number can mean "this run".
 */
export function priceRun(evidenceRoot, { rates = RATES, providerHomes } = {}) {
  const homes = [...new Set(providerHomes ?? [join(evidenceRoot, 'user-data', 'provider-homes')])]
  const missingHomePaths = homes.filter((home) => !existsSync(home))
  const files = [...new Set(homes.flatMap(jsonlFiles))]
  const perFile = files.map(readJsonl)
  const rows = tallyUsage(perFile.flat())
  return {
    ...priceTally(rows, rates),
    asOf: RATES_AS_OF,
    files: files.length,
    // 🔴 665 · a transcript this table CANNOT bill, counted, so the line can say *unpriced*.
    codexFiles: perFile.filter(isCodexRollout).length,
    expectedHomes: homes.length,
    missingHomes: missingHomePaths.length,
    missingHomePaths,
  }
}

/**
 * The one line the run prints. Never a bare number: it carries what it was derived from.
 *
 * 🔴 **665 · zero and UNPRICED are different facts.** `660`'s run spent real Codex turns and printed
 * `$0.0000`, because Codex rollouts carry no billed message and so contributed nothing to a table
 * that prices Claude alone. ⛔ A run with any Codex transcript is UNPRICED for that part: when EVERY
 * transcript is Codex the line opens with the word; when Claude was billed too, the figure is
 * Claude's alone and the same line names the Codex part as UNPRICED beside it.
 */
export function describePrice(answer) {
  const homeCoverage =
    ` · provider homes: ${answer.expectedHomes ?? 0} expected, ` +
    `${answer.missingHomes ?? 0} missing`
  const codexFiles = answer.codexFiles ?? 0
  if (answer.priced.length === 0 && answer.unpriced.length === 0 && codexFiles > 0) {
    return (
      `UNPRICED — ${codexFiles} Codex transcript file(s) ran on the signed-in plan, which this ` +
      `table cannot bill; no billed Claude message was recorded in the other ` +
      `${(answer.files ?? 0) - codexFiles} file(s) (rates as of ${answer.asOf})${homeCoverage}`
    )
  }
  if (answer.priced.length === 0 && answer.unpriced.length === 0) {
    // ⚠️ **"Recorded", and the file count is why that word is not a hedge.** The price is read when
    // the run summarises, and a turn still in flight has not been written to the provider's
    // transcript yet — measured on a filtered run whose one session was still `working` at the end.
    // Zero files means nothing ran; files with no billed message means something ran and had not
    // settled. Collapsing those two into "$0.0000" would be the tri-state defect, in a dollar sign.
    const scanned = answer.files ?? 0
    return (
      `$0.0000 — no billed provider message was recorded in ${scanned} transcript file(s) ` +
      `(rates as of ${answer.asOf})${homeCoverage}`
    )
  }
  const models = answer.priced
    .map((row) => `${row.model} $${row.cost.toFixed(4)} (${row.messages} msg)`)
    .join(' · ')
  const missing =
    answer.unpriced.length === 0
      ? ''
      : ` · ⚠️ NOT PRICED: ${answer.unpriced.map((row) => `${row.model} (${row.messages} msg)`).join(', ')}`
  const codex =
    codexFiles > 0
      ? ` · ⚠️ UNPRICED: Codex ran on the signed-in plan (${codexFiles} transcript file(s)) and is not in this figure`
      : ' · Codex ran on the signed-in plan and is not in this figure'
  return `$${answer.total.toFixed(4)} — ${models}${missing} · rates as of ${answer.asOf}${homeCoverage}${codex}`
}
