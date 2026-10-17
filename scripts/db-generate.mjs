#!/usr/bin/env node
/**
 * Run `pnpm run db:generate`, then correct only the journal entry just appended by Drizzle.
 * The SQLite applier compares the newest recorded `created_at` strictly with the journal's
 * `when`; an equal or smaller stamp silently skips an upgrade even when fresh installs work.
 * Write `max(now, previous + 1)` so the stamp is strictly increasing without adding a fixed
 * spacing that keeps pushing it ahead of the clock.
 *
 * Drizzle's generation prefixes affect filenames, not `when`, so repair follows generation.
 * Later generation reads the previous `idx` without regenerating its timestamp. Snapshots
 * hold schema and identifiers, not a timestamp, so only the journal needs this correction.
 *
 * Shipped stamps are immutable: lowering one can skip it, and raising one can reapply it
 * against an existing table. Refuse an already nonmonotonic journal, modified prior entries,
 * or anything other than one appended entry instead of repairing historical migrations.
 *
 * Leave clean-base's `MIGRATIONS` update manual. Its source census checks the count; its
 * fresh-install explanation also needs review when schema contents change. Automatically
 * fixing only the count could leave that explanation stale.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The journal `pnpm run db:generate` appends to. */
export const JOURNAL = join(ROOT, 'apps/desktop/src/main/db/migrations/meta/_journal.json')

/**
 * The package script that actually calls `drizzle-kit`, named here so the census in
 * `scripts/test/db-generate.test.mjs` can prove there is no second door into the generator.
 *
 * ⚠️ **`db:generate` in `apps/desktop` was RENAMED to this.** A person who still types the old
 * name gets pnpm's *no such script* and the list of the ones that exist, which is loud; leaving the
 * old name in place would have left an unstamped path that looks like the supported one.
 */
export const UNSTAMPED_SCRIPT = 'db:generate:unstamped'

/**
 * The smallest stamp that cannot be skipped after `previous`, given the clock.
 *
 * ⛔ **`+ 1` because the applier's test is `<` and not `<=`** — a stamp equal to the newest applied
 * row is skipped exactly like one below it.
 */
export function stampAfter(previous, now) {
  if (previous === undefined) return now
  return now > previous ? now : previous + 1
}

/** The journal, parsed, plus the bytes it arrived as — so a rewrite invents no whitespace. */
export function readJournal(path) {
  const raw = readFileSync(path, 'utf8')
  return { raw, journal: JSON.parse(raw) }
}

/** `[{idx, when, tag}]` → the entries that are not strictly above the one before them. */
export function outOfOrder(entries) {
  return entries.filter((entry, index) => index > 0 && entry.when <= entries[index - 1].when)
}

/**
 * What to do about the entry the generator left, as data — so the CLI prints an outcome rather than
 * a plan (`a-report-must-be-computed-from-the-outcome`).
 */
export function planStamp(before, after, now) {
  const already = outOfOrder(before)
  if (already.length > 0) {
    return {
      outcome: 'refused',
      why:
        `the journal was ALREADY out of order before this run — ${already
          .map((entry) => entry.tag)
          .join(', ')} ` +
        `${already.length === 1 ? 'is' : 'are'} not above the entry before it. ⛔ A stamp that has ` +
        `shipped is immutable: lowered, it is skipped on every database that stopped there; raised ` +
        `above a created_at some database already recorded, that migration RE-APPLIES. Fix the ` +
        `history by hand, knowing which installs hold what.`,
    }
  }
  if (after.length === before.length) return { outcome: 'nothing-generated' }
  if (after.length !== before.length + 1) {
    return {
      outcome: 'refused',
      why:
        `drizzle appended ${String(after.length - before.length)} entries and this wrapper only ` +
        `knows how to stamp the one it appends per run. Nothing was rewritten.`,
    }
  }
  const moved = before.filter(
    (entry, index) =>
      after[index] === undefined ||
      after[index].tag !== entry.tag ||
      after[index].when !== entry.when,
  )
  if (moved.length > 0) {
    return {
      outcome: 'refused',
      why:
        `drizzle rewrote ${moved.map((entry) => entry.tag).join(', ')}, which it is not supposed ` +
        `to do — this wrapper stamps the new entry and never the history, so it will not guess ` +
        `what that meant. Nothing was rewritten.`,
    }
  }
  const entry = after[after.length - 1]
  const previous = before.length === 0 ? undefined : before[before.length - 1].when
  return {
    outcome: 'stamped',
    tag: entry.tag,
    previousTag: before.length === 0 ? null : before[before.length - 1].tag,
    was: entry.when,
    is: stampAfter(previous, now),
    previous: previous ?? null,
  }
}

/** One line per outcome, computed from what happened. */
export function report(plan) {
  if (plan.outcome === 'nothing-generated') {
    return 'db:generate · no schema changes — the journal is untouched.'
  }
  if (plan.outcome === 'refused') return `⛔ db:generate · ${plan.why}`
  // ⚑ **The first migration has nothing before it to be skipped behind** (D-016 generated the one
  // this repository holds), so neither sentence below is about it: it takes the clock and says so.
  if (plan.previousTag === null) {
    return (
      `db:generate · ${plan.tag} is the first migration: stamped ${String(plan.is)}, the clock's ` +
      `own — there is no entry before it for it to be skipped behind.`
    )
  }
  if (plan.was === plan.is) {
    return (
      `db:generate · ${plan.tag} keeps drizzle's own stamp ${String(plan.is)} — the wall clock is ` +
      `finally ahead of ${String(plan.previousTag)}.`
    )
  }
  const hours = (plan.previous - plan.was) / 3_600_000
  return (
    `db:generate · ${plan.tag} stamped ${String(plan.is)}.\n` +
    `   drizzle wrote ${String(plan.was)}, ${hours.toFixed(2)} hours BELOW ${String(plan.previousTag)} ` +
    `— it would have been skipped in silence on every database that already holds it.`
  )
}

/**
 * ⛔ **The last thing the generator does is read back what it wrote.**
 *
 * ⚠️ Nothing a correct `planStamp` can produce reaches this throw, and that is the point: it is the
 * artefact being checked rather than the arithmetic that produced it, so an edit to `stampAfter`
 * that got the direction wrong stops the command instead of printing a cheerful sentence over a
 * journal whose newest migration will never run.
 */
export function refuseIfSkippable(entries, tag) {
  const left = outOfOrder(entries)
  if (left.length === 0) return
  throw new Error(
    `stamped ${tag} and the journal is STILL out of order at ` +
      `${left.map((entry) => entry.tag).join(', ')} — those migrations would be skipped on every ` +
      `database that already holds the one before them. Do not commit this (522).`,
  )
}

/**
 * Generate, then stamp. `generate` is injected so the suite can run this whole path against a
 * staged journal without a drizzle process and without writing into the repository.
 */
export async function generateWithStamp({ journalPath = JOURNAL, generate, now = Date.now() }) {
  const was = readJournal(journalPath)
  await generate()
  const { journal } = readJournal(journalPath)
  const plan = planStamp(was.journal.entries, journal.entries, now)
  if (plan.outcome !== 'stamped') return plan
  // ⚑ **The COMMITTED file's trailing newline, not the generator's.** `meta/` is in
  // `.prettierignore`, so nothing else in this repository normalises these bytes — and drizzle ends
  // its write without one. ⛔ Taking the byte from what drizzle left would silently strip it from a
  // committed file on the next generate, which is a diff nobody made and nobody can explain.
  journal.entries[journal.entries.length - 1].when = plan.is
  writeFileSync(
    journalPath,
    JSON.stringify(journal, null, 2) + (was.raw.endsWith('\n') ? '\n' : ''),
  )
  refuseIfSkippable(readJournal(journalPath).journal.entries, plan.tag)
  return plan
}

// ⚠️ Only when this file IS the command. Importing it from the test must not spawn drizzle.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const passThrough = process.argv.slice(2)
  const plan = await generateWithStamp({
    generate: () => {
      const run = spawnSync(
        'pnpm',
        ['--filter', '@brobot2/desktop', 'run', UNSTAMPED_SCRIPT, ...passThrough],
        { cwd: ROOT, stdio: 'inherit' },
      )
      if (run.error !== undefined) throw run.error
      if (run.status !== 0) process.exit(run.status ?? 1)
    },
  })
  process.stdout.write(`${report(plan)}\n`)
  if (plan.outcome === 'refused') process.exit(1)
}
