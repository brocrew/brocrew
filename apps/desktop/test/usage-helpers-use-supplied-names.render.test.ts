import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'
import type { Provider } from '@brobot2/shared'
import type { ProviderCondition } from '../src/shared/provider-limit'
import type { ListedConversation } from '../src/renderer/src/lib/conversation-list'
import { useUsageCells } from '../src/renderer/src/composables/useUsageCells'
import { usageSays, usageTitle } from '../src/renderer/src/lib/usage-limit'
import {
  providerLimitDisplay,
  messageLimitDisplay,
} from '../src/renderer/src/lib/provider-limit-status'
import { theirConversations } from '../src/renderer/src/lib/team-roster'
import { limitsDisplayWords } from '../src/renderer/src/lib/limits-display'

vi.mock('../src/renderer/src/composables/useMinuteClock', () => ({
  useMinuteClock: () => ({ value: Date.UTC(2026, 10, 11, 12) }),
}))
vi.mock('../src/renderer/src/composables/useProviderUsage', () => ({
  useProviderUsage: () => ({
    value: {
      claude: [
        {
          window: 'opaque-window',
          usedPercent: 73,
          at: Date.UTC(2026, 10, 11, 12),
          resetsAt: Date.UTC(2026, 10, 11, 14),
          period: { word: '5-hour', durationMs: 18_000_000, bucket: false, bucketName: null },
        },
      ],
      codex: [],
    },
  }),
}))
vi.mock('../src/renderer/src/composables/useWhoCalledWhom', () => ({
  useWhoCalledWhom: () => ({
    forest: { value: null },
    processMemory: { value: new Map() },
    memoryUnmeasured: { value: null },
    runningConversations: {
      value: [
        { provider: 'claude', state: { is: 'active' } },
        { provider: 'codex', state: { is: 'idle' } },
      ],
    },
  }),
}))

type Names = Readonly<Partial<Record<Provider, string>>>
const names: Names = { claude: 'Fern', codex: 'Birch' }
const opposite: Names = { claude: 'Birch', codex: 'Fern' }
const NOW = Date.UTC(2026, 10, 11, 12)
const RESET = NOW + 2 * 3_600_000
const condition: ProviderCondition = {
  key: 'opaque',
  provider: 'claude',
  standing: 'about-to-stop',
  says: 'Opaque native sentence.',
  said: ['raw retained line'],
  resetsAt: RESET,
  meaning: [{ word: '5-hour', used: 73, untimed: false }],
}
const current = {
  providerBlockStatus: 'current',
  providerBlock: { provider: 'claude', resetsAt: RESET },
} as const
const queued = {
  id: 'fictional-held',
  kind: 'notice',
  text: 'Keep exact',
  since: NOW,
  holdReasonStatus: 'current',
  holdReason: { is: 'provider-limit', provider: 'claude', resetsAt: RESET },
} as const

afterEach(() => vi.useRealTimers())

it('changes only the supplied name in an app-authored usage sentence', () => {
  const before = JSON.stringify(condition)
  expect(usageSays(condition, NOW, names)).toBe(
    'Fern is near its 5-hour limit (73% used); it resets in 2 h.',
  )
  expect(usageSays(condition, NOW, opposite)).toBe(
    'Birch is near its 5-hour limit (73% used); it resets in 2 h.',
  )
  expect(usageTitle(condition)).toContain('raw retained line')
  expect(JSON.stringify(condition)).toBe(before)
  expect(usageSays({ ...condition, meaning: undefined }, NOW, names)).toBe(condition.says)
})

it('uses supplied names for every current stop and held-message label without changing facts', () => {
  const before = JSON.stringify({ current, queued })
  for (const [context, label] of [
    [names, 'Fern'],
    [opposite, 'Birch'],
  ] as const) {
    const stop = providerLimitDisplay(current, { is: 'idle' }, NOW, context)
    expect(stop?.word).toBe(`Stopped: ${label}’s limit · resets in 2 h`)
    expect(stop?.short).toBe(`${label} limit`)
    expect(stop?.detail).toContain(`Stopped: ${label}’s limit`)
    const held = messageLimitDisplay(queued, NOW, context)
    expect(held?.word).toBe(`not sent · waiting for ${label}’s limit to reset · resets in 2 h`)
    expect(held?.short).toBe(`not sent · ${label} limit`)
    expect(held?.heldWord).toBe(`waiting for ${label}’s limit to reset · resets in 2 h`)
    expect(held?.heldShort).toBe(`${label} limit`)
    expect(held?.detail).toContain(`waiting for ${label}’s limit to reset`)
    expect(providerLimitDisplay(current, { is: 'active' }, NOW, context)).toBeNull()
  }
  expect(JSON.stringify({ current, queued })).toBe(before)
})

it('names dated history and rail summaries from the same explicit context', () => {
  const block = { provider: 'claude', resetsAt: RESET, asOf: NOW, displayUntil: RESET } as const
  const facts = { providerBlockStatus: 'unavailable', providerBlockLastKnown: block } as const
  expect(limitsDisplayWords.rail(['claude', 'codex'], names)).toBe('Fern limit · Birch limit')
  expect(limitsDisplayWords.rail(['claude', 'codex'], opposite)).toBe('Birch limit · Fern limit')
  const history = limitsDisplayWords.lastKnown(block, names)
  expect(history).toMatch(/^Last known: stopped at Fern’s limit · as of /)
  const shown = providerLimitDisplay(facts, { is: 'idle' }, NOW + 1, names)
  expect(shown?.history).toBe(history)
  expect(shown?.word).toBe('Current limit status unavailable')
  expect(providerLimitDisplay(facts, { is: 'idle' }, RESET, names)).not.toHaveProperty('history')
  expect(providerLimitDisplay(facts, { is: 'idle' }, NOW - 1, names)).not.toHaveProperty('history')
})

it('keeps Team rows tied to their facts while names come from each current caller', () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  const listed: ListedConversation[] = [
    {
      ...current,
      sessionId: 'fictional',
      provider: 'claude',
      label: 'Ada',
      identity: 'ada',
      place: 'folder',
      state: { is: 'idle' },
      named: null,
      inAnotherWindow: false,
      updatedAt: NOW,
    },
  ]
  const before = JSON.stringify(listed)
  const fern = theirConversations(listed, 'ada', new Set(), names)
  const birch = theirConversations(listed, 'ada', new Set(), opposite)
  expect(fern?.[0]?.word).toBe('Fern limit')
  expect(birch?.[0]?.word).toBe('Birch limit')
  expect(
    fern?.map(({ conversation, standing, action, place }) => ({
      conversation,
      standing,
      action,
      place,
    })),
  ).toEqual(
    birch?.map(({ conversation, standing, action, place }) => ({
      conversation,
      standing,
      action,
      place,
    })),
  )
  expect(JSON.stringify(listed)).toBe(before)
  expect(theirConversations(null, 'ada', new Set(), names)).toBeNull()
  expect(theirConversations([], 'ada', new Set(), names)).toEqual([])
})

it('relabels cells, accessibility words, totals and title line when only current names change', () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  const selected = shallowRef<Names>(names)
  const scope = effectScope()
  const cells = scope.run(() =>
    useUsageCells(
      () => ({ claude: true, codex: false }),
      () => selected.value,
    ),
  )!
  try {
    const first = cells.cells.value
    expect(first.find((cell) => cell.key === 'claude-5h')?.label).toBe('Fern · 5h')
    expect(first.find((cell) => cell.key === 'claude-5h')?.name).toContain('Fern 5-hour limit: 73%')
    expect(cells.line.value).toContain('Birch · Needs setup')
    expect(cells.description.value).toContain('Fern is ready')
    expect(first.find((cell) => cell.key === 'agents')?.value).toBe(
      'Fern 1 (1 working)\nBirch 1 (none working)',
    )
    selected.value = opposite
    const next = cells.cells.value
    expect(next.find((cell) => cell.key === 'claude-5h')?.label).toBe('Birch · 5h')
    expect(next.find((cell) => cell.key === 'claude-5h')?.name).toContain('Birch 5-hour limit: 73%')
    expect(cells.line.value).toContain('Fern · Needs setup')
    expect(cells.description.value).toContain('Birch is ready')
    expect(next.find((cell) => cell.key === 'agents')?.value).toBe(
      'Birch 1 (1 working)\nFern 1 (none working)',
    )
    expect(
      next
        .filter((cell) => cell.key !== 'agents')
        .map(({ key, value, age, title }) => ({ key, value, age, title })),
    ).toEqual(
      first
        .filter((cell) => cell.key !== 'agents')
        .map(({ key, value, age, title }) => ({ key, value, age, title })),
    )
  } finally {
    scope.stop()
  }
})

it('uses generic provider wording for an explicit unread context, with no native or opaque fallback', () => {
  expect(usageSays(condition, NOW, {})).toMatch(/^This provider is near /)
  expect(providerLimitDisplay(current, { is: 'idle' }, NOW, {})?.word).toMatch(
    /^Stopped: the provider’s limit/,
  )
  expect(messageLimitDisplay(queued, NOW, {})?.word).toMatch(
    /^not sent · waiting for the provider’s limit/,
  )
  expect(limitsDisplayWords.rail(['claude'], {})).toBe('Provider limit')
  expect(
    limitsDisplayWords.lastKnown({ provider: 'claude', resetsAt: null, asOf: NOW }, {}),
  ).toMatch(/^Last known: stopped at the provider’s limit/)
})
