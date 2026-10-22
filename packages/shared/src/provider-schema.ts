import { z } from 'zod'
import { SUPPORTED_PROVIDERS } from './providers'

/** Validate boundary input against the ids declared by the provider registry. */
export const providerSchema = z.enum(SUPPORTED_PROVIDERS)
