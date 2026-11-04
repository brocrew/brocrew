import { z } from 'zod'
import type { PluginPackageRef } from './plugin-contract'

/** The selected reference checks bytes, without a publisher or source policy. */
export const PackageRefSchema = z.object({
  source: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative().safe(),
})
export type PackageRef = PluginPackageRef

/** Settings preserves whether the person selected a catalogue ID or entered a source. */
export type PluginPackageInput = string | PackageRef | { source: string }
