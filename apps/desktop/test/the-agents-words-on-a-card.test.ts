import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RuntimeEvent } from '@brobot2/runtime'
import { THE_AGENT_ASKS_FOR_ACCESS } from '../../../packages/runtime/src/codex/codex-runtime'
import type { AppDatabase } from '../src/main/db/connection'
import type { SessionStore } from '../src/main/db/session-store'
import { toWireEvent } from '../src/main/runtime/event-wire'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import {
  aHostOverScriptedCodex,
  waitFor,
  Window,
  type ScriptedAppServer,
} from './lib/scripted-codex-host'

/**
 * # 🔴 709 · R44 — words the model wrote are the agent's, carried under the agent's name
 *
 * ⚑ **The ruling, verbatim** (`704` H-4, H-5): *"Text a MODEL wrote that reaches a card (…) is
 * carried in a field named for its author and drawn as that agent's words, by the agent's name. ⛔
 * Never unlabelled, never under the provider's name, never as the disclosure of what Allow runs
 * (`181`). The drawing is the frontend's; carrying it by its author is yours."*
 *
 * ⚑ **Measured** (`probe:codex-approval-reason`, bundled Codex 0.146.0): a command escalated with a
 * `justification` arrives with `reason` equal to it, verbatim; a permissions request's `reason` is
 * the model's too (with Codex's `request_permissions_tool` feature on — BroBot's shipped profile does
 * not offer the model that tool). So both cards carry `agentReason`, and nothing else on them carries
 * the model's words.
 *
 * | § | what | the carrier |
 * |---|---|---|
 * | 1 | main's wire | `toWireEvent` keeps both fields — it strips everything the schema does not name |
 * | 2 | a command card, end to end | `permission_request.agentReason`, in the window and in the ledger |
 * | 3 | a permissions card, end to end | `permission.agentReason`, and the headline is this app's sentence |
 *
 * ⚠️ **What is NOT here, by ruling: the drawing.** How a card draws `agentReason`, by the agent's
 * name, is the frontend's (`709` §4) — ⚑ drawn since `725` (R44):
 * `the-agents-words-and-the-providers-rule.render.test.ts` and its DOM file.
 */

const THE_MODELS_WORDS = 'Do you want me to clean the build folder?'

describe('709 · R44 §1 — main’s wire carries the agent’s words', () => {
  it('🔴 `toWireEvent` keeps a command card’s `agentReason`', () => {
    const wired = toWireEvent('codex', {
      type: 'permission_request',
      id: 'number:1',
      kind: 'command',
      action: 'rm -rf build',
      detail: 'rm -rf build',
      scope: {
        cwd: '/tmp/x',
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'deny', 'cancel'],
        underDisclosed: true,
      },
      agentReason: THE_MODELS_WORDS,
    } as RuntimeEvent)
    expect(wired).toMatchObject({ type: 'permission_request', agentReason: THE_MODELS_WORDS })
  })

  it('🔴 …and a permissions card’s `permission.agentReason`', () => {
    const wired = toWireEvent('codex', {
      type: 'user_input_request',
      id: 'number:2',
      prompt: THE_AGENT_ASKS_FOR_ACCESS,
      questions: [],
      permission: { cwd: '/tmp/x', agentReason: THE_MODELS_WORDS, paths: [], network: true },
    } as RuntimeEvent)
    expect(wired).toMatchObject({ permission: { agentReason: THE_MODELS_WORDS } })
  })

  it('⚑ THE CONTROL — a field the schema does not name is stripped on the same path', () => {
    const wired = toWireEvent('codex', {
      type: 'user_input_request',
      id: 'number:3',
      prompt: THE_AGENT_ASKS_FOR_ACCESS,
      questions: [],
      permission: { cwd: '/tmp/x', paths: [], network: true, notInTheSchema: THE_MODELS_WORDS },
    } as unknown as RuntimeEvent)
    expect(JSON.stringify(wired)).not.toContain(THE_MODELS_WORDS)
  })
})

describe('709 · R44 §2-§3 — the real adapter, the real host, the window and the ledger', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let servers: ScriptedAppServer[]
  let window: Window

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-709-agents-words-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-709-agents-words-root-'))
    ;({ host, db, store, servers } = aHostOverScriptedCodex(userData))
    window = new Window('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** A Codex conversation with a turn running, ready for its app-server to raise a request. */
  const aTurnRunning = async (): Promise<{ id: string; server: ScriptedAppServer }> => {
    const { sessionId: id } = await host.createSession(
      { provider: 'codex', approvalMode: 'ask', cwd: root },
      window,
    )
    const server = servers.at(-1)
    if (server === undefined) throw new Error('no app-server was opened')
    await host.send(id, 'clean up', window)
    await waitFor(() => server.sent('turn/start').length === 1, 'the turn')
    await new Promise((resolve) => setTimeout(resolve, 20))
    return { id, server }
  }

  /** The events the window received, of one type. */
  const received = <T extends RuntimeEvent['type']>(
    type: T,
  ): Extract<RuntimeEvent, { type: T }>[] =>
    window.messages.flatMap((message) =>
      'event' in message && (message.event as RuntimeEvent).type === type
        ? [message.event as Extract<RuntimeEvent, { type: T }>]
        : [],
    )

  it('🔴 §2 · a command card carries the model’s justification as `agentReason` — in the window AND the ledger, and nowhere else on it', async () => {
    const { id, server } = await aTurnRunning()
    // ⚑ The measured shape of a command the MODEL escalated: the rule Codex offers to remember.
    server.raise(71, 'item/commandExecution/requestApproval', {
      itemId: 'it_71',
      command: 'rm -rf build',
      cwd: root,
      proposedExecpolicyAmendment: ['rm', '-rf', 'build'],
      reason: THE_MODELS_WORDS,
    })
    await waitFor(() => received('permission_request').length === 1, 'the card')
    const [card] = received('permission_request')
    expect(card?.detail).toBe('rm -rf build')
    expect(card?.agentReason).toBe(THE_MODELS_WORDS)
    expect(JSON.stringify({ ...card, agentReason: undefined })).not.toContain(THE_MODELS_WORDS)
    // ⚑ **And it is what the LEDGER holds** — the row a reopen and a Sessions page read.
    const stored = store
      .events(id)
      .map((entry) => entry.event)
      .find((event) => event.type === 'permission_request')
    expect(stored).toMatchObject({ agentReason: THE_MODELS_WORDS, detail: 'rm -rf build' })
  })

  it('🔴 720 · R73 — a command a POLICY rule stopped carries Codex’s words as `providerReason`, labelled `a-policy-rule` — in the window AND the ledger', async () => {
    const { id, server } = await aTurnRunning()
    // ⚑ The measured policy shape (`probe:codex-approval-reason`, the `policy` arm): no offered rule,
    // and Codex's own sentence naming this command and the rule's text.
    const command = "/bin/zsh -lc '/usr/bin/touch a.txt'"
    const said = `\`${command}\` requires approval: POLICY-JUSTIFICATION-720`
    server.raise(74, 'item/commandExecution/requestApproval', {
      itemId: 'it_74',
      command,
      cwd: root,
      availableDecisions: ['accept', 'cancel'],
      reason: said,
    })
    await waitFor(() => received('permission_request').length === 1, 'the card')
    const [card] = received('permission_request')
    expect(card).toMatchObject({ providerReason: said, providerReasonFrom: 'a-policy-rule' })
    expect('agentReason' in (card ?? {})).toBe(false)
    const stored = store
      .events(id)
      .map((entry) => entry.event)
      .find((event) => event.type === 'permission_request')
    expect(stored).toMatchObject({ providerReason: said, providerReasonFrom: 'a-policy-rule' })
  })

  it('⚑ §2 CONTROL · a command escalated WITHOUT a justification carries no `agentReason` key', async () => {
    const { server } = await aTurnRunning()
    server.raise(72, 'item/commandExecution/requestApproval', {
      itemId: 'it_72',
      command: 'rm -rf build',
      cwd: root,
      proposedExecpolicyAmendment: ['rm', '-rf', 'build'],
    })
    await waitFor(() => received('permission_request').length === 1, 'the card')
    expect('agentReason' in (received('permission_request')[0] ?? {})).toBe(false)
  })

  it('🔴 §3 · a permissions card carries the model’s reason as `permission.agentReason`, under THIS app’s headline', async () => {
    const { id, server } = await aTurnRunning()
    server.raise(73, 'item/permissions/requestApproval', {
      itemId: 'it_73',
      environmentId: 'local',
      startedAtMs: 0,
      cwd: root,
      reason: THE_MODELS_WORDS,
      permissions: {
        network: { enabled: true },
        fileSystem: { read: null, write: [join(root, 'out')] },
      },
    })
    await waitFor(() => received('user_input_request').length === 1, 'the card')
    const [card] = received('user_input_request')
    expect(card?.permission?.agentReason).toBe(THE_MODELS_WORDS)
    // ⛔ **Not the headline** — it was: `prompt = reason || …`, the agent's sentence unlabelled.
    expect(card?.prompt).toBe(THE_AGENT_ASKS_FOR_ACCESS)
    // ⛔ **And not a scope line** — `paths` are what a grant authorizes.
    expect(card?.permission?.paths).toEqual([`write ${join(root, 'out')}`])
    const withoutTheAgents = {
      ...card,
      permission: { ...card?.permission, agentReason: undefined },
    }
    expect(JSON.stringify(withoutTheAgents)).not.toContain(THE_MODELS_WORDS)
    const stored = store
      .events(id)
      .map((entry) => entry.event)
      .find((event) => event.type === 'user_input_request')
    expect(stored).toMatchObject({
      prompt: THE_AGENT_ASKS_FOR_ACCESS,
      permission: { agentReason: THE_MODELS_WORDS },
    })
  })
})
