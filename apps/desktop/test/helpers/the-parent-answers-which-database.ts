import { expect } from 'vitest'
import { agentToolsFor } from '../../src/main/runtime/agent-tools'
import type { RuntimeHost } from '../../src/main/runtime/runtime-host'
import { callOn } from './call-tool'

/** The worker asks its parent with ask_question, and the parent answers Postgres. */
export async function theParentAnswersWhichDatabase(
  host: RuntimeHost,
  worker: string,
  parent: string,
): Promise<string> {
  const asked = await callOn(agentToolsFor(host, worker), 'ask_question', {
    who_answers: 'the-parent',
    question: 'Which database?',
    options: ['Postgres', 'SQLite'],
  })
  expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
  const question = asked.question as string
  const answered = await host.answerQuestion(
    { questionId: question, answers: [{ part: 'answer', answer: ['Postgres'] }] },
    { ownerId: `agent:${parent}` },
  )
  expect(answered.ok, JSON.stringify(answered)).toBe(true)
  return question
}
