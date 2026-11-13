import type { z } from 'zod'

export function toolFieldProblems<Field extends string = string>() {
  const problems: z.core.$ZodIssue[] = []
  const problem = (field: Field, message: string): void => {
    problems.push({ code: 'custom', path: [field], message })
  }
  const wrongType = (field: Field): void => {
    problems.push({
      code: 'invalid_type',
      path: [field],
      expected: 'string',
      message: 'expected text',
    })
  }
  return { problems, problem, wrongType }
}
