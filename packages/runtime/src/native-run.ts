import { z } from 'zod'

/** Presentation facts filled by adapters; older ledger rows may have none. */
export const nativeRunSchema = z.object({
  kind: z.enum(['command', 'agent', 'job', 'monitor', 'workflow', 'checklist']),
  input: z.string().optional(),
  progress: z.string().optional(),
  result: z.string().optional(),
})

export type NativeRun = z.infer<typeof nativeRunSchema>

export function nativeRun(kind: NativeRun['kind'], facts: Omit<NativeRun, 'kind'> = {}): NativeRun {
  return {
    kind,
    ...Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined && v !== '')),
  }
}

function runInput(...parts: (string | undefined)[]): string | undefined {
  return parts.filter((part) => part !== undefined && part !== '').join('\n') || undefined
}

/** A line of the supplied text, without interpreting its format. */
export function runLine(text: string | undefined, tail = false): string | undefined {
  const lines = text?.split(/\r?\n/).filter((line) => line.trim() !== '')
  return tail ? lines?.at(-1) : lines?.[0]
}

export function checklistRun(
  steps: readonly { text: string; status: string }[],
  note?: string,
  body?: string,
): NativeRun {
  const done = steps.length > 0 && steps.every((step) => step.status === 'done')
  const current = steps.find((step) => step.status === 'active')
  return nativeRun('checklist', {
    input: runInput(body, ...steps.map((step) => step.text), note),
    progress: done ? undefined : runLine(current?.text ?? note),
    result: done ? (runLine(note) ?? 'Completed') : undefined,
  })
}

export function scheduledRun(job: {
  prompt?: string
  schedule?: string
  nominalAt?: number
}): NativeRun {
  return nativeRun('job', {
    input: runInput(job.prompt, job.schedule ? `Schedule: ${job.schedule}` : undefined),
  })
}

export function commandInput(command?: string, cwd?: string): string | undefined {
  return runInput(command, cwd ? `Directory: ${cwd}` : undefined)
}

export function agentInput(prompt?: string, type?: string, model?: string): string | undefined {
  return runInput(prompt, type ? `Type: ${type}` : undefined, model ? `Model: ${model}` : undefined)
}

export function workflowInput(
  name?: string,
  description?: string,
  source?: string,
): string | undefined {
  const details =
    source === name
      ? undefined
      : name && source?.startsWith(`${name}\n`)
        ? source.slice(name.length + 1)
        : source
  return runInput(name, description, details)
}
