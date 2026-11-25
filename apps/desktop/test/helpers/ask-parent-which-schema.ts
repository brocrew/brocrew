import type { AgentToolset } from '@brobot2/runtime'
import { expect } from 'vitest'
import { callOn } from './call-tool'

export async function askParentWhichSchema(workerTools: AgentToolset, piece: string) {
  const asked = await callOn(workerTools, 'ask_question', {
    who_answers: 'the-parent',
    piece,
    question: 'which schema?',
    options: ['a', 'b'],
  })
  expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
  return asked
}
