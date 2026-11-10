import { describe, expect, it } from 'vitest'
import {
  TASK_STATES as PUBLIC_TASK_STATES,
  TASK_STALL_CAUSES as PUBLIC_TASK_STALL_CAUSES,
  TASK_OUTCOMES as PUBLIC_TASK_OUTCOMES,
  AGENT_MESSAGE_KINDS as PUBLIC_AGENT_MESSAGE_KINDS,
} from '../src/shared/task-contracts'
import {
  TASK_STATES,
  TASK_STALL_CAUSES,
  TASK_OUTCOMES,
  AGENT_MESSAGE_KINDS,
} from '../src/shared/work-report-contracts'

describe('work report contracts', () => {
  it('keeps the public task vocabularies as the same arrays', () => {
    expect(PUBLIC_TASK_STATES).toBe(TASK_STATES)
    expect(PUBLIC_TASK_STALL_CAUSES).toBe(TASK_STALL_CAUSES)
    expect(PUBLIC_TASK_OUTCOMES).toBe(TASK_OUTCOMES)
    expect(PUBLIC_AGENT_MESSAGE_KINDS).toBe(AGENT_MESSAGE_KINDS)
  })
})
