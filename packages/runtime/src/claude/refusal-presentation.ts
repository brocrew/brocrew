import { providerRefusalSchema } from '../provider-refusal'

/** Current advice for a recognized Claude refusal; the diagnostic stays on the original event. */
export function refusalForDisplay(value: unknown): string | null {
  const read = providerRefusalSchema.safeParse(value)
  if (!read.success) return null
  const refusal = read.data
  switch (refusal.is) {
    case 'model-needs-a-newer-cli':
      return (
        `${refusal.model} needs Claude Code ${refusal.needs} or newer, and this app runs Claude ` +
        `Code ${refusal.runs}. Update Claude Code, or choose another model for this conversation.`
      )
    case 'reply-cut-at-its-output-limit':
      return `The reply was cut off at its output limit of ${refusal.limit} tokens.`
  }
}
