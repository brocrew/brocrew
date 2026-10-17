import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { PermissionOutcome } from '@brobot2/runtime'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  DEFAULT_IS_NO,
  GRANT_WITHHELD,
  permissionOffer,
} from '../src/renderer/src/lib/permission-offer'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'

/**
 * 🔴 **695 · R36 — what a person sees on an ask the provider marked.**
 *
 * | mark | the provider's words (`sdk.d.ts`, 0.3.281) | the card |
 * |---|---|---|
 * | `suppressAlwaysAllowRule` | *"must not offer a persistent 'don't ask again' choice: the rule it would write grants more than this ask's own action"* | no session grant (the adapter already withheld it), and a line saying why — {@link GRANT_WITHHELD} |
 * | `defaultToNo` | *"must not be approvable by a single stray keystroke"* | Deny first; Approve OUTLINED rather than filled (Deny keeps the tint every Deny has); a line saying why — {@link DEFAULT_IS_NO} — and on Home, the refusals are not dimmed |
 *
 * ⚑ Every assertion has an UNMARKED control beside it: the same card without the mark keeps today's
 * order, today's filled Approve and says neither sentence (rule 3 — tested where the readings
 * diverge). SSR, so each negative has a positive the same markup satisfies
 * ([[brobot2-ssr-tests-pass-vacuously]]).
 */

const DISCLOSED: PermissionOutcome[] = ['allow', 'allow_for_session', 'deny', 'cancel']
/** What the adapter offers a marked card — both session grants withheld (`claudeDecisionsFor`). */
const WITHHELD: PermissionOutcome[] = ['allow', 'deny', 'cancel']

const card = (
  availableDecisions: PermissionOutcome[],
  marks: { suppressAlwaysAllowRule?: true; defaultToNo?: true } = {},
): Record<string, unknown> => ({
  item: {
    at: 1_700_000_000_000,
    outcome: null,
    note: null,
    request: {
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
        availableDecisions,
        underDisclosed: true,
      },
      ...marks,
    },
  },
})

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(PermissionCard as never, props) }))

/** The row's buttons in document order, each with its class list. */
function buttons(html: string): { outcome: string; classes: string[] }[] {
  return [...html.matchAll(/<button([^>]*)data-cy="permission-([a-z_]+)"/g)].map((match) => ({
    outcome: match[2]!,
    classes: (/class="([^"]*)"/.exec(match[1]!)?.[1] ?? '').split(/\s+/),
  }))
}

describe('695 · R36b — the offer’s order and its default', () => {
  it('a `defaultToNo` ask leads with its refusals and names refusal as the default', () => {
    const offer = permissionOffer(DISCLOSED, 'Bash', { defaultToNo: true })
    expect(offer.row).toEqual(['deny', 'cancel', 'allow', 'allow_for_session'])
    expect(offer.primary).toBe('refuses')
  })

  it('control — unmarked, today’s order and today’s default', () => {
    const offer = permissionOffer(DISCLOSED, 'Bash')
    expect(offer.row).toEqual(['allow', 'allow_for_session', 'deny', 'cancel'])
    expect(offer.primary).toBe('allows')
  })

  it('nothing is added or dropped — only the order moves', () => {
    const marked = permissionOffer(DISCLOSED, 'Bash', { defaultToNo: true })
    const plain = permissionOffer(DISCLOSED, 'Bash')
    expect([...marked.row].sort()).toEqual([...plain.row].sort())
    expect(marked.wide).toEqual(plain.wide)
  })
})

describe('695 · R36 — the card', () => {
  it('R36a · a marked card offers no session grant and says why, where the button would be', async () => {
    const html = await render(card(WITHHELD, { suppressAlwaysAllowRule: true }))
    expect(buttons(html).map((one) => one.outcome)).toEqual(['allow', 'deny', 'cancel'])
    expect(html).toContain('data-cy="permission-grant-withheld"')
    expect(html).toContain(GRANT_WITHHELD)
  })

  it('R36a · the sentence follows the OFFER too — a marked card that still offered a grant would not say it', async () => {
    const html = await render(card(DISCLOSED, { suppressAlwaysAllowRule: true }))
    expect(html).toContain('data-cy="permission-allow_for_session"')
    expect(html).not.toContain(GRANT_WITHHELD)
  })

  it('R36a control — an unmarked card says no such thing', async () => {
    const html = await render(card(WITHHELD))
    expect(buttons(html).map((one) => one.outcome)).toEqual(['allow', 'deny', 'cancel'])
    expect(html).not.toContain('data-cy="permission-grant-withheld"')
    expect(html).not.toContain(GRANT_WITHHELD)
  })

  it('R36b · a `defaultToNo` card draws Deny first, and Approve outlined rather than filled', async () => {
    const html = await render(card(WITHHELD, { defaultToNo: true }))
    const row = buttons(html)
    expect(row.map((one) => one.outcome)).toEqual(['deny', 'cancel', 'allow'])
    const allow = row.find((one) => one.outcome === 'allow')
    expect(allow?.classes).toContain('approve-quiet')
    expect(allow?.classes).not.toContain('approve')
    expect(html).toContain('data-cy="permission-default-no"')
    expect(html).toContain(DEFAULT_IS_NO)
  })

  it('R36b control — unmarked, Approve is first and filled, and no line is drawn', async () => {
    const html = await render(card(WITHHELD))
    const row = buttons(html)
    expect(row[0]?.outcome).toBe('allow')
    expect(row[0]?.classes).toContain('approve')
    expect(row[0]?.classes).not.toContain('approve-quiet')
    expect(html).not.toContain('data-cy="permission-default-no"')
  })
})

describe('695 · R36 — Home’s row reads the same order and says the same things', () => {
  function homeRow(marks: {
    defaultToNo?: true
    suppressAlwaysAllowRule?: true
  }): AttentionRequest {
    const record = createSessionRecord('sess_1')
    record.meta = {
      sessionId: 'sess_1',
      provider: 'claude',
      cwd: '/tmp/x',
      profileId: 'default',
    } as never
    record.phase = 'open'
    applyEvent(
      record.control,
      {
        type: 'permission_request',
        id: 'req_1',
        kind: 'command',
        action: 'Bash',
        detail: 'echo r36',
        scope: {
          cwd: '/tmp/x',
          paths: [],
          networkHosts: [],
          persistence: 'once',
          amendments: [],
          availableDecisions: WITHHELD,
          underDisclosed: true,
        },
        ...marks,
      } as TranscriptEvent,
      1_700_000_000_000,
    )
    const rows = attentionQueue([record], () => 'waiting: permission')
    expect(rows, 'the projection produced no row').toHaveLength(1)
    const row = rows[0]!
    if (row.kind !== 'permission') throw new Error('not a permission row')
    return row
  }
  const order = (row: AttentionRequest) =>
    row.decisions.map((one) => (one.kind === 'permission' ? one.decision.outcome : one.kind))
  const renderHome = (row: AttentionRequest): Promise<string> =>
    renderToString(
      createSSRApp({
        render: () => h(AttentionQueue as never, { requests: [row], now: 1_700_000_060_000 }),
      }),
    )
  /** Each decision button on Home, in order, with whether it wears the dimmed-refusal class. */
  const homeButtons = (html: string) =>
    [...html.matchAll(/<button[^>]*data-cy="attention-decide-[^"]*"[^>]*>/g)].map((one) =>
      (/class="([^"]*)"/.exec(one[0])?.[1] ?? '').split(/\s+/).includes('deny'),
    )

  it('a `defaultToNo` ask leads with its refusals on Home too, undimmed, and says why', async () => {
    const row = homeRow({ defaultToNo: true })
    expect(order(row)).toEqual(['deny', 'cancel', 'allow'])
    expect(row.refusesFirst).toBe(true)
    const html = await renderHome(row)
    expect(homeButtons(html)).toEqual([false, false, false])
    expect(html).toContain('data-cy="attention-mark"')
    expect(html).toContain(DEFAULT_IS_NO)
  })

  it('a marked `echo … &` says on Home why no grant is offered', async () => {
    const html = await renderHome(homeRow({ suppressAlwaysAllowRule: true }))
    expect(html).toContain(GRANT_WITHHELD)
  })

  it('control — unmarked, Home keeps today’s order, dims its refusals and says nothing', async () => {
    const row = homeRow({})
    expect(order(row)).toEqual(['allow', 'deny', 'cancel'])
    expect('refusesFirst' in row).toBe(false)
    expect('marksSay' in row).toBe(false)
    const html = await renderHome(row)
    expect(homeButtons(html)).toEqual([false, true, true])
    expect(html).not.toContain('data-cy="attention-mark"')
  })
})

/**
 * 🔴 **697 · `672` F1 — a Codex command card: what it can grant, and what the provider merely
 * proposed.** ⛔ `main` drew *persistence session* and *"also applies to exec: curl"* on a card whose
 * only Allow is one-shot. The amendment was applied by no answer this app sent (since `736`, R95,
 * the OFFERED amendment is `allow_always`; this card offers none), and the `session` came from
 * that proposal alone. ⚑ The card draws whatever `persistence` the producer published — the
 * `once` is pinned where it is made (`codex-runtime.test.ts`' 697 block); what THIS file can hold is
 * the renderer's half: the amendment is named as a proposal, never as something the card applies.
 */
describe('697 · 672 F1 — the card says what its buttons grant, and a proposal is a proposal', () => {
  const codexCommand = (persistence: 'once' | 'session', amendments: unknown[]) =>
    ({
      item: {
        at: 1_700_000_000_000,
        outcome: null,
        note: null,
        request: {
          id: 'req_697',
          kind: 'command',
          action: 'exec_command',
          detail: 'curl https://api.example.com',
          scope: {
            cwd: '/tmp/x',
            paths: [],
            networkHosts: [],
            persistence,
            amendments,
            availableDecisions: WITHHELD,
            underDisclosed: true,
          },
        },
      },
    }) as Record<string, unknown>

  it('🔴 the proposal is drawn as proposed, never as something the card applies', async () => {
    const html = await render(codexCommand('once', [{ kind: 'exec', detail: 'curl' }]))
    expect(html).toMatch(/<dt[^>]*>proposed, not applied here<\/dt>/)
    expect(html).toContain('exec: curl')
    expect(html).not.toContain('also applies to')
    expect(html).toMatch(/<dt[^>]*>persistence<\/dt>\s*<dd[^>]*>once<\/dd>/)
  })

  it('⚑ control — no proposal, no proposal row; and the dt is really absent, not merely renamed', async () => {
    const html = await render(codexCommand('once', []))
    // ⚠️ SSR renders vacuously when a `v-if` is false (`brobot2-ssr-tests-pass-vacuously`) — the
    // positive above is what makes this negative mean the row, and not the whole card, is gone.
    expect(html).toMatch(/<dt[^>]*>persistence<\/dt>/)
    expect(html).not.toContain('proposed, not applied here')
  })
})
