import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  generateWithStamp,
  JOURNAL,
  outOfOrder,
  planStamp,
  refuseIfSkippable,
  report,
  stampAfter,
  UNSTAMPED_SCRIPT,
} from '../db-generate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

/**
 * 🔴 **522 · the number drizzle writes, which stops every migration after it from running.**
 *
 * ⛔ **The defect is silence.** `drizzle-orm` applies a migration only while
 * `Number(lastDbMigration[2]) < migration.folderMillis`, `folderMillis` **is** the journal's `when`,
 * and `drizzle-kit` stamps that from the wall clock — which this repository's hand-spaced stamps
 * overtook at `0019`. ⚠️ `516` generated `0032` **52.17 hours below** `0031` and would have shipped
 * two tables that exist on a fresh install and on no upgraded one.
 *
 * ⚑ **What this suite measures is the RULE and not a spacing.** Every assertion below is an
 * inequality against the entry before it; none of them names 86,400,000, so an implementation that
 * wrote the previous stamp back — or one that read the repository's own convention and enforced it
 * against itself — fails here (`a-bound-written-as-the-constant-cannot-pin-it`).
 */
describe('db:generate · a stamp that cannot be skipped', () => {
  /** A journal shaped exactly like the one on disk, with the stamps the caller cares about. */
  const journalOf = (stamps) => ({
    version: '7',
    dialect: 'sqlite',
    entries: stamps.map((when, index) => ({
      idx: index,
      version: '6',
      when,
      tag: `${String(index).padStart(4, '0')}_row_${String(index)}`,
      breakpoints: true,
    })),
  })

  const appended = (entries, when) => [
    ...entries.map((one) => ({ ...one })),
    {
      idx: entries.length,
      version: '6',
      when,
      tag: `${String(entries.length).padStart(4, '0')}_new_one`,
      breakpoints: true,
    },
  ]

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the rule, measured in BOTH directions
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · ahead of the clock, behind the clock, and the tie between them', () => {
    it('🔴 a head ABOVE the clock is stepped past it — the state this repository is actually in', () => {
      // ⛔ **The repository's own shape, with real numbers**: `0031` hand-set to `1789841991316`,
      // `0032` generated at `1789654195322` — 52.17 hours below — and the clock at the moment the
      // wrapper ran. ⚠️ The assertion is `>`, not `= previous + a day`: what makes the migration run
      // is the inequality, and a test that pinned the spacing would pass an implementation that
      // enforced its own constant and nothing else.
      const before = journalOf([1_789_755_591_316, 1_789_841_991_316])
      const plan = planStamp(
        before.entries,
        appended(before.entries, 1_789_654_195_322),
        1_789_668_105_584,
      )
      expect(plan.outcome).toBe('stamped')
      expect(plan.was).toBe(1_789_654_195_322)
      expect(plan.is).toBeGreaterThan(1_789_841_991_316)
      expect(outOfOrder([...before.entries, { when: plan.is }])).toEqual([])
      // ⚑ **And it steps by the smallest amount the applier's operator allows.** The number is an
      // ORDER; inventing a day of headroom would be this repository's own convention re-entered by
      // the one script written to stop depending on it.
      expect(plan.is).toBe(1_789_841_991_317)
    })

    it('⚑ …and a head BELOW the clock keeps the clock’s own number, so the stamps converge', () => {
      // ⛔ **The control, and it is the other reading of the same rule**
      // (`a-rule-measured-only-where-both-readings-agree`). Under `previous + spacing` this case is
      // indistinguishable from the one above and the fiction grows for ever; under `max` the wall
      // clock wins the moment it is ahead, and `new Date(when)` starts reading as the day the
      // migration was written.
      const before = journalOf([1_000, 2_000])
      const plan = planStamp(
        before.entries,
        appended(before.entries, 1_789_668_105_584),
        1_789_668_105_584,
      )
      expect(plan.outcome).toBe('stamped')
      expect(plan.is).toBe(1_789_668_105_584)
      expect(plan.was).toBe(plan.is)
      // ⚠️ **Nothing is rewritten in this direction** — the report says so, and it is the sentence
      // that tells a reader the wrapper is not quietly pushing every stamp further from real time.
      expect(report(plan)).toContain("keeps drizzle's own stamp")
    })

    it('🔴 a stamp EQUAL to the one before it is repaired — `<` is strict, so a tie is skipped too', () => {
      // ⛔ **The divergence between the two readings of the guard** (standing rule 3). An
      // implementation that repaired only `when < previous` passes every other row in this file and
      // ships a migration that never runs: `!lastDbMigration || Number(lastDbMigration[2]) <
      // migration.folderMillis` is FALSE on equality.
      const before = journalOf([1_000, 2_000])
      const plan = planStamp(before.entries, appended(before.entries, 2_000), 2_000)
      expect(plan.outcome).toBe('stamped')
      expect(plan.is).toBe(2_001)
      expect(stampAfter(2_000, 2_000)).toBe(2_001)
      // ⚑ **Paired with the same call one fact over allowed**: one millisecond higher is already
      // safe and is left exactly as drizzle wrote it.
      const fine = planStamp(before.entries, appended(before.entries, 2_001), 2_000)
      expect(fine.is).toBe(2_001)
      expect(fine.was).toBe(fine.is)
    })

    it('⛔ an empty journal takes the clock, because there is nothing to be above', () => {
      expect(stampAfter(undefined, 1_789_668_105_584)).toBe(1_789_668_105_584)
      const plan = planStamp([], appended([], 7), 1_789_668_105_584)
      expect(plan.outcome).toBe('stamped')
      expect(plan.is).toBe(1_789_668_105_584)
      expect(plan.previous).toBeNull()
      // ⚑ D-016 · and the line says what happened: no entry is behind it, so nothing is skipped.
      expect(report(plan)).toContain('is the first migration')
      expect(report(plan)).not.toContain('BELOW')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what it refuses, and the same call one fact over allowed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a stamp that has shipped is immutable', () => {
    it('🔴 refuses a journal that was ALREADY out of order, and says why rewriting history is worse', () => {
      // ⛔ **Both directions are wrong and the refusal names them**: lowered, the file is skipped on
      // every database that stopped there; raised above a `created_at` some database already holds,
      // the migration RE-APPLIES and a second `CREATE TABLE` throws on a live install.
      const broken = journalOf([3_000, 2_000])
      const plan = planStamp(broken.entries, appended(broken.entries, 9_000), 9_000)
      expect(plan.outcome).toBe('refused')
      expect(plan.why).toContain('ALREADY out of order')
      expect(plan.why).toContain('RE-APPLIES')
      expect(report(plan).startsWith('⛔')).toBe(true)
      // ⚑ **The pair, one fact over**: the same call on a journal whose two entries ascend stamps
      // normally — so this is a statement about the history, not a wrapper that refuses everything.
      const fine = journalOf([2_000, 3_000])
      expect(planStamp(fine.entries, appended(fine.entries, 9_000), 9_000).outcome).toBe('stamped')
      // ⛔ **A TIE in the history is out of order too, and it is the reading that diverges.** `<` is
      // strict, so two entries sharing a stamp mean the second never ran on any database that
      // reached the first — an `outOfOrder` written with `<` calls that journal healthy.
      const tied = journalOf([2_000, 2_000])
      expect(planStamp(tied.entries, appended(tied.entries, 9_000), 9_000).outcome).toBe('refused')
      expect(outOfOrder(tied.entries).map((one) => one.tag)).toEqual(['0001_row_1'])
    })

    it('⛔ refuses when the generator changed an entry it should never have touched', () => {
      const before = journalOf([1_000, 2_000])
      const after = appended(before.entries, 9_000)
      after[0].when = 1_500
      const plan = planStamp(before.entries, after, 9_000)
      expect(plan.outcome).toBe('refused')
      expect(plan.why).toContain('0000_row_0')
      expect(plan.why).toContain('never the history')
      // ⚑ The same run with the history left alone is stamped.
      expect(planStamp(before.entries, appended(before.entries, 9_000), 9_000).outcome).toBe(
        'stamped',
      )
    })

    it('⛔ refuses two appended entries, because one run of the generator writes one', () => {
      const before = journalOf([1_000, 2_000])
      const plan = planStamp(
        before.entries,
        appended(appended(before.entries, 8_000), 9_000),
        9_000,
      )
      expect(plan.outcome).toBe('refused')
      expect(plan.why).toContain('appended 2 entries')
    })

    it('⚑ a run that generated nothing is reported as nothing, not as a stamp', () => {
      // ⚠️ drizzle prints *"No schema changes, nothing to migrate"* and writes no entry; a wrapper
      // that stamped anyway would rewrite the last SHIPPED stamp, which §2 is entirely about.
      const before = journalOf([1_000, 2_000])
      const plan = planStamp(before.entries, before.entries, 9_000)
      expect(plan.outcome).toBe('nothing-generated')
      expect(report(plan)).toContain('no schema changes')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the generator path, run for real against a staged journal
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · generateWithStamp, end to end on the bytes', () => {
    let dir = ''

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'brobot2-stamp-'))
      mkdirSync(join(dir, 'meta'), { recursive: true })
    })

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    /**
     * ⛔ **What `drizzle-kit generate` does to the journal, and nothing else.** Quoted from its own
     * bundle in §4 below, which is what stops this being a fixture that agrees with itself:
     * `journal.entries.push({ idx, version, when: +new Date(), tag, breakpoints })`.
     */
    const drizzleWould = (path, when) => () => {
      const journal = JSON.parse(readFileSync(path, 'utf8'))
      journal.entries.push({
        idx: journal.entries.length,
        version: '6',
        when,
        tag: `${String(journal.entries.length).padStart(4, '0')}_odd_marvel_boy`,
        breakpoints: true,
      })
      writeFileSync(path, JSON.stringify(journal, null, 2))
    }

    const stage = (stamps, trailingNewline) => {
      const path = join(dir, 'meta', '_journal.json')
      writeFileSync(
        path,
        JSON.stringify(journalOf(stamps), null, 2) + (trailingNewline === true ? '\n' : ''),
      )
      return path
    }

    it('🔴 the file on disk ends up ABOVE the entry before it — the whole point of the wrapper', async () => {
      const path = stage([1_789_755_591_316, 1_789_841_991_316], true)
      const plan = await generateWithStamp({
        journalPath: path,
        generate: drizzleWould(path, 1_789_654_195_322),
        now: 1_789_668_105_584,
      })
      expect(plan.outcome).toBe('stamped')
      const written = JSON.parse(readFileSync(path, 'utf8'))
      expect(written.entries).toHaveLength(3)
      expect(written.entries[2].when).toBeGreaterThan(written.entries[1].when)
      expect(outOfOrder(written.entries)).toEqual([])
      // ⚠️ **And the entries before it are byte-for-byte what they were.** A wrapper that
      // renumbered the history would satisfy every inequality above and be the more dangerous bug.
      expect(written.entries.slice(0, 2)).toEqual(
        journalOf([1_789_755_591_316, 1_789_841_991_316]).entries,
      )
      // ⛔ **The COMMITTED file's trailing newline survives**, and this is the direction that
      // measures it: the staged journal has one, the stand-in for drizzle writes none — as drizzle
      // does — and the wrapper puts the byte back. ⚠️ `meta/` is in `.prettierignore`, so nothing
      // else in this repository would ever restore it and the loss would be a diff nobody made.
      expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true)
    })

    it('⚑ the control: the same path on a journal BEHIND the clock writes nothing at all', async () => {
      // ⛔ **Measured where the two readings DIVERGE.** Here drizzle's own stamp is already above
      // its predecessor, so the correct wrapper leaves the bytes alone — which is the direction an
      // always-rewrite implementation gets wrong and every monotonicity assertion still passes.
      const path = stage([1_000, 2_000], true)
      const plan = await generateWithStamp({
        journalPath: path,
        generate: drizzleWould(path, 1_789_668_105_584),
        now: 1_789_668_105_584,
      })
      expect(plan.was).toBe(plan.is)
      const after = readFileSync(path, 'utf8')
      expect(JSON.parse(after).entries[2].when).toBe(1_789_668_105_584)
      // ⛔ **Nothing was pushed further from real time.** Under `previous + spacing` this entry
      // would read `2_000 + a day`; the number on disk is the clock's own, unchanged.
      expect(JSON.parse(after).entries.map((one) => one.when)).toEqual([
        1_000, 2_000, 1_789_668_105_584,
      ])
    })

    it('⛔ the committed journal is the one whose bytes that rule is about', () => {
      // ⚠️ The row above stages a fixture; this one reads the file the rule exists to protect, so
      // *"preserve the trailing newline"* is a statement about this repository rather than about a
      // temporary directory.
      expect(readFileSync(JOURNAL, 'utf8').endsWith('\n')).toBe(true)
    })

    it('⛔ the read-back is a THROW, not a report — and it names the files that would be skipped', () => {
      // ⚑ **Asserted on the guard itself, because nothing a correct `planStamp` produces can reach
      // it through `generateWithStamp`.** ⚠️ That is exactly why it is worth having and exactly why
      // it has to be measured here: it checks the ARTEFACT, so an edit to `stampAfter` that got the
      // direction wrong stops the command rather than printing a sentence over a broken journal
      // (`a-line-no-mutation-can-kill-is-not-carrying-its-rule` — this one is killed by `522 M2`).
      expect(() =>
        refuseIfSkippable(journalOf([1_000, 3_000, 2_000]).entries, '0002_row_2'),
      ).toThrow(/STILL out of order at 0002_row_2/)
      // ⚑ **The pair, one fact over**: the same list with the last two stamps one millisecond apart
      // passes, so this is a statement about the order and not about the shape of the list.
      expect(() =>
        refuseIfSkippable(journalOf([1_000, 3_000, 3_001]).entries, '0002_row_2'),
      ).not.toThrow()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the two facts this wrapper is built on, read from the tools themselves
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · drizzle’s own source, and the absence of a second door', () => {
    const drizzleKit = () =>
      readFileSync(join(ROOT, 'apps/desktop/node_modules/drizzle-kit/bin.cjs'), 'utf8')

    it('🔴 drizzle-kit stamps the journal from the wall clock, and takes no option for it', () => {
      // ⛔ **Q2, censused rather than asserted.** If either of these stops matching, the paragraphs
      // in `scripts/db-generate.mjs` are describing a tool that no longer behaves that way — and
      // §3's stand-in for the generator stops being a stand-in for anything.
      const source = drizzleKit()
      expect(source).toContain('when: +/* @__PURE__ */ new Date()')
      // ⚑ **The only stamp-shaped option it HAS goes to the file name.** `prepareMigrationMetadata`
      // is where `prefix: 'timestamp' | 'unix' | …` is consumed, and it returns a tag — so there is
      // no configuration this wrapper could have used instead of rewriting.
      const opens = source.indexOf('prepareMigrationMetadata = (idx, prefixMode, name)')
      const closes = source.indexOf('return { prefix: prefix2, suffix, tag };', opens)
      expect(opens).toBeGreaterThan(-1)
      expect(closes).toBeGreaterThan(opens)
      const body = source.slice(opens, closes)
      expect(body).toContain('prefixMode === "timestamp"')
      expect(body).toContain('prefixMode === "unix"')
      expect(
        body,
        'a prefix option that reached the journal would make this a config, not a repair',
      ).not.toContain('when')
    })

    it('🔴 drizzle-orm applies a file only while the newest applied row is STRICTLY below it', () => {
      // ⛔ **Where the `+ 1` comes from.** The operator is the derivation; this is the line it is
      // derived from, read from the package that runs at startup.
      const dialect = readFileSync(
        join(ROOT, 'apps/desktop/node_modules/drizzle-orm/sqlite-core/dialect.js'),
        'utf8',
      )
      expect(dialect).toContain('Number(lastDbMigration[2]) < migration.folderMillis')
      expect(dialect).toContain('ORDER BY created_at DESC LIMIT 1')
    })

    it('⛔ `pnpm run db:generate` is the ONLY way to reach the generator', () => {
      // ⚑ **`516` F3 asked for the thing that stops a person having to notice**, and a second
      // script that still called drizzle directly would be exactly the door they would find. The
      // census reads every manifest in the repository, not the two this dispatch happened to edit
      // (`a-negative-is-only-as-strong-as-the-search-shape`).
      const manifests = {
        root: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')),
        desktop: JSON.parse(readFileSync(join(ROOT, 'apps/desktop/package.json'), 'utf8')),
        shared: JSON.parse(readFileSync(join(ROOT, 'packages/shared/package.json'), 'utf8')),
        runtime: JSON.parse(readFileSync(join(ROOT, 'packages/runtime/package.json'), 'utf8')),
        orchestration: JSON.parse(
          readFileSync(join(ROOT, 'packages/orchestration/package.json'), 'utf8'),
        ),
      }
      const callsDrizzle = Object.entries(manifests).flatMap(([where, manifest]) =>
        Object.entries(manifest.scripts ?? {})
          .filter(([, body]) => /drizzle-kit\s+generate/.test(body))
          .map(([name]) => `${where}:${name}`),
      )
      expect(callsDrizzle).toEqual([`desktop:${UNSTAMPED_SCRIPT}`])
      expect(manifests.root.scripts['db:generate']).toBe('node scripts/db-generate.mjs')
      // ⚠️ **And the wrapper reaches it by that name**, so renaming one half without the other is a
      // red rather than a generator that silently does nothing.
      expect(readFileSync(join(ROOT, 'scripts/db-generate.mjs'), 'utf8')).toContain(
        `'${UNSTAMPED_SCRIPT}'`,
      )
    })

    it('⚑ …and the census has a control, so it is not passing over a pattern nothing uses', () => {
      // ⛔ **A census that plants TWO** (standing rule 12): a second door added anywhere, under any
      // script name, has to show up — including beside the legitimate one in the same manifest.
      const spiked = {
        desktop: {
          scripts: {
            [UNSTAMPED_SCRIPT]: 'drizzle-kit generate',
            sneaky: 'drizzle-kit generate --custom',
          },
        },
        root: { scripts: { 'db:regen': 'pnpm --filter x exec drizzle-kit generate' } },
      }
      const caught = Object.entries(spiked).flatMap(([where, manifest]) =>
        Object.entries(manifest.scripts)
          .filter(([, body]) => /drizzle-kit\s+generate/.test(body))
          .map(([name]) => `${where}:${name}`),
      )
      expect(caught).toEqual(['desktop:db:generate:unstamped', 'desktop:sneaky', 'root:db:regen'])
    })
  })
})
