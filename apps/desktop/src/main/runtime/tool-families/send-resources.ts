import { z } from 'zod'
import { HELD_FORMS_WITH_EXTENSIONS_SAID, MAX_RESOURCES_PER_REPLY } from '../../../shared/documents'

export const sendResourcesInput = z
  .array(z.string().min(1))
  .max(MAX_RESOURCES_PER_REPLY)
  .optional()
  .describe(
    `Files to hand over, at most ${MAX_RESOURCES_PER_REPLY} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your working directory.`,
  )

export const sendResourcesProblem = `send up to ${MAX_RESOURCES_PER_REPLY} file paths as a list, or leave it out`
