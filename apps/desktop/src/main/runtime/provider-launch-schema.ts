import { z } from 'zod'
import { providerSchema } from '@brobot2/shared'

export function resolveProviderLaunchSchema(profileId: z.ZodOptional<z.ZodString>) {
  return z.object({
    kind: z.literal('resolveProviderLaunch'),
    profileId,
    askedProvider: providerSchema.nullable(),
    providers: z.array(
      z.object({
        provider: providerSchema,
        ready: z.boolean().nullable(),
        program: z
          .object({
            standing: z.enum([
              'tested',
              'older-than-tested',
              'newer-than-tested',
              'missing',
              'unreadable',
            ]),
          })
          .nullable()
          .optional(),
      }),
    ),
  })
}
