import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeSessionHandle, type ClaudeQuery } from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'
import { watchClaudeChild } from '../src/claude/claude-child'

it('confirms skills only after a matching SDK init and clears a later failed confirmation', async () => {
  const input = new AsyncQueue<SDKUserMessage>()
  const messages = new AsyncQueue<SDKMessage>()
  const cwd = join(tmpdir(), 'fictional-work')
  const root = join(tmpdir(), 'fictional-skills')
  const handle = new ClaudeSessionHandle(input, cwd, 0)
  const offered = {
    root,
    skills: [
      {
        name: 'brobot:fictional-guide',
        description: 'Read fictional notes.',
        path: join(root, 'skills/fictional-guide/SKILL.md'),
      },
    ],
  }
  handle.noteBuiltInSkills(offered)
  expect(handle.builtInSkillsConfirmed()).toBe(false)
  const query: ClaudeQuery = {
    interrupt: async () => undefined,
    close: () => messages.close(),
    [Symbol.asyncIterator]: () => messages[Symbol.asyncIterator](),
  }
  handle.attachQuery(
    query,
    watchClaudeChild(() => {
      throw new Error('No child is started in this fixture')
    }),
  )
  handle.begin('started')
  try {
    messages.push({
      type: 'system',
      subtype: 'init',
      session_id: 'fictional-session',
      cwd,
      tools: [],
      mcp_servers: [],
      plugins: [{ name: 'brobot', path: offered.root }],
      skills: ['brobot:fictional-guide'],
    } as unknown as SDKMessage)
    await vi.waitFor(() => expect(handle.builtInSkillsConfirmed()).toBe(true))
    messages.push({
      type: 'system',
      subtype: 'init',
      session_id: 'fictional-session',
      tools: [],
      plugins: [],
      skills: [],
    } as unknown as SDKMessage)
    await vi.waitFor(() => expect(handle.builtInSkillsConfirmed()).toBe(false))
  } finally {
    await handle.close()
  }
})
