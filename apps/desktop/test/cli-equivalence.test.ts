import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeRuntime, type AgentRuntime } from '@brobot2/runtime'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { checkSessionCwd } from '../src/main/runtime/scratch-cwd'
import type {
  RuntimeEventMessage,
  SessionLiveness,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **160 · match the CLI, unless the reason is NEIGHBOURS.**
 *
 * ⛔ **This file used to be `personal-homes.test.ts` and it asserted the OPPOSITE.** 153 put the
 * user's own `~/.claude` and `~/.codex` into `protectedRoots` and 157 denied them to Codex as well.
 * The CLI-equivalent access case also covers multiple agents and unattended use:
 *
 * > *"Even when I run multiple CLIs on my machine it's still one agent?… me running `claude
 * > --dangerously-skip-permissions` and passively watching it work, vs me running the same in BroBot
 * > and passively watching — what's the difference?… If the only issue is that claude/codex might
 * > read their own credentials, isn't that also the case for CLI, where the agent has full access to
 * > the machine, including the credential file wherever it is?"*
 *
 * Three terminals is three agents; unattended `--dangerously-skip-permissions` is the same posture
 * as `auto`; a CLI agent can already read both directories. The guard made this app **stricter than
 * the client it is meant to feel like**, for nothing that is true only of BroBot.
 *
 * ## ⚠️ Why this file exists at all, rather than the old one simply being deleted
 *
 * ⛔ **A revert that only deletes tests leaves nothing standing between here and someone re-adding
 * the guard six dispatches from now with a plausible-sounding rationale.** Every positive below
 * therefore carries its reason IN THE TEST BODY. Until `726` every one was also paired with the
 * `userData` negative, because the case for keeping `userData` and the case against keeping the
 * personal homes were the same argument — see the R92 note below for what became of it.
 *
 * ⚑ **The surviving guard was `[userData]`, and its reason was NEIGHBOURS**: BroBot's one structural
 * difference from the CLI is that it CREATES credential material the CLI never would —
 * `provisionCodexAuth` copies `auth.json` into every profile home. 069 A1 was reading one of those
 * copies. The CLI has no equivalent hole because it never made the copy.
 *
 * There is no `protectedRoots` scan or app-data cwd refusal. The person’s `ask` or `auto`
 * setting is the remaining gate, and the admitted tool call asserts that gate.
 * `scratch-cwd.test.ts` covers the cwd case.
 */

class FakeQuery {
  private resolve: ((value: IteratorResult<SDKMessage>) => void) | null = null
  private readonly buffer: SDKMessage[] = []
  private done = false

  emit(message: SDKMessage): void {
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: message, done: false })
      return
    }
    this.buffer.push(message)
  }

  end(): void {
    this.done = true
    if (this.resolve) {
      const resolve = this.resolve
      this.resolve = null
      resolve({ value: undefined as never, done: true })
    }
  }

  async interrupt(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  close(): void {
    this.end()
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: (): Promise<IteratorResult<SDKMessage>> => {
        const queued = this.buffer.shift()
        if (queued) return Promise.resolve({ value: queued, done: false })
        if (this.done) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => {
          this.resolve = resolve
        })
      },
    }
  }
}

const init = (id: string, cwd: string): SDKMessage =>
  ({ type: 'system', subtype: 'init', session_id: id, cwd }) as unknown as SDKMessage

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  readonly alive = true
  constructor(readonly ownerId = 'owner:1') {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
  readonly liveness: SessionLiveness[] = []
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('BroBot behaves like the CLI (160; `726` · R92 withdrew the neighbours exception)', () => {
  describe('what a Claude session may reach (end to end, real adapter)', () => {
    let dir: string
    let db: AppDatabase
    let store: SessionStore
    let host: RuntimeHost
    let fq: FakeQuery
    let launched: Options[]

    const claudeHome = join(homedir(), '.claude')
    const codexHome = join(homedir(), '.codex')

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'brobot2-cli-equivalence-'))
      db = openDatabase(join(dir, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      store = createSessionStore(db)
      fq = new FakeQuery()
      launched = []
      let counter = 0
      const createRuntime = (): AgentRuntime =>
        new ClaudeRuntime(
          (params) => {
            launched.push(params.options)
            return fq as never
          },
          async () => true,
        )
      host = new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(dir, 'exports'),
        createRuntime,
        prepareProviderHome: (provider) => join(dir, 'provider-homes', provider),
        providerHomePath: (provider) => join(dir, 'provider-homes', provider),
        resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
        newSessionId: () => `sess_${++counter}`,
        // ⚑ `726` · R92: no `protectedRoots` — `index.ts` composes none, so neither does this.
        readProviderConfig: (provider, home) => ({
          home,
          homeEnv: 'CLAUDE_CONFIG_DIR',
          model: 'm',
          authNote: null,
          files: [],
        }),
      })
    })

    afterEach(async () => {
      fq.end()
      await host.closeAll()
      db.close()
      rmSync(dir, { recursive: true, force: true })
    })

    /**
     * Open a session in the given mode and hand back the guard the adapter installed, plus the sink
     * — so "was a card raised" can be answered from the events rather than from the decision alone.
     */
    async function guardFor(approvalMode: 'ask' | 'auto') {
      const sink = new RecordingSink()
      const created = await host.createSession({ provider: 'claude', approvalMode }, sink)
      await host.send(created.sessionId, 'do something', sink)
      fq.emit(init('sess_provider', join(dir, 'scratch', created.sessionId)))
      await waitFor(
        () => sink.events().some((event) => event.type === 'status'),
        'the turn to open',
      )
      const hook = launched[0]?.hooks?.PreToolUse?.[0]?.hooks?.[0]
      if (!hook) throw new Error('no PreToolUse guard on this launch')
      const ask = async (tool: string, input: unknown) =>
        (await (
          hook as unknown as (i: {
            hook_event_name: string
            tool_name: string
            tool_input: unknown
            tool_use_id: string
          }) => Promise<{
            continue?: boolean
            hookSpecificOutput?: {
              permissionDecision?: string
              permissionDecisionReason?: string
            }
          }>
        )({
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_input: input,
          tool_use_id: 't',
        })) as {
          continue?: boolean
          hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
        }
      // ⚑ 728 · the callback too, because since R93 that is where the mode gates.
      const canUse = launched[0]?.canUseTool
      if (!canUse) throw new Error('no canUseTool on this launch')
      return { ask, sink, canUse }
    }

    for (const mode of ['ask', 'auto'] as const) {
      it(`⚑ a Claude session can READ \`~/.claude\` and \`~/.codex\` — as the CLI can — in ${mode}`, async () => {
        // `claude` and `codex` can access the machine, including their credential files.
        // Multiple terminals and unattended `--dangerously-skip-permissions` have the same
        // access posture as agents in `auto`; BroBot adds no separate read restriction.
        //
        // ⚠️ **`not.toBe('deny')` rather than `toBe(allowed)`, deliberately.** `ask` may still raise
        // an ordinary card for them — the CLI's own — which is exactly what the CLI does. What may
        // never happen again is the hard, cardless refusal 153 installed.
        const { ask } = await guardFor(mode)
        for (const [tool, input] of [
          ['Read', { file_path: join(claudeHome, 'settings.json') }],
          ['Read', { file_path: join(claudeHome, '.credentials.json') }],
          ['Read', { file_path: join(codexHome, 'auth.json') }],
          ['Grep', { pattern: 'token', path: codexHome }],
          // `Glob`'s `path` is optional, so the whole location can hide in the pattern — and nothing
          // may refuse it there either (`726` · R92 removed the scan that used to walk it).
          ['Glob', { pattern: `${codexHome}/**/*.json` }],
        ] as const) {
          const out = await ask(tool, input)
          expect(
            out.hookSpecificOutput?.permissionDecision ?? 'allowed',
            `${tool} ${mode}`,
          ).not.toBe('deny')
        }
      })

      it(`⚑ …and can WRITE into them too — the half 153 refused hardest — in ${mode}`, async () => {
        // 153 denied a Write with no card in EVERY mode including auto. Nothing about a write to
        // `~/.claude/settings.json` is different in BroBot from the same write in a terminal, so it
        // goes back to being the ordinary permission question it was: a card in `ask`, allowed in
        // `auto`.
        const { ask } = await guardFor(mode)
        for (const path of [
          join(claudeHome, 'settings.json'),
          join(claudeHome, 'plans', 'a-plan.md'),
          join(codexHome, 'auth.json'),
        ]) {
          const out = await ask('Write', { file_path: path, content: 'x' })
          expect(out.hookSpecificOutput?.permissionDecision ?? 'allowed', path).not.toBe('deny')
        }
      })

      it(`🔴 726 · R92 — a tool call NAMING the app's own data is NOT refused, as in the CLI — in ${mode}`, async () => {
        // ⛔ On `main` this was refused with no card, in both modes (071, 160's NEIGHBOURS guard, from
        // 069 A1): the Claude `PreToolUse` scan denied any tool call naming a path under
        // `protectedRoots` — `userData`, and the pasted-images root. R92 removed the scan: BroBot adds
        // no file- or folder-access restriction of its own, and a CLI agent can already read the same
        // files. ⚠️ **This harness no longer passes `protectedRoots`** — the dep is gone — so the RED
        // on `main` is measured with `main`'s own composition, `protectedRoots: () => [dir]`, which
        // this file passed until `726` (`726`'s response, §3).
        const { ask, sink, canUse } = await guardFor(mode)
        const write = {
          file_path: join(dir, 'provider-homes', 'codex', 'stolen.json'),
          content: 'x',
        }
        for (const [tool, input] of [
          ['Read', { file_path: join(dir, 'brobot2.sqlite') }],
          ['Read', { file_path: join(dir, 'provider-homes', 'codex', 'auth.json') }],
          ['Write', write],
          ['Glob', { pattern: `${join(dir, 'provider-homes')}/**/*.json` }],
        ] as const) {
          const out = await ask(tool, input)
          expect(out.hookSpecificOutput?.permissionDecision, `${tool} ${mode}`).not.toBe('deny')
        }
        // ⚑ **The CONTROL: the person's own mode is still the gate** — R92's one gate left. ⚑ Since
        // `728` (R93) the hook has no opinion in EITHER mode — the CLI's own engine asks before a
        // `Write` (measured) — so the mode gates in the callback: a card in `ask`, allowed in `auto`,
        // which is what the CLI's `--dangerously-skip-permissions` means.
        const decided = (await ask('Write', write)).hookSpecificOutput?.permissionDecision
        expect(decided).toBeUndefined()
        const answer = canUse('Write', write, {
          signal: new AbortController().signal,
          toolUseID: `t_mode_${mode}`,
        } as never)
        if (mode === 'ask') {
          await waitFor(
            () => sink.events().some((event) => event.type === 'permission_request'),
            'the card the CLI asked for',
          )
        } else {
          await expect(answer).resolves.toEqual({ behavior: 'allow' })
          expect(sink.events().some((event) => event.type === 'permission_request')).toBe(false)
        }
      })
    }
  })

  describe('and a personal home may be chosen as a working directory again (160 §1)', () => {
    it('⚑ `~/.claude` and `~/.codex` are accepted as a cwd — the CLI runs anywhere', () => {
      // ⛔ **153's refusal was entirely DOWNSTREAM of the protection**: the confinement carved a
      // session's own cwd back out of `protectedRoots`, so choosing a protected home would have made
      // the just-protected directory the least restricted one. 160 took those homes out of
      // `protectedRoots`, so there was no carve-out left to invert — and what would remain is a bare
      // refusal to `cd` somewhere, which `claude` and `codex` do not have. (`726` · R92 then removed
      // `protectedRoots` and the app-data cwd refusal altogether.)
      // ⚑ A home of this test's own, holding the two folders: no test reads the person's.
      const person = mkdtempSync(join(tmpdir(), 'brobot2-cli-equivalence-home-'))
      vi.stubEnv('HOME', person)
      vi.stubEnv('USERPROFILE', person)
      try {
        for (const home of [join(homedir(), '.claude'), join(homedir(), '.codex')]) {
          mkdirSync(home)
          const verdict = checkSessionCwd(home)
          expect(verdict.ok, `${home}: ${verdict.ok ? '' : verdict.reason}`).toBe(true)
        }
      } finally {
        vi.unstubAllEnvs()
        rmSync(person, { recursive: true, force: true })
      }
    })
  })
})
