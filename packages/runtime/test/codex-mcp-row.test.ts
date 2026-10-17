import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeNotification } from '../src/codex/normalize'
import { runtimeEventSchema, type RuntimeEvent } from '../src/index'

/**
 * ⛔ **A real `mcpToolCall` reduced to the word `mcp`** (327).
 *
 * ## ⚑ The items below are the PROVIDER's, not mine
 *
 * `327` §3 is explicit that *"a green unit test proves your normalizer, not the wire"*, so the
 * fixture these tests read is a verbatim capture: a real Codex `0.146.0` app-server, a real stdio
 * MCP server on SDK `1.29.0`, an owned deterministic loopback Responses endpoint, four calls. The
 * only edit in the file is the oversized arm's 90 047-character text, recorded by length and SHA
 * instead of by its bytes so the repository does not carry 90 KB of filler — every other field of
 * every item is exactly what came off the wire. See the response doc for the harness and its hashes.
 *
 * ⚠️ **That matters most for the two FAILURE arms**, because `327`'s own §2.2 predicted the wrong
 * field. The dispatch expected a failed call's reason on `error.message`; measured, a tool that
 * THREW reported `error: null` and put the reason in `result.content`, while only a TRANSPORT
 * failure populated `error`. A hand-written fixture would have agreed with the brief and shipped a
 * row that says nothing for the commoner of the two.
 */
const wire = JSON.parse(
  readFileSync(new URL('./fixtures/codex-mcp-wire-327.json', import.meta.url), 'utf8'),
) as {
  items: Record<string, Record<string, unknown>>
  oversized: { contentTextChars: number; contentTextSha256: string; resultJsonBytes: number }
}

/** One captured item, through the normalizer, on the phase its own `status` says it is. */
function rowsFor(name: string): RuntimeEvent[] {
  const item = wire.items[name]
  if (!item) throw new Error(`no captured item named ${name}`)
  const method = item['status'] === 'inProgress' ? 'item/started' : 'item/completed'
  return normalizeNotification(method, { item, threadId: 'th_327', turnId: 'tn_327' })
}

/** One row, or a readable failure — every arm below is a single event. */
function only(name: string): RuntimeEvent {
  const rows = rowsFor(name)
  expect(rows, `${name} should normalize to exactly one event`).toHaveLength(1)
  return rows[0] as RuntimeEvent
}

/** A synthetic `mcpToolCall` completion, for the shapes the wire has not sent. */
function completed(item: Record<string, unknown>): RuntimeEvent | undefined {
  return normalizeNotification('item/completed', {
    item: { type: 'mcpToolCall', id: 'm1', server: 's', tool: 't', status: 'completed', ...item },
    threadId: 'th',
    turnId: 'tn',
  })[0]
}

describe('the call says which server and which tool (327 §2.1)', () => {
  it('⛔ names the tool the provider actually called', () => {
    const row = only('ok_started')
    expect(row.type).toBe('tool_call')
    if (row.type !== 'tool_call') throw new Error('unreachable')
    // The provider's own qualified name — its inventory declares this tool as
    // `"mcp__brobot_316_wire__echo_probe": {name, namespace: "mcp__brobot_316_wire"}`.
    expect(row.name).toBe('mcp__brobot_327_wire__echo_probe')
    // ⚑ The paired negative: the word that used to be the whole of this row is gone from it.
    expect(row.name, 'the generic label must not survive beside the real one').not.toBe('mcp')
  })

  it('⚑ …and the arguments ride on the summary, as Claude’s row does', () => {
    const row = only('ok_started')
    if (row.type !== 'tool_call') throw new Error('unreachable')
    expect(row.summary).toContain('token')
    expect(row.summary).toContain('WIRE327_')
    // Positive AND negative about the same field: it is the arguments, not the type name it was.
    expect(row.summary, 'the item type is not a summary of anything').not.toBe('mcpToolCall')
  })

  it('⚠️ a malformed item keeps exactly the `mcp` it had — both halves, or neither', () => {
    const noServer = normalizeNotification('item/started', {
      item: {
        type: 'mcpToolCall',
        id: 'm1',
        tool: 'echo_probe',
        status: 'inProgress',
        arguments: {},
      },
      threadId: 'th',
      turnId: 'tn',
    })[0]
    expect(noServer?.type).toBe('tool_call')
    if (noServer?.type !== 'tool_call') throw new Error('unreachable')
    // `mcp__echo_probe` would read as a server CALLED echo_probe — a claim about where the call
    // went, invented out of a gap.
    expect(noServer.name).toBe('mcp')
    expect(noServer.name).not.toContain('echo_probe')

    const noTool = normalizeNotification('item/started', {
      item: { type: 'mcpToolCall', id: 'm2', server: 'srv', status: 'inProgress', arguments: {} },
      threadId: 'th',
      turnId: 'tn',
    })[0]
    if (noTool?.type !== 'tool_call') throw new Error('unreachable')
    expect(noTool.name).toBe('mcp')
    // …and the positive beside it: the arguments still arrive, so nothing is lost by the fallback.
    expect(noTool.summary).toBe('{}')
  })
})

describe('the result says what came back (327 §2.1)', () => {
  it('⛔ shows the server’s answer, not the call repeated', () => {
    const row = only('ok_completed')
    expect(row.type).toBe('tool_result')
    if (row.type !== 'tool_result') throw new Error('unreachable')
    expect(row.ok).toBe(true)
    expect(row.summary).toContain('BROBOT_327_MCP_OK')
    expect(row.summary).toContain('server_pid=')
    // The paired negative: what this row used to say.
    expect(row.summary).not.toBe('mcpToolCall')
  })

  it('⚠️ falls back to `structuredContent` when a server sends only that half', () => {
    const row = completed({ result: { content: [], structuredContent: { ok: 1 }, _meta: null } })
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.summary).toBe('{"ok":1}')
  })

  it('⚑ …and says Claude’s own word when a call really returned nothing', () => {
    const row = completed({ result: { content: [], structuredContent: null, _meta: null } })
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.summary).toBe('done')
  })
})

describe('a failed call says WHAT failed — and the two shapes are disjoint (327 §2.2)', () => {
  it('🔴 the TOOL reported the failure: `error` is null and the reason is in the result', () => {
    // ⛔ The fixture's own shape is asserted first, because it is the finding: reading
    // `error.message` alone — which is what the dispatch asked for — would say nothing here.
    const item = wire.items['tool_failed'] as Record<string, unknown>
    expect(item['status']).toBe('failed')
    expect(item['error'], 'measured: a thrown tool leaves `error` null').toBeNull()

    const row = only('tool_failed')
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.ok).toBe(false)
    expect(row.summary).toContain('BROBOT_327_MCP_BOOM')
    expect(row.summary).toContain('failed')
  })

  it('🔴 the TRANSPORT failed: `result` is null and the reason is on `error.message`', () => {
    const item = wire.items['transport_failed'] as Record<string, unknown>
    expect(item['status']).toBe('failed')
    expect(item['result'], 'measured: a timed-out call carries no result at all').toBeNull()

    const row = only('transport_failed')
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.ok).toBe(false)
    expect(row.summary).toContain('timed out awaiting tools/call')
    // ⚠️ One line, because `.tool-summary` is `white-space: nowrap` and the provider's message is
    // deliberately multi-line — `\n\nCaused by:\n    ` would push the sentence towards the clip.
    expect(row.summary).not.toContain('\n')
    expect(row.summary, 'no word is lost by collapsing').toContain('Caused by:')
  })

  it('⛔ a bare-string `error` is still a reason, not a silent success (068’s hazard)', () => {
    const row = completed({ status: 'completed', error: 'boom from a non-conformant server' })
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.ok).toBe(false)
    expect(row.summary).toContain('boom from a non-conformant server')
    expect(row.summary, 'the reason must not fall through to the empty word').not.toBe('done')
  })

  it('⚠️ `isError` is not on this wire at all — the app-server re-encodes it as a status', () => {
    // The MCP SDK sets `isError` on a tool result; `McpToolCallResult` is `{content,
    // structuredContent, _meta}` and has no such field. Zero occurrences across both captures.
    expect(JSON.stringify(wire.items)).not.toContain('isError')
    // The positive beside it: the failure is legible anyway, through the field that IS sent.
    expect((wire.items['tool_failed'] as Record<string, unknown>)['status']).toBe('failed')
  })
})

describe('how long it took, as the provider measured it (327 §2.1)', () => {
  it('⚑ carries the provider’s own duration', () => {
    const row = only('ok_completed')
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.durationMs).toBe(3)
  })

  it('⛔ a measured `0` survives — the trap a truthiness test would have sprung', () => {
    // The failing arm really did report `durationMs: 0`. `...(ms ? {ms} : {})` drops exactly this.
    expect((wire.items['tool_failed'] as Record<string, unknown>)['durationMs']).toBe(0)
    const row = only('tool_failed')
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.durationMs).toBe(0)
    expect(row.durationMs, 'present, not absent').not.toBeUndefined()
  })

  it('⚠️ a nonsense duration costs its own field, never the whole event', () => {
    const negative = completed({
      durationMs: -1,
      result: { content: [], structuredContent: null, _meta: null },
    })
    if (negative?.type !== 'tool_result') throw new Error('unreachable')
    expect(negative.durationMs).toBeUndefined()
    // The positive: the rest of the row is unharmed and still validates.
    expect(runtimeEventSchema.safeParse(negative).success).toBe(true)

    const notANumber = completed({
      durationMs: '4',
      result: { content: [], structuredContent: null, _meta: null },
    })
    if (notANumber?.type !== 'tool_result') throw new Error('unreachable')
    expect(notANumber.durationMs).toBeUndefined()
  })

  it('⛔ started rows carry none — there is no duration for work that has not finished', () => {
    const row = only('ok_started')
    expect(row.type).toBe('tool_call')
    expect(JSON.stringify(row)).not.toContain('durationMs')
  })
})

describe('the bound, and what the row says when it bites (327 §2.3)', () => {
  const text = (chars: number): RuntimeEvent | undefined =>
    completed({
      result: {
        content: [{ type: 'text', text: 'x'.repeat(chars) }],
        structuredContent: null,
        _meta: null,
      },
    })

  it('⚑ says nothing extra while it fits', () => {
    const row = text(200)
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.summary).toBe('x'.repeat(200))
    expect(row.summary).not.toContain('characters')
  })

  it('⛔ states the remainder the moment it bites — one character over', () => {
    const row = text(201)
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.summary).toBe(`${'x'.repeat(200)}… (200 of 201 characters)`)
  })

  it('🔴 …and a real 90 047-character result is not mistaken for a 201-character one', () => {
    // ⚠️ The measured payload: one text block, `contentTextChars` long, which the app-server passed
    // through whole. The captured item records it by SHA rather than by its bytes; the arithmetic
    // is exercised here at that exact length.
    expect(wire.oversized.contentTextChars).toBe(90047)
    expect(wire.oversized.resultJsonBytes).toBeGreaterThan(64 * 1024)
    const row = text(wire.oversized.contentTextChars)
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.summary).toContain('(200 of 90047 characters)')
    // ⛔ Bounded, not merely labelled: the row is a summary line, not ninety kilobytes.
    expect(row.summary.length).toBeLessThan(300)
    // ⚠️ …and NOT `316`'s other shape — a payload replaced wholesale by an erasure marker. What the
    // server said is still the beginning of the row.
    expect(row.summary.startsWith('x'.repeat(200))).toBe(true)
    expect(row.summary).not.toContain('brobot2Discarded')
  })

  it('⚠️ the arguments are bounded by the same rule, not a second one', () => {
    const row = normalizeNotification('item/started', {
      item: {
        type: 'mcpToolCall',
        id: 'm1',
        server: 's',
        tool: 't',
        status: 'inProgress',
        arguments: { blob: 'y'.repeat(500) },
      },
      threadId: 'th',
      turnId: 'tn',
    })[0]
    if (row?.type !== 'tool_call') throw new Error('unreachable')
    expect(row.summary).toContain('(200 of')
    expect(row.summary).toContain('characters)')
    expect(row.summary.length).toBeLessThan(300)
  })

  it('⚑ a call with no arguments shows the name alone, and its result has no dangling dash', () => {
    const call = normalizeNotification('item/started', {
      item: { type: 'mcpToolCall', id: 'm1', server: 's', tool: 't', status: 'inProgress' },
      threadId: 'th',
      turnId: 'tn',
    })[0]
    if (call?.type !== 'tool_call') throw new Error('unreachable')
    expect(call.summary).toBe('')
    // The positive beside the empty: the row still says which tool it was.
    expect(call.name).toBe('mcp__s__t')

    const failed = completed({ status: 'failed', result: null })
    if (failed?.type !== 'tool_result') throw new Error('unreachable')
    expect(failed.summary).toBe('done — failed')
    expect(failed.summary.startsWith(' —')).toBe(false)
  })
})

describe('what 327 deliberately did NOT carry (327 §2.5)', () => {
  it('⛔ `appContext` and `pluginId` were null on every captured item, and no row carries them', () => {
    // ⚠️ `absence-in-a-capture-is-not-absence`: five calls is five calls, and this is a RULING that
    // they are not worth a field yet — not a finding that the provider never populates them. The
    // trigger for revisiting it is a capture that populates one, which this pins so the change
    // would have to be deliberate.
    for (const [name, item] of Object.entries(wire.items)) {
      expect(item['appContext'], `${name} appContext`).toBeNull()
      expect(item['pluginId'], `${name} pluginId`).toBeNull()
    }
    const rows = [...rowsFor('ok_started'), ...rowsFor('ok_completed')]
    expect(JSON.stringify(rows)).not.toContain('appContext')
    expect(JSON.stringify(rows)).not.toContain('pluginId')
    // The positive: the three facts that WERE carried are all on those two rows.
    expect(JSON.stringify(rows)).toContain('brobot_327_wire')
    expect(JSON.stringify(rows)).toContain('echo_probe')
    expect(JSON.stringify(rows)).toContain('durationMs')
  })

  it('⚠️ a populated `appContext` changes nothing about the row it rides on', () => {
    const row = completed({
      appContext: {
        connectorId: 'c1',
        linkId: null,
        resourceUri: null,
        appName: 'Some App',
        actionName: 'do',
      },
      pluginId: 'p1',
      result: {
        content: [{ type: 'text', text: 'answered' }],
        structuredContent: null,
        _meta: null,
      },
    })
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    // Dropped, deliberately — the row is not silently reshaped by a field nobody has measured.
    expect(row.summary).toBe('answered')
    expect(runtimeEventSchema.safeParse(row).success).toBe(true)
  })
})

describe('the other half is untouched — the control (327 §3)', () => {
  it('⛔ a `commandExecution` result still repeats its command and carries no duration', () => {
    const row = normalizeNotification('item/completed', {
      item: {
        type: 'commandExecution',
        id: 'c1',
        command: 'ls -la',
        status: 'completed',
        aggregatedOutput: 'total 0',
        exitCode: 0,
        durationMs: 42,
      },
      threadId: 'th',
      turnId: 'tn',
    })[0]
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.summary).toBe('ls -la')
    // ⚠️ `commandExecution` DOES declare a `durationMs` and it is deliberately not read: doing so
    // would change the duration shown on every shell row in the app, which this dispatch was not
    // asked for. Named in the response doc as a follow-on.
    expect(row.durationMs).toBeUndefined()
  })

  it('⚑ every row this dispatch produces is a valid RuntimeEvent', () => {
    for (const name of Object.keys(wire.items)) {
      for (const row of rowsFor(name)) {
        const parsed = runtimeEventSchema.safeParse(row)
        expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
      }
    }
  })
})

describe('the name stopped being a constant, so it is bounded too (327, from its own review)', () => {
  it('⛔ a third-party server cannot put an unbounded string on the row', () => {
    const row = normalizeNotification('item/started', {
      item: {
        type: 'mcpToolCall',
        id: 'm1',
        server: 's'.repeat(5_000),
        tool: 'echo',
        status: 'inProgress',
        arguments: {},
      },
      threadId: 'th',
      turnId: 'tn',
    })[0]
    if (row?.type !== 'tool_call') throw new Error('unreachable')
    // ⚠️ `toolCallSchema.name` has no `.max()` and this event is cloned across IPC and written to
    // the ledger twice. Before 327 the name was a literal from a Map and could not grow.
    expect(row.name.length).toBeLessThanOrEqual(201)
    // The positive beside it: it is still recognisably the qualified name, not a fallback.
    expect(row.name.startsWith('mcp__ssss')).toBe(true)
    expect(runtimeEventSchema.safeParse(row).success).toBe(true)
  })

  it('⚑ …and an ordinary name is untouched by the bound', () => {
    const row = only('ok_started')
    if (row.type !== 'tool_call') throw new Error('unreachable')
    expect(row.name).toBe('mcp__brobot_327_wire__echo_probe')
    expect(row.name).not.toContain('…')
  })
})

describe('the three shapes M22/M23/M27 survived on — each a reachable defect (327)', () => {
  it('⛔ M22 · a WHITESPACE-ONLY result leaves no dangling em dash before the reason', () => {
    // ⚠️ The gap this closes was mine: the first test drove `result: null`, which falls back to the
    // word `done` and can never be empty — so the guard was never on the path the code walks. The
    // reachable empty is a provider string of pure whitespace: `mcpResultText` returns it, the
    // truthiness test admits it, and `oneLine` trims it away.
    const row = completed({
      status: 'failed',
      result: {
        content: [{ type: 'text', text: '   \n\t  ' }],
        structuredContent: null,
        _meta: null,
      },
    })
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.summary).toBe('failed')
    expect(row.summary.startsWith(' —')).toBe(false)
    // The positive beside it: the row still reports the outcome it was built to report.
    expect(row.ok).toBe(false)
  })

  it('⛔ M23 · an explicit `arguments: null` is not narrated as the word `null`', () => {
    const row = normalizeNotification('item/started', {
      item: {
        type: 'mcpToolCall',
        id: 'm1',
        server: 's',
        tool: 't',
        status: 'inProgress',
        arguments: null,
      },
      threadId: 'th',
      turnId: 'tn',
    })[0]
    if (row?.type !== 'tool_call') throw new Error('unreachable')
    // `JSON.stringify(null)` is the string `"null"` — a row claiming the model sent something it did
    // not. Absent and null are the same fact here: nothing was passed.
    expect(row.summary).toBe('')
    expect(row.summary).not.toBe('null')
    // …and the positive: the row still names the tool.
    expect(row.name).toBe('mcp__s__t')
  })

  it('⛔ M27 · `structuredContent` is bounded too — all three escape routes, not two', () => {
    const row = completed({
      result: { content: [], structuredContent: { blob: 'z'.repeat(5_000) }, _meta: null },
    })
    if (row?.type !== 'tool_result') throw new Error('unreachable')
    expect(row.summary).toContain('(200 of ')
    expect(row.summary).toContain(' characters)')
    expect(row.summary.length).toBeLessThan(300)
    // The positive: what the server sent is still the beginning of the row, not an erasure marker.
    expect(row.summary.startsWith('{"blob":"zzz')).toBe(true)
  })
})
