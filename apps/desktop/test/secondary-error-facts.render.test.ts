import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { F093World } from './lib/f093-host'
import { legacyConversation } from './fixtures/legacy-migration-data'
import { createHistoryReader } from '../src/main/recovery/history-reader'
import {
  childWorkRoot,
  readChild as readClaudeChild,
} from '../src/main/providers/claude/child-work'
import { readChild as readCodexChild } from '../src/main/providers/codex/child-work'
import { importClaudeTranscript } from '../src/main/providers/claude/import-transcript'
import { importCodexRollout } from '../src/main/providers/codex/import-transcript'
import { readOnlyTranscript } from '../src/renderer/src/lib/read-only-transcript'
import ChildWorkViewer from '../src/renderer/src/components/ChildWorkViewer.vue'
import type { ProviderChildWorkRequest } from '../src/main/providers/transcript-policy'

const sentence = 'The fictional provider could not open this model.'
const envelope = JSON.stringify({ error: { message: sentence } })
const malformed = '{provider glitch'
const errors = [envelope, `turn failed: ${envelope}`, malformed]
const note = 'This is a read-only copy.'

it('projects real recovery-copy errors without changing the database or fallback diagnostics', async () => {
  const world = new F093World()
  const id = 'recovered-error'
  const copy = join(world.project, 'copy.sqlite')
  try {
    legacyConversation(world.db, {
      id,
      profileId: id,
      provider: 'codex',
      cwd: world.project,
      approvalMode: 'ask',
    })
    errors.forEach((message, ordinal) =>
      world.store.append(id, ordinal, { type: 'error', message, fatal: false }, 1000 + ordinal),
    )
    await world.db.backup(copy)
    const db = new Database(copy)
    db.pragma('journal_mode = DELETE')
    db.close()
    const before = readFileSync(copy)
    const reader = createHistoryReader(copy)
    try {
      const rows = await reader.transcript(id)
      expect(rows.map((row) => row.event)).toEqual(
        errors.map((message) => ({ type: 'error', message, fatal: false })),
      )
      expect(rows.map((row) => row.at)).toEqual([1000, 1001, 1002])
      const state = readOnlyTranscript(rows, note)
      expect(state.items.filter((item) => item.kind === 'notice').map((item) => item.text)).toEqual(
        [sentence, malformed],
      )
      const legacy = readOnlyTranscript(
        rows.map(({ event, at, workAncestry }) => ({ event, at, workAncestry })),
        note,
      )
      expect(
        legacy.items.filter((item) => item.kind === 'notice').map((item) => item.text),
      ).toEqual(errors)
    } finally {
      reader.close()
    }
    expect(readFileSync(copy)).toEqual(before)
  } finally {
    await world.dispose()
  }
})

it.each(['claude', 'codex'] as const)(
  'carries actual %s child-reader order and optional facts into the real viewer',
  async (provider) => {
    const world = new F093World()
    const agent = 'a0123456789abcdef'
    const ref = { provider, sessionId: 'fictional-parent', cwd: world.project, rotation: 0 }
    const frames =
      provider === 'claude'
        ? errors.map((text) =>
            JSON.stringify({
              type: 'assistant',
              timestamp: '2026-10-10T12:00:00Z',
              error: 'api_error',
              message: {
                role: 'assistant',
                model: '<synthetic>',
                content: [{ type: 'text', text }],
              },
            }),
          )
        : [
            JSON.stringify({
              type: 'response_item',
              timestamp: '2026-10-10T12:00:00Z',
              payload: {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: envelope }],
              },
            }),
          ]
    const path =
      provider === 'claude'
        ? join(childWorkRoot(world.project, ref), 'subagents', `agent-${agent}.jsonl`)
        : join(world.project, 'child.jsonl')
    mkdirSync(join(path, '..'), { recursive: true })
    const raw = frames.join('\n') + '\n'
    writeFileSync(path, raw)
    const request: ProviderChildWorkRequest = {
      ref,
      agents: [agent],
      part: 'transcript',
      taskId: null,
      updatedAt: 1000,
      home: () => world.project,
      pathForChild: () => path,
    }
    try {
      const result = provider === 'claude' ? readClaudeChild(request) : readCodexChild(request)
      expect(result.ok).toBe(true)
      if (!result.ok || !result.entries) throw new Error('Expected the child transcript')
      const original =
        provider === 'claude'
          ? importClaudeTranscript(frames, 1000)
          : importCodexRollout(frames, 1000)
      expect(result.entries).toEqual(original.entries.map((row) => row.event))
      expect(result.errorFacts).toHaveLength(result.entries.length)
      expect(result.text).toBe(raw)
      const entries = result.entries
      const eventReferences = [...entries]
      const render = (value: typeof result) =>
        renderToString(
          createSSRApp({ render: () => h(ChildWorkViewer, { result: value, label: 'Fern' }) }),
        )
      const html = (await render(result)).replace(/<!--[\s\S]*?-->/g, '')
      expect(html).toContain('data-cy="child-work-viewer"')
      if (provider === 'claude') {
        expect(result.entries.filter((event) => event.type === 'error')).toHaveLength(3)
        expect(result.errorFacts?.[1]?.ending).toEqual({ raw: envelope, sentence })
        expect(html).toContain(sentence)
        expect(html).toContain(malformed)
        expect(html).not.toContain('turn failed:')
        const legacy = await render({ ...result, errorFacts: undefined })
        expect(legacy).toContain('turn failed:')
      } else {
        // A rollout records this as assistant prose, not an error. It must never be decoded.
        expect(result.entries).toEqual([{ type: 'assistant_message', text: envelope }])
        expect(result.errorFacts).toEqual([undefined])
        expect(html).toContain('fictional provider')
        expect(await render({ ...result, errorFacts: undefined })).toBe(await render(result))
      }
      expect(result.entries).toBe(entries)
      result.entries.forEach((event, index) => expect(event).toBe(eventReferences[index]))
      expect(readFileSync(path, 'utf8')).toBe(raw)
    } finally {
      await world.dispose()
    }
  },
)
