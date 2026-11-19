import type { UserInputQuestion } from '@brobot2/runtime'

export function outboundQuestionText(
  asker: { readonly called: string; readonly address: string; readonly line: string },
  request: {
    readonly id: string
    readonly prompt: string
    readonly questions: readonly UserInputQuestion[]
    readonly label?: string | null
    readonly taskTitle?: string | null
  },
  receiverLine: string,
): string {
  const lines = [
    `${asker.called} (${asker.line}) asks you ${request.id} in your ${receiverLine}.`,
    `Use asked_by ${asker.address} with this question id.`,
  ]
  if (request.label != null) {
    const title = request.taskTitle == null ? '' : ` · ${request.taskTitle}`
    lines.push(`About task ${request.label}${title}.`)
  }
  lines.push(request.prompt)
  for (const part of request.questions) {
    const header = part.header === undefined ? '' : ` · ${part.header}`
    const soleAsk = request.questions.length === 1 && part.id === 'answer'
    const prompt = soleAsk
      ? part.options.length === 0
        ? 'answer in your own words.'
        : 'choose one:'
      : part.prompt
    lines.push(`Part id "${part.id}"${header}: ${prompt}`)
    for (const option of part.options) lines.push(`    - ${option.label}`)
    if (part.allowOther === true) lines.push('    (or an answer of your own)')
    if (part.multiSelect === true) lines.push('    (this part takes more than one)')
  }
  lines.push(
    'Answer with answer_question, one entry per part id: answers: [{ part: "id", answer: ["…"] }]. If you can’t, use cannot_answer and say why.',
  )
  return lines.join('\n')
}
