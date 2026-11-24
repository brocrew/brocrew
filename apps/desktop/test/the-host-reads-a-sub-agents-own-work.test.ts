import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { SessionRef } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import {
  NULL_SESSION_STORE,
  type ResumableSession,
  type SessionStore,
} from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { childWorkRoot } from '../src/main/providers/claude/child-work'

/**
 * 112 · The door to a sub-agent's own work, at the HOST level — the allowlist, the provider
 * refusal, and the promise that a read writes nothing.
 *
 * ⚠️ **`child-work.test.ts` drives the resolver, which is handed a root and trusts it.** Everything
 * that decides WHICH root, and whether the caller may ask at all, lives here — and review found the
 * gap: nothing exercised this method, so a `prepareProviderHome` that provisions directories and
 * throws on an unhealthy Keychain sat on a read path with no test to notice.
 */
describe('RuntimeHost.readChildWork (112)', () => {
  const SESSION = 'sess_child'
  const AGENT = 'a4d82f4376e9dd5c5'
  /**
   * 115 · The plain `Task` child that really is on disk here, and it is deliberately NOT `AGENT`.
   *
   * ⚠️ Every 112 test above asserts `gone` for `AGENT`, which is the honest answer for a home with
   * no file in it. Writing this fixture under that id would have turned four standing negatives
   * green for a new reason — the failure mode `083` and `095` are both about.
   */
  const PLAIN = 'ab1bcb4820e3a1c8f'

  /**
   * A real Codex rollout on disk. The three synthetic records match shapes `importCodexRollout`
   * reads, verified against app-created child rollouts. Their prose is authored for the test and
   * contains no personal session content.
   */
  let codexHome: string
  let claudeHome: string
  let rolloutPath: string

  beforeEach(() => {
    // A REAL Claude home with one plain `Task` child in it, sidecar and all — the layout measured
    // on this machine, and the only way the sidecar's contribution can be asserted end to end.
    claudeHome = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-115-claude-')))
    const subagents = join(
      childWorkRoot(claudeHome, {
        provider: 'claude',
        sessionId: 'parent-uuid',
        cwd: '/tmp/w',
      } as SessionRef),
      'subagents',
    )
    mkdirSync(subagents, { recursive: true })
    writeFileSync(
      join(subagents, `agent-${PLAIN}.jsonl`),
      `${JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        timestamp: '2026-08-10T20:43:30.000Z',
        message: {
          role: 'assistant',
          content: [
            // ⚑ **A thinking block with an EMPTY body and a signature** — measured, this is the
            // only shape these files ever contain, and `importClaudeTranscript` drops it. It is
            // here so the count the door reports has something real to count (109).
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'text', text: 'six files, no source' },
          ],
        },
      })}\n`,
    )
    // ⚠️ **A plain Task child's sidecar, which carries what a workflow agent's does NOT** — the
    // asymmetry 115 asked to be used rather than assumed away.
    writeFileSync(
      join(subagents, `agent-${PLAIN}.meta.json`),
      JSON.stringify({
        agentType: 'Explore',
        description: 'Summarize workspace contents',
        toolUseId: 'toolu_01JDtFLW68vsGED3z4L5eYUW',
        spawnDepth: 1,
      }),
    )
    codexHome = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-115-codex-')))
    const dir = join(codexHome, 'sessions', '2026', '08', '07')
    mkdirSync(dir, { recursive: true })
    rolloutPath = join(dir, 'rollout-2026-08-07T14-17-40-019fdc5f.jsonl')
    writeFileSync(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: '2026-08-07T13:17:40.441Z',
          type: 'session_meta',
          payload: { id: '019fdc5f', cwd: '/w', source: { subagent: { thread_spawn: {} } } },
        }),
        JSON.stringify({
          timestamp: '2026-08-07T13:17:41.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Map the workspace and report back.' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-08-07T13:17:44.000Z',
          type: 'response_item',
          payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Look first.' }] },
        }),
        JSON.stringify({
          timestamp: '2026-08-07T13:17:49.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'This is a rollout, not a JSONL transcript.' }],
          },
        }),
        '',
      ].join('\n'),
    )
  })

  afterEach(() => {
    rmSync(codexHome, { recursive: true, force: true })
    rmSync(claudeHome, { recursive: true, force: true })
  })

  function hostFor(
    store: Partial<SessionStore>,
    seams: {
      onPrepare?: () => void
      onPath?: () => void
      rollout?: (provider: Provider, home: string, ref: SessionRef) => string | null
    } = {},
  ): RuntimeHost {
    return new RuntimeHost({
      store: { ...NULL_SESSION_STORE, ...store },
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: (provider, home, ref) => seams.rollout?.(provider, home, ref) ?? null,
      exportDirectory: () => '/tmp/brobot2-112-exports',
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => {
        // ⛔ The launch call. Reaching it from a READ is the defect, so the double screams rather
        // than quietly returning a path — this is exactly how the real one behaves on a machine
        // whose Claude login has gone stale (`AuthUnavailableError`), and it provisions besides.
        seams.onPrepare?.()
        throw new Error(`prepareProviderHome must not be called by a read (${provider})`)
      },
      providerHomePath: (provider, profileId) => {
        seams.onPath?.()
        // ⚠️ **Both homes are REAL directories**, because every read below must land on a real
        // file: a home that does not exist answers `gone`, and every assertion below would pass for
        // the wrong reason. (`726` · R92: there is no containment check behind it any more.)
        // `profileId` is unused now and kept in the signature because it is the seam's real shape.
        void profileId
        return provider === 'codex' ? codexHome : claudeHome
      },
      resolveCwd: (sessionId) => `/tmp/brobot2-112-cwd/${sessionId}`,
      newSessionId: () => SESSION,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'x',
        authNote: null,
        files: [],
      }),
    })
  }

  const claudeRow = (over: Partial<ResumableSession> = {}): ResumableSession =>
    ({
      sessionId: SESSION,
      provider: 'claude',
      ref: { provider: 'claude', sessionId: 'parent-uuid', cwd: '/tmp/w', rotation: 0 },
      cwd: '/tmp/w',
      status: 'idle',
      approvalMode: 'ask',
      profileId: 'default',
      reasoningEffort: null,
      model: null,
      planMode: null,
      planEndedAt: null,
      adoptedAt: null,
      hasTranscript: true,
      createdAt: 1,
      updatedAt: 2,
      ...over,
    }) as ResumableSession

  /** The same row, for the provider whose children are threads with rollouts of their own (115). */
  const codexRow = (over: Partial<ResumableSession> = {}): ResumableSession =>
    claudeRow({
      provider: 'codex',
      ref: { provider: 'codex', sessionId: 'parent-thread', cwd: '/tmp/w', rotation: 0 },
      ...over,
    })

  it('⛔ an agent this session never reported is refused, and no directory is looked at', () => {
    let asked = 0
    const host = hostFor(
      { find: () => claudeRow(), workflowAgentTask: () => null },
      { onPath: () => (asked += 1) },
    )
    expect(
      host.readChildWork(SESSION, { part: 'transcript', agentId: 'a0000000000000000' }),
    ).toEqual({ ok: false, reason: 'unknown-agent', rowsUnread: 0 })
    // …and the paired positive: an agent the ledger DOES know gets as far as the filesystem.
    const known = hostFor({ find: () => claudeRow(), workflowAgentTask: () => 'waw6gpzzj' })
    expect(known.readChildWork(SESSION, { part: 'transcript', agentId: AGENT })).toEqual({
      ok: false,
      reason: 'gone',
      rowsUnread: 0,
    })
    expect(asked, 'a home was resolved for an agent that is not ours').toBe(0)
  })

  it('⛔ a READ never calls the provisioning path — it would write, and it can throw', () => {
    // 112 review, HIGH. `prepareProviderHome` mkdirs the home and, for Claude, probes the machine
    // Keychain and throws `AuthUnavailableError` when the login is unhealthy. Opening a finished
    // child's transcript must do neither. The double above throws if it is reached at all.
    let paths = 0
    const host = hostFor(
      { find: () => claudeRow(), workflowAgentTask: () => 'waw6gpzzj' },
      { onPath: () => (paths += 1) },
    )
    expect(() => host.readChildWork(SESSION, { part: 'transcript', agentId: AGENT })).not.toThrow()
    expect(paths, 'the pure path seam was not the one used').toBe(1)
  })

  /**
   * 115 · **The other children** — the half `112` named in its own §9 and did not build.
   *
   * A transcript reader, parser, and file do not make a child card openable if the host
   * allowlist contains only `workflow_run` members. Ordinary Task and Codex children are not
   * workflow roster entries and still need access.
   */
  describe('the children that are in no run (115)', () => {
    const THREAD = '019fdc5f-4aa4-7af0-9ce0-00a9f1541da1'

    it('a plain Task child the ledger announced opens, and belongs to no run', () => {
      // ⛔ **`workflowAgentTask` says null and that is correct** — this child is in no workflow. The
      // door opens on the `sub_agent` event instead, which is the whole of 115's first half.
      const host = hostFor({
        find: () => claudeRow(),
        workflowAgentTask: () => null,
        reportedSubAgent: () => true,
      })
      const read = host.readChildWork(SESSION, { part: 'transcript', agentId: PLAIN })
      expect(read.ok, `refused: ${read.ok ? '' : read.reason}`).toBe(true)
      if (!read.ok) return
      expect(read.name).toBe(`agent-${PLAIN}.jsonl`)
      // ⛔ In no run and under no task, and neither is invented to fill the shape.
      expect(read.runId).toBeNull()
      expect(read.taskId).toBeNull()
      expect(read.entries?.map((event) => event.type)).toEqual(['assistant_message'])
      // ⚑ **What only the sidecar knew** (115): a plain Task child's `.meta.json` carries a
      // description and the tool-use that dispatched it, and a workflow agent's carries neither.
      expect(read.title).toBe('Summarize workspace contents')
      expect(read.parentToolCallId).toBe('toolu_01JDtFLW68vsGED3z4L5eYUW')
      // ⚑ **The POSITIVE half of 109's asymmetry, and review found it missing entirely.** The
      // Codex case below asserts `thinkingBlocks` is undefined; without this, deleting the count
      // from the Claude branch would have left both sides green and the whole distinction empty.
      // The file holds one thinking block, the importer dropped it (see `entries` above), and the
      // count is the only reason the viewer can say it was there.
      expect(read.thinkingBlocks).toBe(1)
    })

    it('⚠️ a workflow child gets no invented description — the sidecars are NOT the same shape', () => {
      // The paired negative for the two fields above, and the reason they are optional at all.
      // Measured: a workflow agent's sidecar is `{"agentType":"workflow-subagent","spawnDepth":1}`.
      const runDir = join(
        childWorkRoot(claudeHome, {
          provider: 'claude',
          sessionId: 'parent-uuid',
          cwd: '/tmp/w',
        } as SessionRef),
        'subagents',
        'workflows',
        'wf_7658bea5-b25',
      )
      mkdirSync(runDir, { recursive: true })
      writeFileSync(
        join(runDir, `agent-${AGENT}.jsonl`),
        `${JSON.stringify({ type: 'summary' })}\n`,
      )
      writeFileSync(
        join(runDir, `agent-${AGENT}.meta.json`),
        JSON.stringify({ agentType: 'workflow-subagent', spawnDepth: 1 }),
      )
      const host = hostFor({ find: () => claudeRow(), workflowAgentTask: () => 'waw6gpzzj' })
      const read = host.readChildWork(SESSION, { part: 'transcript', agentId: AGENT })
      expect(read.ok, `refused: ${read.ok ? '' : read.reason}`).toBe(true)
      if (!read.ok) return
      expect(read.title).toBeUndefined()
      expect(read.parentToolCallId).toBeUndefined()
      // …and the paired positive, so the two absences are not about a read that failed: this child
      // IS in a run, and says which.
      expect(read.runId).toBe('wf_7658bea5-b25')
      expect(read.taskId).toBe('waw6gpzzj')
    })

    it('a Codex child opens its own rollout, parsed as a rollout', () => {
      const asked: { provider: Provider; home: string; ref: SessionRef }[] = []
      const host = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        {
          rollout: (provider, home, ref) => {
            asked.push({ provider, home, ref })
            return rolloutPath
          },
        },
      )
      const read = host.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })
      expect(read.ok, `refused: ${read.ok ? '' : read.reason}`).toBe(true)
      if (!read.ok) return
      // ⚠️ **Parsed by `importCodexRollout`, and the assertion is a fact only that parser produces.**
      // A rollout's user turn lives at `payload.type = 'user_message'` inside a `response_item`;
      // `importClaudeTranscript` reads none of that and would yield an empty transcript.
      expect(read.entries?.map((event) => event.type)).toEqual([
        'user_turn',
        'thinking',
        'assistant_message',
      ])
      expect(
        read.entries?.some((event) => JSON.stringify(event).includes('rollout, not a JSONL')),
      ).toBe(true)
      expect(read.name).toBe('rollout-2026-08-07T14-17-40-019fdc5f.jsonl')
      // ⛔ No run and no task: a thread belongs to neither, and neither is invented.
      expect(read.runId).toBeNull()
      expect(read.taskId).toBeNull()
      // ⛔ **No thinking COUNT** (109's asymmetry): `countThinkingBlocks` measures a Claude record
      // shape a rollout does not have, so running it would report `0` about a provider that was
      // never asked. Absent means "not said".
      expect(read.thinkingBlocks).toBeUndefined()
      // The lookup is by THREAD id, in the Codex home, through the seam that copies before reading.
      expect(asked).toEqual([
        {
          provider: 'codex',
          home: codexHome,
          ref: { provider: 'codex', sessionId: THREAD, cwd: '/tmp/w', rotation: 0 },
        },
      ])
    })

    it('⛔ a Codex child this session never announced is refused before the state DB is opened', () => {
      let lookups = 0
      const host = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => false },
        {
          rollout: () => {
            lookups += 1
            return rolloutPath
          },
        },
      )
      expect(host.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })).toEqual({
        ok: false,
        reason: 'unknown-agent',
        rowsUnread: 0,
      })
      expect(lookups, "another thread's rollout was looked up").toBe(0)
    })

    it('a rollout the index names that is not on disk is gone', () => {
      const missing = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        { rollout: () => join(codexHome, 'sessions', 'never-written.jsonl') },
      )
      expect(missing.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })).toEqual({
        ok: false,
        reason: 'gone',
        rowsUnread: 0,
      })
    })

    it('⚠️ a SYMLINKED child is named by where it lands, and described by the sidecar there', () => {
      // The other half of the sidecar fix. `readChildWork` names a followed link by its TARGET —
      // `child-work.test.ts` pins that — so a sidecar looked up beside the LINK would make the
      // header name one file and describe another, and silently lose the description of every
      // followed child. Mutation N survived until this existed.
      const subagents = join(
        childWorkRoot(claudeHome, {
          provider: 'claude',
          sessionId: 'parent-uuid',
          cwd: '/tmp/w',
        } as SessionRef),
        'subagents',
      )
      const link = 'a6666666666666666'
      symlinkSync(join(subagents, `agent-${PLAIN}.jsonl`), join(subagents, `agent-${link}.jsonl`))
      const host = hostFor({
        find: () => claudeRow(),
        workflowAgentTask: () => null,
        reportedSubAgent: () => true,
      })
      const read = host.readChildWork(SESSION, { part: 'transcript', agentId: link })
      expect(read.ok, `refused: ${read.ok ? '' : read.reason}`).toBe(true)
      if (!read.ok) return
      // Named by the landing…
      expect(read.name).toBe(`agent-${PLAIN}.jsonl`)
      // …and described by the sidecar that sits beside the landing, which is the same file.
      expect(read.title).toBe('Summarize workspace contents')
    })

    it('🔴 731 · a BINARY the index names is refused, `.jsonl` or not — it cannot be drawn as text', () => {
      // ⛔ On `main` a binary named `.jsonl` passed the allow-list and was read as a rollout.
      const binary = join(codexHome, 'sessions', 'rollout-binary.jsonl')
      writeFileSync(binary, Buffer.from([0x7b, 0x00, 0x7d, 0x0a]))
      const refused = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        { rollout: () => binary },
      )
      expect(refused.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })).toEqual({
        ok: false,
        reason: 'not-readable',
        rowsUnread: 0,
      })
    })

    it('🔴 731 · a `.toml` the index names is read as text too — no extension is asked', () => {
      // ⛔ On `main` this was refused `not-readable`: the extension allowlist `workflow-output.ts`
      // had, which `731` removed from both doors.
      const planted = join(codexHome, 'sessions', 'config.toml')
      writeFileSync(planted, 'model_reasoning_effort = "low"\n')
      const host = hostFor(
        { find: () => codexRow(), reportedSubAgent: () => true },
        { rollout: () => planted },
      )
      expect(host.readChildWork(SESSION, { part: 'transcript', agentId: THREAD })).toMatchObject({
        ok: true,
        name: 'config.toml',
        text: 'model_reasoning_effort = "low"\n',
      })
    })

    it('a Codex child has no journal and no SCRIPT, and says which of those it is', () => {
      // ⚠️ `unsupported` is not `unknown-agent`: the run is perfectly well known — a thread simply
      // is not one, so these two artefacts do not exist rather than being unread.
      //
      // ⚠️ **BOTH parts are asked for.** Review caught the first version requesting only the
      // journal, which a narrowing to `input.part === 'journal'` would have survived — and a Codex
      // script would then have fallen through to `unknown-agent`, the exact sentence this test's
      // own name says must not be given.
      const host = hostFor({
        find: () => codexRow(),
        reportedSubAgent: () => true,
        workflowAgentIds: () => [AGENT],
      })
      for (const part of ['journal', 'script'] as const) {
        expect(host.readChildWork(SESSION, { part, taskId: 'waw6gpzzj' }), part).toEqual({
          ok: false,
          reason: 'unsupported',
          rowsUnread: 0,
        })
      }
    })

    it('⛔ …but a run this session never recorded is `unknown-agent`, not a claim about threads', () => {
      // ⚠️ **The ledger answers first, and review found this the wrong way round.** With the shape
      // check above the allowlist, the door said "a thread has no journal" about a task id it had
      // never heard of — a confident statement concerning a run we do not know.
      const host = hostFor({
        find: () => codexRow(),
        reportedSubAgent: () => true,
        workflowAgentIds: () => [],
      })
      expect(host.readChildWork(SESSION, { part: 'journal', taskId: 'never-seen' })).toEqual({
        ok: false,
        reason: 'unknown-agent',
        rowsUnread: 0,
      })
    })
  })

  it("a row from BEFORE profiles existed reads our own home, not the user's", () => {
    // ⚠️ Review, MEDIUM. "Found in the user's own home" is `adoptedAt !== null && profileId ===
    // null`; `profileId === null` alone is a row that predates profiles and really ran in `default`.
    // Reading the second as the first sent every one of those to `~/.claude`, where the child is
    // not — `gone` for a transcript that is on disk.
    const asked: string[] = []
    const host = hostFor({
      find: () => claudeRow({ profileId: null }),
      workflowAgentTask: () => 't',
    })
    const spy = hostFor(
      { find: () => claudeRow({ profileId: null }), workflowAgentTask: () => 't' },
      { onPath: () => asked.push('ours') },
    )
    expect(host.readChildWork(SESSION, { part: 'transcript', agentId: AGENT })).toEqual({
      ok: false,
      reason: 'gone',
      rowsUnread: 0,
    })
    spy.readChildWork(SESSION, { part: 'transcript', agentId: AGENT })
    expect(asked, 'an un-adopted row was sent to the user’s own home').toEqual(['ours'])
  })

  it('a journal is addressed by the RUN, and an unknown run is refused', () => {
    const host = hostFor({ find: () => claudeRow(), workflowAgentIds: () => [] })
    expect(host.readChildWork(SESSION, { part: 'journal', taskId: 'nope' })).toEqual({
      ok: false,
      reason: 'unknown-agent',
      rowsUnread: 0,
    })
    // …and the paired positive: a run whose agents the ledger knows gets to the filesystem, where
    // `gone` is the honest answer for a directory that is not there.
    const known = hostFor({ find: () => claudeRow(), workflowAgentIds: () => [AGENT] })
    expect(known.readChildWork(SESSION, { part: 'journal', taskId: 'waw6gpzzj' })).toEqual({
      ok: false,
      reason: 'gone',
      rowsUnread: 0,
    })
  })
})
