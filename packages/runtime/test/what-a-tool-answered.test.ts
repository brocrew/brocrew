import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '../src/events'
import {
  UNSUMMARISED_TOOL_KIND,
  isCodexToolItem,
  normalizeNotification,
} from '../src/codex/normalize'
import { normalizeMessage } from '../src/claude/normalize'
import { TOOL_SUMMARY_MAX } from '../src/claude/normalize'

/**
 * 🔴 **457 · what a tool ANSWERED, on the provider a fresh install actually runs.**
 *
 * ## ⛔ The defect, and it reached a person
 *
 * Without a `dynamicToolCall` branch, `itemSummary` falls through to the literal type word
 * for both rows of every Codex BroBot tool call. Recovering only the tool name leaves the
 * answer unreadable; the default Codex front door must summarize the response too.
 *
 * ## ⚑ Measured off the wire before anything was built
 *
 * `packages/runtime/smoke/codex-tool-answer-probe.smoke.ts` drives the PINNED app-server with a
 * loopback Responses endpoint, no credential, and reproduces the defect in under two seconds. It
 * is the source of the three facts this file is built on:
 *
 * | fact | measured |
 * |---|---|
 * | `arguments` is present on **both** phases | so the CALL row can read it |
 * | `contentItems` is `null` on `item/started`, populated on `item/completed` | so only the RESULT row may read it |
 * | two `inputText` items reach the model as one newline-joined string | so splitting prose from payload is invisible to the model |
 *
 * ⛔ **The last one is why `agent-tools.ts` may send two items at all**, and it is pinned in
 * `codex-agent-tools.test.ts` rather than assumed here.
 */

const here = dirname(fileURLToPath(import.meta.url))

/** One `dynamicToolCall` item on the phase its `status` names. */
function dynamicRow(over: Record<string, unknown>, phase: 'started' | 'completed'): RuntimeEvent {
  const rows = normalizeNotification(`item/${phase}`, {
    item: {
      type: 'dynamicToolCall',
      id: 'exec-457',
      namespace: 'brobot',
      tool: 'list_agents',
      arguments: { note: '457' },
      status: phase === 'started' ? 'inProgress' : 'completed',
      contentItems: null,
      success: phase === 'started' ? null : true,
      durationMs: phase === 'started' ? null : 4,
      ...over,
    },
    threadId: 'th_457',
    turnId: 'tn_457',
  })
  expect(rows, 'one item, one row').toHaveLength(1)
  return rows[0] as RuntimeEvent
}

const summaryOf = (event: RuntimeEvent): string => {
  if (event.type !== 'tool_call' && event.type !== 'tool_result')
    throw new Error(`not a tool row: ${event.type}`)
  return event.summary
}

const text = (value: string): Record<string, unknown> => ({ type: 'inputText', text: value })

describe('§1 · the CALL row says what was asked, not what kind of item it is', () => {
  it('🔴 the arguments ride on the summary, exactly as they do for an MCP call', () => {
    expect(summaryOf(dynamicRow({}, 'started'))).toBe('{"note":"457"}')
  })

  it('⛔ …and the word `405` recorded is gone from BOTH rows', () => {
    // ⚠️ **The control this dispatch exists for.** `402` F2 captured
    // `tool_call name: brobot__spawn_agent summary: dynamicToolCall` off a real worker.
    for (const phase of ['started', 'completed'] as const)
      expect(summaryOf(dynamicRow({ contentItems: [text('done')] }, phase))).not.toBe(
        'dynamicToolCall',
      )
  })

  it('⚑ the NAME is still `348`’s, so this dispatch moved the summary and nothing else', () => {
    const row = dynamicRow({}, 'started')
    if (row.type !== 'tool_call') throw new Error('unreachable')
    expect(row.name).toBe('brobot__list_agents')
  })

  it('⚠️ absent arguments leave the row to its name rather than inventing a word', () => {
    // ⛔ `argumentsSummary`'s documented rule, and the reason the CALL row cannot read
    // `contentItems`: the probe measured it `null` on every `item/started`.
    expect(summaryOf(dynamicRow({ arguments: null }, 'started'))).toBe('')
  })
})

describe('§2 · the RESULT row says what came back', () => {
  const answered = (contentItems: unknown): string =>
    summaryOf(dynamicRow({ contentItems }, 'completed'))

  it('🔴 the first text item is the answer a person reads', () => {
    expect(answered([text('sess_2 · project-manager · idle')])).toBe(
      'sess_2 · project-manager · idle',
    )
  })

  it('🔴 …and the payload in the SECOND item does not reach the row', () => {
    // ⛔ **The whole of `457` §1.2.** Measured through the app's own tools on a real
    // `list_agents`: 31 characters of answer and 169 of payload, so a row built from both is
    // mostly JSON. ⚠️ That instrument is not the wire probe — the probe's fixture payload is
    // shorter — and the two are cited separately on purpose.
    const payload = JSON.stringify({ outcome: 'ok', agents: [{ agent: 'sess_2' }], count: 1 })
    const row = answered([text('sess_2 · project-manager · idle'), text(payload)])
    expect(row).toBe('sess_2 · project-manager · idle')
    expect(row).not.toContain('outcome')
  })

  it('⛔ the CONTROL: one item carrying both halves still shows both', () => {
    // ⚠️ **This is what the app used to send, and the arm the probe kept.** Without it the
    // assertion above would pass on a normalizer that simply dropped everything after a newline —
    // a parse of our own words, which is the derivation `405` refuses.
    const both = 'sess_2 · project-manager · idle\n{"outcome":"ok"}'
    expect(answered([text(both)])).toContain('outcome')
  })

  it('⚠️ a result with no content at all is `done`, which is Claude’s own word', () => {
    expect(answered(null)).toBe('done')
    expect(answered([])).toBe('done')
    // ⛔ And a provider string that is entirely whitespace is not an answer either.
    expect(answered([text('   \n  ')])).toBe('done')
  })

  it('⚑ an answer that is only a payload still says the payload', () => {
    // A tool with an empty prose half: a row saying nothing about an answer that exists is worse.
    expect(answered([text(''), text('{"outcome":"ok"}')])).toBe('{"outcome":"ok"}')
  })

  it('⛔ image and audio get a word, and never their base64 URL', () => {
    const huge = `data:image/png;base64,${'A'.repeat(5_000)}`
    expect(answered([{ type: 'inputImage', imageUrl: huge }])).toBe('an image')
    expect(answered([{ type: 'inputAudio', audioUrl: huge }])).toBe('audio')
    // 🔴 The reason: this string is written to the ledger and cloned across IPC for the session.
    expect(answered([{ type: 'inputImage', imageUrl: huge }])).not.toContain('AAAA')
  })

  it('🔴 an inherited key is not a content kind — `068` F3, in a table this dispatch added', () => {
    // ⛔ **`'toString' in NON_TEXT_ANSWER` is TRUE**, and the lookup answers
    // `Object.prototype.toString`. A first draft of this file used `in`, and a wire item declaring
    // `{type: 'toString'}` would have put `function toString() { [native code] }` on the row a
    // person reads. ⚑ Found by this dispatch's own review pass; `TOOL_ITEM_NAMES` is a Map one
    // function over for precisely this reason.
    for (const inherited of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty'])
      expect(answered([{ type: inherited, imageUrl: 'x' }]), inherited).toBe('done')
    // ⚠️ …and the paired positive, so this is not a function that always says `done`.
    expect(answered([{ type: 'inputImage', imageUrl: 'x' }])).toBe('an image')
  })

  it('🔴 a picture followed by a sentence is summarised by the SENTENCE', () => {
    // ⛔ **Found by this dispatch's own review.** A first draft returned on the first recognised
    // non-text item, so `[image, text]` showed `an image` about a row that said something. ⚑ The
    // words win wherever they are in the array; the picture is only the answer when there are no
    // words at all.
    expect(answered([{ type: 'inputImage', imageUrl: 'x' }, text('here is why')])).toBe(
      'here is why',
    )
    // ⚠️ …and the ORDER does not matter, which is the point.
    expect(answered([text('here is why'), { type: 'inputImage', imageUrl: 'x' }])).toBe(
      'here is why',
    )
    // ⛔ The control: with no words anywhere, the picture is still the answer.
    expect(answered([{ type: 'inputImage', imageUrl: 'x' }, text('  ')])).toBe('an image')
  })

  it('⚠️ a long answer is bounded, and the row SAYS how much it dropped', () => {
    const long = 'x'.repeat(5_000)
    const row = answered([text(long)])
    expect(row.length).toBeLessThan(long.length)
    expect(row).toContain('of 5000 characters')
  })

  it('⛔ a contradicted success still fails closed, and now says what came back too', () => {
    // `068`'s rule, unchanged — and the reason to re-assert it here is that the note used to be
    // joined onto the literal word `dynamicToolCall`.
    const row = dynamicRow({ contentItems: [text('it worked')], success: false }, 'completed')
    if (row.type !== 'tool_result') throw new Error('unreachable')
    expect(row.ok).toBe(false)
    expect(row.summary).toContain('it worked')
    expect(row.summary).toContain('reported success:false')
  })
})

describe('§3 · every tool kind has a summary, derived from the generated protocol', () => {
  /**
   * 🔴 **The gap this closes: nothing in this repository reads `ThreadItem.ts`.**
   *
   * ⛔ **A hand-copied roster cannot notice a new item kind**, and the compile-time `never` sink
   * in `itemCategory` cannot either — it forces a CLASSIFICATION, not a summary, so a nineteenth
   * kind classified `'tool'` would compile, render, and fall through to the very default this
   * dispatch removed. ⚑ So the roster is derived from the vendored generated file, the way the
   * suite already derives its method roster from `ServerNotification.ts`.
   */
  const generated = readFileSync(join(here, '../src/codex/protocol/v2/ThreadItem.ts'), 'utf8')

  /** ⛔ Prose out first: the generated file interleaves doc comments, and a `"type": "…"` inside
   *  one is not a variant. */
  const withoutProse = generated
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\s;{(])\/\/[^\n]*/g, (match, keep: string) => keep)

  const declared = [...withoutProse.matchAll(/"type":\s*"([A-Za-z0-9_]+)"/g)].map(
    (found) => found[1] as string,
  )

  it('⚑ the derivation found the union, and did not find it twice', () => {
    // ⚠️ **The non-vacuity floor**, the same one the `ServerNotification` derivation carries: a
    // regex that matched nothing would make every assertion below pass over no code at all.
    expect(declared.length).toBeGreaterThan(12)
    expect(new Set(declared).size, 'each discriminant declared once').toBe(declared.length)
    // ⛔ And a positive anchor, so a regex that matched the WRONG thing is caught too.
    expect(declared).toContain('dynamicToolCall')
    expect(declared).toContain('mcpToolCall')
  })

  it('🔴 every kind this file calls a TOOL has a summary that is not its own type name', () => {
    const tools = declared.filter((kind) => isCodexToolItem(kind))
    // ⛔ **The filter is a FILTER.** Without this, a broken `isCodexToolItem` that said yes to
    // everything — or to nothing — would make the loop below meaningless in either direction.
    expect(tools.length, 'the tool kinds, derived not typed').toBeGreaterThan(4)
    expect(tools.length, 'and not simply every kind').toBeLessThan(declared.length)
    expect(tools, 'the subject of this dispatch is among them').toContain('dynamicToolCall')
    expect(declared.filter((kind) => !isCodexToolItem(kind))).toContain('agentMessage')

    const summaries = new Map<string, string>()
    for (const kind of tools) {
      const rows = normalizeNotification('item/started', {
        item: { type: kind, id: `id-${kind}`, status: 'inProgress' },
        threadId: 'th',
        turnId: 'tn',
      })
      const row = rows[0]
      expect(row, kind).toBeDefined()
      if (row === undefined || (row.type !== 'tool_call' && row.type !== 'tool_result')) continue
      summaries.set(kind, row.summary)
      // ⛔ **The defect, stated as a property over the whole union.** A row whose summary is its
      // own protocol discriminator is the `405` pair, whatever kind it happens to be.
      expect(row.summary, `${kind} summarises as its own type name`).not.toBe(kind)
      // 🔴 **AND not the fall-through** — found by this dispatch's own review, which is the whole
      // reason this assertion is worth having. ⛔ `457` replaced `return type` with a sentence, so
      // a nineteenth kind classified `'tool'` in `itemCategory` and forgotten here would answer
      // `UNSUMMARISED_TOOL_KIND` — which is not its discriminant, so the line above passes, and
      // every row of that kind renders one meaningless sentence to a person. ⚠️ The `457` table
      // declines a mutation row on that line *because this property carries the rule*; without
      // this line it did not carry it.
      expect(row.summary, `${kind} has no branch in itemSummary`).not.toBe(UNSUMMARISED_TOOL_KIND)
    }
    expect(summaries.size, 'every tool kind produced a tool row').toBe(tools.length)
    // ⚠️ **Anti-vacuity, and it is not the same assertion twice.** `'' !== kind` is true, so a
    // normalizer that summarised everything as the empty string would satisfy the property above
    // while saying nothing at all. At least one kind must have answered with real content.
    expect([...summaries.values()].filter((said) => said.length > 0).length).toBeGreaterThan(2)
  })

  it('⛔ …and BOTH halves of the property are falsifiable, against the real function', () => {
    // ⚠️ **A property nothing can break is not a measurement**, and a control that compares a
    // local identity function to itself — which a draft of this test did — breaks nothing either.
    // ⛔ So the control drives the REAL normalizer with the two shapes the property forbids.
    const summaryFor = (item: Record<string, unknown>): string => {
      const rows = normalizeNotification('item/started', {
        item: { id: 'ctl', status: 'inProgress', ...item },
        threadId: 'th',
        turnId: 'tn',
      })
      const row = rows[0]
      return row !== undefined && (row.type === 'tool_call' || row.type === 'tool_result')
        ? row.summary
        : '(not a tool row)'
    }
    // ⛔ **An UNCLASSIFIED kind never reaches `itemSummary` at all** — it is wrapped whole — which
    // is why the fall-through is unreachable today and why the table declines a row on it.
    expect(summaryFor({ type: 'notAKindAtAll' })).toBe('(not a tool row)')
    // 🔴 **And a kind that IS classified but has no branch answers the fall-through.** `fileChange`
    // is the proxy: it is a real tool kind, so it proves the loop's path — and the two assertions
    // in the property above are exactly the two strings this control shows are distinguishable.
    expect(summaryFor({ type: 'fileChange' })).not.toBe(UNSUMMARISED_TOOL_KIND)
    expect(UNSUMMARISED_TOOL_KIND).not.toBe('fileChange')
    expect(UNSUMMARISED_TOOL_KIND.length).toBeGreaterThan(10)
  })
})

describe('§4 · both providers, stated separately', () => {
  /** One Claude `tool_result` carrying `said`, through the real normalizer. */
  const claudeResult = (said: string): string => {
    const rows = normalizeMessage({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_457',
            content: [{ type: 'text', text: said }],
          },
        ],
      },
    } as never)
    const result = rows.find((one) => one.type === 'tool_result')
    if (result === undefined || result.type !== 'tool_result') throw new Error('no tool_result')
    return result.summary
  }

  it('⛔ the CLAUDE arm did not move — its tool result still reads its text content', () => {
    const rows = normalizeMessage({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_457',
            content: [{ type: 'text', text: 'sess_2 · project-manager · idle' }],
          },
        ],
      },
    } as never)
    const result = rows.find((one) => one.type === 'tool_result')
    expect(result).toBeDefined()
    if (result === undefined || result.type !== 'tool_result') throw new Error('unreachable')
    expect(result.summary).toBe('sess_2 · project-manager · idle')
  })

  it('⚑ …and both providers now answer the same question with the same string', () => {
    // 🔴 **The parity this dispatch bought.** Given the same answer, the row a person reads is the
    // same on either provider — which is what `327` §2.4 calls one vocabulary for one thing.
    const said = 'sess_2 · project-manager · idle'
    const codex = summaryOf(dynamicRow({ contentItems: [text(said)] }, 'completed'))
    const claude = normalizeMessage({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_457',
            content: [{ type: 'text', text: said }],
          },
        ],
      },
    } as never).find((one) => one.type === 'tool_result')
    if (claude === undefined || claude.type !== 'tool_result') throw new Error('unreachable')
    expect(codex).toBe(claude.summary)
  })

  it('⚠️ and they agree about the BOUND, which is the only cut a person ever sees', () => {
    // ⛔ The Codex cap is a private `SUMMARY_CAP`; the Claude one is exported. `448` §2 pinned the
    // Claude side against the real constant, and this pins BOTH against it — a draft ran only the
    // Codex half and still called itself a parity test, which this dispatch's review caught.
    const long = 'y'.repeat(TOOL_SUMMARY_MAX * 3)
    const codex = summaryOf(dynamicRow({ contentItems: [text(long)] }, 'completed'))
    const claude = claudeResult(long)
    // ⚑ **Both keep exactly the bound**, and both keep the SAME prefix.
    for (const [who, said] of [
      ['codex', codex],
      ['claude', claude],
    ] as const) {
      expect(said.startsWith('y'.repeat(TOOL_SUMMARY_MAX)), who).toBe(true)
      expect(said.length, who).toBeGreaterThan(TOOL_SUMMARY_MAX)
    }
    // ⚠️ **And here they differ, deliberately.** Codex's `boundedSummary` states the remainder
    // (`187 §2`'s rule, added at `327`); Claude's `truncate` appends a bare ellipsis. ⛔ Pinned as
    // a DIFFERENCE rather than left to look like parity, because a reader of the row sees it.
    expect(codex).toContain(`${TOOL_SUMMARY_MAX} of ${long.length} characters`)
    expect(claude).not.toContain('characters')
    expect(claude.length).toBe(TOOL_SUMMARY_MAX + 1)
  })
})
