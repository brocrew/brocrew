import { readFileSync } from 'node:fs'
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

  it('keeps the report owner independent of event contracts and effects', () => {
    const source = readFileSync(
      new URL('../src/shared/work-report-contracts.ts', import.meta.url),
      'utf8',
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(code).toContain('export interface WorkReport {')
    expect(code).not.toMatch(/\bimport\b/)
    expect(code).not.toMatch(/\bfrom\s*['"]/)
    expect(code).not.toContain('Date.now')
    expect(code).not.toContain('setTimeout')
  })
})
