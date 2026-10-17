import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDatabase } from '../src/main/db/connection'
import type { SessionStore } from '../src/main/db/session-store'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  aHostOverScriptedCodex,
  waitFor,
  Window,
  type ScriptedAppServer,
} from './lib/scripted-codex-host'

/**
 * # 🔴 740 · R99 (`736` F-6) — a failed keep is said as a failed keep
 *
 * ⚑ *"A failed keep is said as a failed keep, never as the empty-answer sentence."*
 *
 * ⛔ **Measured on `main`**: Codex's *Always allow* is kept by this app before the answer goes
 * (`keepToolApproval`, `736`), and a keep that fails refuses the answer `not-usable` — the refusal
 * the host words, for every cause, as the sentence about an EMPTY answer to a question:
 * *"that answer cannot be sent: every question needs one that says something"*. A person who
 * pressed *Always allow* on a tool card would read that they had left a question blank.
 *
 * ⚑ The REAL `CodexRuntime` over an app-server scripted like one (`709`'s rig), through the host's
 * own `respondPermission`. ⚠️ **The keep fails here the way it fails for real**: this rig declares
 * no external server, so the keep has no address to key the approval by — the same `throw` inside
 * the same `try` as a file it cannot write (`codex-runtime.test.ts` plants that one).
 *
 * ⚑ **What a person sees at this refusal** (rule 8.4): the card is still live, under a sentence
 * that says *always* was not kept and nothing was sent — and every other button on it still works
 * (the control below).
 */

/** Codex's own approval of an MCP tool call, as the bundled 0.146.0 sends it (`probe:codex-mcp-tool-approval`). */
const CODEX_ASKS = {
  serverName: 'brobot740',
  mode: 'form',
  _meta: {
    codex_approval_kind: 'mcp_tool_call',
    persist: ['session', 'always'],
    tool_params: { note: 'one' },
    tool_params_display: [{ name: 'note', value: 'one', display_name: 'note' }],
  },
  message: 'Allow the brobot740 MCP server to run tool "note_it"?',
  requestedSchema: { type: 'object', properties: {} },
}

/** ⛔ The sentence `main` gave this refusal — about a question left blank. */
const THE_EMPTY_ANSWER_SENTENCE =
  'that answer cannot be sent: every question needs one that says something'

describe('740 · R99 F-6 — a failed keep is said as a failed keep', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let servers: ScriptedAppServer[]
  const window = new Window('webContents:1')

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-740-keep-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-740-keep-root-'))
    window.messages.length = 0
    ;({ host, db, store, servers } = aHostOverScriptedCodex(userData))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const aToolCard = async (): Promise<{ id: string; server: ScriptedAppServer }> => {
    const { sessionId: id } = await host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: root },
      window,
    )
    const server = servers.at(-1)
    if (server === undefined) throw new Error('no app-server was opened')
    await host.send(id, 'look something up', window)
    await waitFor(() => server.sent('turn/start').length === 1, 'the first turn')
    await new Promise((resolve) => setTimeout(resolve, 20))
    // ⚑ The tool call in flight is what tells Codex's own approval from a server's form (`723`).
    server.announce('item/started', {
      item: {
        type: 'mcpToolCall',
        id: 'call_1',
        server: 'brobot740',
        tool: 'note_it',
        status: 'inProgress',
        arguments: { note: 'one' },
        appContext: null,
        result: null,
        error: null,
        durationMs: null,
      },
    })
    server.raise(60, 'mcpServer/elicitation/request', CODEX_ASKS)
    await waitFor(() => cardsSent().length === 1, 'the card')
    return { id, server }
  }

  const decisions = (id: string): TranscriptEvent[] =>
    store
      .events(id)
      .map((entry) => entry.event)
      .filter((event) => event.type === 'user_decision')
  const cardsSent = (): Extract<TranscriptEvent, { type: 'permission_request' }>[] =>
    window.messages
      .map((message) => message.event)
      .filter(
        (event): event is Extract<TranscriptEvent, { type: 'permission_request' }> =>
          event.type === 'permission_request',
      )

  it('🔴 an *Always allow* whose keep fails is refused in words about the keep — the card stays live, nothing is recorded, nothing is sent', async () => {
    const { id, server } = await aToolCard()
    // ⚑ The premise: the card offers *Always allow* — Codex listed `always` in `persist`.
    expect(cardsSent()[0]?.scope.availableDecisions).toContain('allow_always')
    const answered = server.responses.length
    const ack = await host.respondPermission(id, 'number:60', { outcome: 'allow_always' }, window)
    expect(ack).toEqual({
      outcome: 'refused',
      reason: '“always” could not be kept, so nothing was sent — this request is still waiting',
      stillOpen: true,
    })
    // ⛔ …never the sentence about a question left blank.
    expect(JSON.stringify(ack)).not.toContain(THE_EMPTY_ANSWER_SENTENCE)
    // ⚑ Standing rule 18: nothing recorded as done, nothing told to Codex.
    expect(decisions(id)).toEqual([])
    expect(server.responses.length).toBe(answered)
  })

  it('⚑ THE CONTROL — the same card, still live, takes *Allow* and records it', async () => {
    const { id, server } = await aToolCard()
    await host.respondPermission(id, 'number:60', { outcome: 'allow_always' }, window)
    const answered = server.responses.length
    expect(await host.respondPermission(id, 'number:60', { outcome: 'allow' }, window)).toEqual({
      outcome: 'taken',
    })
    await waitFor(() => server.responses.length === answered + 1, 'the answer to reach Codex')
    expect(decisions(id)).toEqual([
      { type: 'user_decision', requestId: 'number:60', outcome: 'allow', by: { who: 'a-person' } },
    ])
  })
})
