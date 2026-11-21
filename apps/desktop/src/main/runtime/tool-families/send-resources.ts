import { z } from 'zod'
import { HELD_FORMS_WITH_EXTENSIONS_SAID } from '../../../shared/documents'

export const sendResourcesInput = z
  .array(z.string().min(1))
  .optional()
  .describe(
    `Files to hand over — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your working directory.`,
  )

export const sendResourcesProblem = 'send a list of file paths, or leave it out'
