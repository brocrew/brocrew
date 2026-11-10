import { z } from 'zod'

/** Recognized refusal values let surfaces give usable advice while retaining raw diagnostics. */
export const providerRefusalSchema = z.discriminatedUnion('is', [
  z.object({
    is: z.literal('model-needs-a-newer-cli'),
    /** The model the refused turn asked for, as the CLI announced it. */
    model: z.string(),
    /** The oldest Claude Code the provider says can run it. */
    needs: z.string(),
    /** The Claude Code this app spawned for that turn, as it announced itself. */
    runs: z.string(),
  }),
  z.object({
    is: z.literal('reply-cut-at-its-output-limit'),
    /** The output-token maximum the CLI says the reply exceeded. */
    limit: z.string(),
  }),
])
export type ProviderRefusal = z.infer<typeof providerRefusalSchema>
