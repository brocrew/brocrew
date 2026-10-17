import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { PermissionOutcome, RuntimeEvent } from '@brobot2/runtime'
import { toWireEvent } from '../src/main/runtime/event-wire'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  DEFAULT_IS_NO,
  GRANT_WITHHELD,
  inTheProvidersWords,
} from '../src/renderer/src/lib/permission-offer'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'

/**
 * 🔴 **700 · `695` F-f — the provider's own reason for an ask it marked, drawn where its marks are.**
 *
 * ⚑ The Claude adapter carries `providerReason` only on a marked ask and never when the words are our
 * own hook's (and since `720` (R73) a Codex command an exec-policy rule stopped carries it too, labelled `providerReasonFrom: 'a-policy-rule'`, which every surface draws as that provider's RULE since `725` — `the-agents-words-and-the-providers-rule.render.test.ts`; THIS file's marked asks are R73's control) (`claude-runtime.test.ts`, `700 · 695 F-f`). This file follows it the rest of the way: across
 * main's wire (which strips every field outside the schema), onto the card, and onto Home's row — one
 * sentence from one function, `whatTheMarksSay`, for both surfaces (`299`'s rule, which `695` kept).
 *
 * ⚑ Every positive has its control one fact over: the same marked card with no reason draws the mark's
 * own line and no reason (rule 3). SSR, so each negative sits beside a positive the same markup
 * satisfies ([[brobot2-ssr-tests-pass-vacuously]]).
 */

/** Measured by `probe:permission-markers` (`695`, CLI 2.1.281) on the marked `echo r36 &`. */
const THE_CLIS_OWN =
  'This command uses the `&` background operator, which defers execution past approval-time safety checks. Approve only if you trust it.'

/** What the adapter offers a marked card — both session grants withheld. */
const WITHHELD: PermissionOutcome[] = ['allow', 'deny', 'cancel']

type PermissionRequest = Extract<RuntimeEvent, { type: 'permission_request' }>

const markedAsk = (
  extra: { providerReason?: string; defaultToNo?: true } = {},
): PermissionRequest => ({
  type: 'permission_request',
  id: 'req_1',
  kind: 'command',
  action: 'Bash',
  detail: 'echo r36 &',
  scope: {
    cwd: '/tmp/x',
    paths: [],
    networkHosts: [],
    persistence: 'once',
    amendments: [],
    availableDecisions: WITHHELD,
    underDisclosed: true,
  },
  suppressAlwaysAllowRule: true,
  ...extra,
})

const renderCard = (request: Record<string, unknown>): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(PermissionCard as never, {
          item: { at: 1_700_000_000_000, outcome: null, note: null, request },
        }),
    }),
  )

/** Every text a `data-cy` element holds, in document order. */
const textsOf = (html: string, cy: string): string[] =>
  [...html.matchAll(new RegExp(`data-cy="${cy}"[^>]*>([\\s\\S]*?)</`, 'g'))].map((one) =>
    one[1]!.trim(),
  )

describe('700 · the reason crosses main’s wire', () => {
  it('🔴 `toWireEvent` keeps it — the wire strips every field outside the schema', () => {
    const wired = toWireEvent('claude', markedAsk({ providerReason: THE_CLIS_OWN }))
    expect(wired).toMatchObject({ type: 'permission_request', providerReason: THE_CLIS_OWN })
  })

  it('⚑ THE CONTROL — a field the schema does not name is stripped on the same path', () => {
    const wired = toWireEvent('claude', {
      ...markedAsk(),
      notInTheSchema: THE_CLIS_OWN,
    } as unknown as RuntimeEvent)
    expect(wired.type).toBe('permission_request')
    expect('notInTheSchema' in wired).toBe(false)
  })
})

describe('700 · the card', () => {
  it('🔴 a marked card says the provider’s reason, in its words, beside the mark’s own line', async () => {
    const html = await renderCard(markedAsk({ providerReason: THE_CLIS_OWN }))
    expect(textsOf(html, 'permission-provider-reason')).toEqual([
      'The provider’s reason: “This command uses the `&amp;` background operator, which defers execution past approval-time safety checks. Approve only if you trust it.”',
    ])
    expect(inTheProvidersWords(THE_CLIS_OWN)).toBe(`The provider’s reason: “${THE_CLIS_OWN}”`)
    expect(textsOf(html, 'permission-grant-withheld')).toEqual([GRANT_WITHHELD])
  })

  it('⚑ THE CONTROL — the same marked card with no reason draws its mark’s line and no reason', async () => {
    const html = await renderCard(markedAsk())
    expect(textsOf(html, 'permission-grant-withheld')).toEqual([GRANT_WITHHELD])
    expect(html).not.toContain('data-cy="permission-provider-reason"')
    expect(html).not.toContain('The provider’s reason')
  })

  it('🔴 the three lines read in one order — what the marks did, then the provider’s reason for them', async () => {
    const html = await renderCard(markedAsk({ providerReason: THE_CLIS_OWN, defaultToNo: true }))
    const at = (cy: string): number => html.indexOf(`data-cy="${cy}"`)
    for (const cy of [
      'permission-grant-withheld',
      'permission-default-no',
      'permission-provider-reason',
    ])
      expect(at(cy), cy).toBeGreaterThan(-1)
    expect(at('permission-grant-withheld')).toBeLessThan(at('permission-default-no'))
    expect(at('permission-default-no')).toBeLessThan(at('permission-provider-reason'))
    expect(at('permission-provider-reason')).toBeLessThan(at('permission-after'))
  })

  it('⛔ the reason is drawn as TEXT — markup in it is escaped, never rendered', async () => {
    const html = await renderCard(
      markedAsk({ providerReason: 'Approve <img src=x onerror=1> only' }),
    )
    expect(textsOf(html, 'permission-provider-reason')).toEqual([
      'The provider’s reason: “Approve &lt;img src=x onerror=1&gt; only”',
    ])
    expect(html).not.toContain('<img')
  })
})

describe('700 · Home’s row says the same thing', () => {
  function homeRow(extra: { providerReason?: string; defaultToNo?: true }): AttentionRequest {
    const record = createSessionRecord('sess_1')
    record.meta = {
      sessionId: 'sess_1',
      provider: 'claude',
      cwd: '/tmp/x',
      profileId: 'default',
    } as never
    record.phase = 'open'
    applyEvent(record.control, markedAsk(extra) satisfies TranscriptEvent, 1_700_000_000_000)
    const rows = attentionQueue([record], () => 'waiting: permission')
    expect(rows, 'the projection produced no row').toHaveLength(1)
    const row = rows[0]!
    if (row.kind !== 'permission') throw new Error('not a permission row')
    return row
  }
  const renderHome = (row: AttentionRequest): Promise<string> =>
    renderToString(
      createSSRApp({
        render: () => h(AttentionQueue as never, { requests: [row], now: 1_700_000_060_000 }),
      }),
    )

  it('🔴 the row carries the card’s own sentence after the mark’s, and draws both', async () => {
    const row = homeRow({ providerReason: THE_CLIS_OWN })
    expect(row.marksSay).toEqual([GRANT_WITHHELD, inTheProvidersWords(THE_CLIS_OWN)])
    expect(textsOf(await renderHome(row), 'attention-mark')).toEqual([
      GRANT_WITHHELD,
      'The provider’s reason: “This command uses the `&amp;` background operator, which defers execution past approval-time safety checks. Approve only if you trust it.”',
    ])
  })

  it('🔴 with both marks, Home reads the card’s order — the reason last', async () => {
    const row = homeRow({ providerReason: THE_CLIS_OWN, defaultToNo: true })
    expect(row.marksSay).toEqual([GRANT_WITHHELD, DEFAULT_IS_NO, inTheProvidersWords(THE_CLIS_OWN)])
  })

  it('⚑ THE CONTROL — no reason, and the row says only what the mark says', async () => {
    const row = homeRow({})
    expect(row.marksSay).toEqual([GRANT_WITHHELD])
    const html = await renderHome(row)
    expect(textsOf(html, 'attention-mark')).toEqual([GRANT_WITHHELD])
    expect(html).not.toContain('The provider’s reason')
  })
})
