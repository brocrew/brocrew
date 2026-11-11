import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import { claudeResultOutcome, normalizeMessage } from '../src/claude/normalize'

type LostWrites = Extract<SDKMessage, { subtype: 'session_writes_lost' }>

it.each<Pick<LostWrites, 'lost' | 'error_code'> & { warning: string }>([
  {
    lost: ['transcript'],
    error_code: 'ENOSPC',
    warning:
      "Claude Code couldn't save conversation history because the disk was full. Resuming affected conversations may miss part of their history.",
  },
  {
    lost: ['global_config'],
    error_code: 'EDQUOT',
    warning: "Claude Code couldn't save global settings because the disk quota was used up.",
  },
  {
    lost: ['transcript', 'global_config'],
    error_code: 'EDQUOT',
    warning:
      "Claude Code couldn't save conversation history and global settings because the disk quota was used up. Resuming affected conversations may miss part of their history.",
  },
])('warns about $lost without replacing the completed result', ({ lost, error_code, warning }) => {
  const message: LostWrites = {
    type: 'system',
    subtype: 'session_writes_lost',
    uuid: '00000000-0000-4000-8000-000000000001',
    session_id: 'current-session',
    lost,
    error_code,
    ...(lost.includes('transcript') ? { transcript_session_ids: ['earlier-session'] } : {}),
  }
  expect(normalizeMessage(message)).toEqual([
    { type: 'error', message: warning, fatal: false },
    {
      type: 'unknown',
      provider: 'claude',
      category: 'lifecycle',
      label: 'session_writes_lost',
      raw: message,
    },
  ])
  expect(claudeResultOutcome(message)).toBeNull()
})
