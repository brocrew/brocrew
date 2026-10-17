import { describe, expect, it } from 'vitest'
import { NO_LAUNCH_CHOICES } from '../src/renderer/src/lib/launch-choices'
import {
  inTheListsSpelling,
  theFormSends,
  thePickerRows,
} from '../src/renderer/src/lib/model-lists'
import type { ModelList } from '../src/shared/runtime-ipc'

/**
 * # W4.42 · a model named in another letter case, or with spaces around it, is the same model
 * (`5d5a991a`)
 *
 * ⚑ A last pick stored as `claude-opus-5-5[1M]` is the list's `claude-opus-5-5[1m]`: the picker adds
 * no "(no longer listed)" row beside it, shows the list's own spelling (the picker's face and the
 * Providers card's *"New conversations start on …"*), and the form does not send a last pick the host
 * would start on anyway. ⚑ `sameModel` is case and surrounding spaces aside — nothing more.
 *
 * ⚠️ `the-one-model-picker-holds-and-sends.test.ts` names the last pick and the host's start in ONE
 * spelling, so `===` in `theFormSends`'s place is not seen there (table 2007's own note); the
 * second describe below is that test.
 */

const row = (id: string, extra: object = {}) => ({
  id,
  label: id,
  efforts: [],
  addedBy: 'the-provider' as const,
  ...extra,
})

const OPUS_1M = 'claude-opus-5-5[1m]'

const list = (over: Partial<ModelList> = {}): ModelList => ({
  provider: 'claude',
  notAsked: null,
  standIn: null,
  models: [row(OPUS_1M), row('claude-sonnet-5-5'), row('opus', { resolvesTo: 'claude-opus-5-5' })],
  lastPicked: null,
  startsOn: null,
  ...over,
})

describe('5d5a991a · thePickerRows — the current pick adds a row only when no row is that model', () => {
  it('🔴 a pick in another letter case, or with spaces around it, is the listed row — no extra row', () => {
    const listed = list()
    const plain = thePickerRows(listed, null).map((one) => one.id)
    for (const current of ['claude-opus-5-5[1M]', 'CLAUDE-OPUS-5-5[1M]', `  ${OPUS_1M} `]) {
      const rows = thePickerRows(listed, current)
      expect(
        rows.map((one) => one.id),
        current,
      ).toEqual(plain)
      expect(
        rows.every((one) => one.row !== null),
        current,
      ).toBe(true)
    }
  })

  it('⛔ a pick no row names is still its own row, marked as not the list’s', () => {
    const rows = thePickerRows(list(), 'claude-haiku-9')
    expect(rows.at(-1)).toEqual({ id: 'claude-haiku-9', row: null })
    expect(rows).toHaveLength(list().models.length + 1)
    // ⚑ Not a near spelling: a different id that merely contains the listed one is another model.
    expect(thePickerRows(list(), `${OPUS_1M}-preview`).at(-1)?.row).toBeNull()
  })

  it('⚑ no pick, or no list: the list’s rows, and the pick alone', () => {
    expect(thePickerRows(list(), null)).toHaveLength(list().models.length)
    expect(thePickerRows(null, 'claude-opus-5-5[1M]')).toEqual([
      { id: 'claude-opus-5-5[1M]', row: null },
    ])
  })
})

describe('5d5a991a · inTheListsSpelling — what the picker’s face and the Providers card show', () => {
  it('🔴 a model the list holds is shown as the list spells it', () => {
    expect(inTheListsSpelling(list(), 'claude-opus-5-5[1M]')).toBe(OPUS_1M)
    expect(inTheListsSpelling(list(), ' CLAUDE-SONNET-5-5 ')).toBe('claude-sonnet-5-5')
  })

  it('⛔ a model the list does not hold, or no list at all, is shown as given', () => {
    expect(inTheListsSpelling(list(), 'Claude-Haiku-9')).toBe('Claude-Haiku-9')
    expect(inTheListsSpelling(null, 'claude-opus-5-5[1M]')).toBe('claude-opus-5-5[1M]')
  })

  it('⚠️ matched by a row’s own id only — never re-spelled as the alias that points at it', () => {
    // `opus` resolves to `claude-opus-5-5`; a pick of that model is the person's, not the alias.
    expect(inTheListsSpelling(list(), 'CLAUDE-OPUS-5-5')).toBe('CLAUDE-OPUS-5-5')
    // ⚑ The control: the alias row's own id, in another case, is that row.
    expect(inTheListsSpelling(list(), 'OPUS')).toBe('opus')
  })
})

describe('5d5a991a · theFormSends — the last pick is not sent where the host would start on it anyway', () => {
  it('🔴 the last pick and the host’s start in two spellings of one model: nothing is sent', () => {
    const lastPicked = { model: 'claude-opus-5-5[1M]', effort: 'high' }
    const startsOn = { model: ` ${OPUS_1M}`, effort: 'high', from: 'the-last-pick' as const }
    expect(theFormSends(NO_LAUNCH_CHOICES, list({ lastPicked, startsOn }))).toBeNull()
  })

  it('⛔ the same model at another effort, or another model, is sent — as the person picked it', () => {
    const lastPicked = { model: 'claude-opus-5-5[1M]', effort: 'high' }
    expect(
      theFormSends(
        NO_LAUNCH_CHOICES,
        list({
          lastPicked,
          startsOn: { model: OPUS_1M, effort: 'low', from: 'its-default' as const },
        }),
      ),
    ).toEqual(lastPicked)
    expect(
      theFormSends(
        NO_LAUNCH_CHOICES,
        list({
          lastPicked,
          startsOn: { model: 'claude-sonnet-5-5', effort: 'high', from: 'its-default' as const },
        }),
      ),
    ).toEqual(lastPicked)
  })
})
