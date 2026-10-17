import { describe, expect, it } from 'vitest'
import { PLACEHOLDER, scrubbed, type Scrub } from '../smoke/provider-snapshot-parts'
import { SNAPSHOT_FILES_BY_PLATFORM } from '../src/main/provider-snapshots'

/**
 * # 🔴 F093 · R3 — a date is made a placeholder by its shape, where the provider writes it
 *
 * ⚑ Each provider writes today's date in this computer's own zone, so the probe cannot know it
 * exactly: since `0c4d9262` its scrubs are patterns ({@link Scrub}'s `from: RegExp`), the same three
 * the probe (`provider-snapshots.smoke.ts`, `scrubsFor`) writes. ⚑ **Two halves**: `scrubbed` read on
 * each accepted shape and on a refused one; and the files this build carries, where every place a
 * provider writes today's date holds the placeholder.
 *
 * ⛔ A refusal is read beside an acceptance by the same scrub.
 */

/** ⚑ The probe's date scrubs, as `scrubsFor` writes them (not exported from the smoke file). */
const DATES: readonly Scrub[] = [
  { from: /Today's date is \d{4}-\d{2}-\d{2}/, to: `Today's date is ${PLACEHOLDER.date}` },
  {
    from: /<current_date>[^<]*<\/current_date>/,
    to: `<current_date>${PLACEHOLDER.date}</current_date>`,
  },
  { from: /<timezone>[^<]*<\/timezone>/, to: `<timezone>${PLACEHOLDER.timezone}</timezone>` },
]

describe('§1 · the shapes a pattern takes, and the ones it leaves', () => {
  it('🔴 Claude’s “Today’s date is”: any day in the ISO shape — yesterday’s in another zone too', () => {
    for (const day of ['2026-10-05', '2026-10-04', '1999-12-31']) {
      expect(scrubbed(`Today's date is ${day}.`, DATES), day).toBe(
        `Today's date is ${PLACEHOLDER.date}.`,
      )
    }
  })

  it('⛔ …and a date in another shape, or an ISO date written elsewhere, is left as it is', () => {
    for (const text of [
      "Today's date is October 5, 2026.",
      "Today's date is 2026-1-5.",
      'Convert relative dates when saving (e.g., "Thursday" → "2026-03-05").',
      'merge freeze begins 2026-03-05',
    ]) {
      expect(scrubbed(text, DATES), text).toBe(text)
    }
  })

  it('🔴 Codex’s `<current_date>` and `<timezone>`: whatever they hold, in any spelling, even nothing', () => {
    for (const body of ['2026-10-05', 'Monday, October 5, 2026', '']) {
      expect(scrubbed(`<current_date>${body}</current_date>`, DATES), body).toBe(
        `<current_date>${PLACEHOLDER.date}</current_date>`,
      )
    }
    for (const zone of ['Europe/Copenhagen', 'America/Argentina/Buenos_Aires', 'UTC', '']) {
      expect(scrubbed(`<timezone>${zone}</timezone>`, DATES), zone).toBe(
        `<timezone>${PLACEHOLDER.timezone}</timezone>`,
      )
    }
  })

  it('⛔ “UTC” is also Codex’s own word: outside its tag it stays', () => {
    const own = 'Returns the current time in UTC.\n  // Current UTC time\nYYYY-MM-DD HH:MM:SS UTC.'
    expect(scrubbed(own, DATES)).toBe(own)
    // ⚑ …with the tag beside it, only the tag's value goes.
    expect(scrubbed(`${own}\n<timezone>UTC</timezone>`, DATES)).toBe(
      `${own}\n<timezone>${PLACEHOLDER.timezone}</timezone>`,
    )
  })

  it('🔴 every place a pattern matches, not the first only — though the pattern was given without `g`', () => {
    expect(DATES.every((one) => one.from instanceof RegExp && !one.from.global)).toBe(true)
    const twice =
      "<system-reminder>\nToday's date is 2026-10-05.\n</system-reminder>\n\nToday's date is 2026-10-04."
    expect(scrubbed(twice, DATES)).toBe(
      `<system-reminder>\nToday's date is ${PLACEHOLDER.date}.\n</system-reminder>\n\nToday's date is ${PLACEHOLDER.date}.`,
    )
    const two = '<current_date>a</current_date> <current_date>b</current_date>'
    expect(scrubbed(two, DATES)).toBe(
      `<current_date>${PLACEHOLDER.date}</current_date> <current_date>${PLACEHOLDER.date}</current_date>`,
    )
  })

  it('⚑ a pattern does not cross from one tag into the next', () => {
    const text = '<current_date>a</current_date>\n<shell>zsh</shell>\n<timezone>X</timezone>'
    expect(scrubbed(text, DATES)).toBe(
      `<current_date>${PLACEHOLDER.date}</current_date>\n<shell>zsh</shell>\n<timezone>${PLACEHOLDER.timezone}</timezone>`,
    )
  })

  it('⚑ with literals beside the patterns: each kind applied, and the tokens left counted as one', () => {
    const scrubs: Scrub[] = [{ from: '/scratch/w', to: PLACEHOLDER.folder }, ...DATES]
    expect(
      scrubbed(
        "Working directory: /scratch/w\n<total_tokens>99 tokens left</total_tokens>\n\nToday's date is 2026-10-05.",
        scrubs,
      ),
    ).toBe(
      `Working directory: ${PLACEHOLDER.folder}\n<total_tokens>${PLACEHOLDER.tokensLeft} tokens left</total_tokens>\n\nToday's date is ${PLACEHOLDER.date}.`,
    )
    // ⚑ The same pattern object used twice answers the same: no state is carried between texts.
    const once = scrubbed('<timezone>A</timezone>', DATES)
    expect(scrubbed('<timezone>B</timezone>', DATES)).toBe(once)
  })
})

describe('§2 · the files this build carries', () => {
  // ⚑ Every platform's capture, whichever platform runs this.
  const textsOf = (provider: 'claude' | 'codex'): string[] =>
    Object.values(SNAPSHOT_FILES_BY_PLATFORM).flatMap((files) =>
      Object.values(files[provider].texts),
    )

  /** ⚑ Every value a provider wrote where `pattern` finds it. */
  const valuesAt = (pattern: RegExp, texts: readonly string[]): string[] =>
    texts.flatMap((text) => [...text.matchAll(pattern)].map((match) => match[1] ?? ''))

  it('🔴 wherever Claude Code writes today’s date, the snapshot holds the placeholder', () => {
    const said = valuesAt(/Today's date is ([^\n]*?)\.?(?:\n|$)/g, textsOf('claude'))
    // ⚑ Presence first: Claude Code writes it, so there is something to read.
    expect(said.length).toBeGreaterThan(0)
    expect([...new Set(said)]).toEqual([PLACEHOLDER.date])
  })

  it('🔴 wherever Codex writes its date and zone, the snapshot holds the placeholders', () => {
    const texts = textsOf('codex')
    const dates = valuesAt(/<current_date>([^<]*)<\/current_date>/g, texts)
    const zones = valuesAt(/<timezone>([^<]*)<\/timezone>/g, texts)
    expect(dates.length).toBeGreaterThan(0)
    expect(zones.length).toBeGreaterThan(0)
    expect([...new Set(dates)]).toEqual([PLACEHOLDER.date])
    expect([...new Set(zones)]).toEqual([PLACEHOLDER.timezone])
  })

  it('⛔ no place a provider writes the date holds a date of the capture, in either file', () => {
    for (const provider of ['claude', 'codex'] as const) {
      for (const text of textsOf(provider)) {
        expect(text, provider).not.toMatch(/Today's date is \d{4}-\d{2}-\d{2}/)
        expect(text, provider).not.toMatch(/<current_date>(?!⟨)[^<]*<\/current_date>/)
        expect(text, provider).not.toMatch(/<timezone>(?!⟨)[^<]*<\/timezone>/)
      }
    }
  })
})
