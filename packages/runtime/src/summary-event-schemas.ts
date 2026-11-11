import { z } from 'zod'

export const turnSummarySchema = z.object({
  type: z.literal('turn_summary'),
  status: z.string().optional(),
  detail: z.string(),
  needsAction: z.string(),
})
export const commandSummarySchema = z.object({
  type: z.literal('command_summary'),
  description: z.string(),
})
