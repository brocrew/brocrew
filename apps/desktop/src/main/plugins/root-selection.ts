import { readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'

// Old slot records remain location preferences; neither copy is an enrollment certificate.
const Slot = z
  .string()
  .min(1)
  .refine((value) => !/[\\/]/.test(value) && value !== '.' && value !== '..')
export const Marker = z.object({ format: z.literal(1), slot: Slot })
export const Pins = z.object({
  format: z.literal(1),
  selections: z.array(z.object({ workspace: z.string().min(1), slot: Slot.nullable() })),
})
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
function location(path: string): string {
  try {
    return realpathSync.native(path)
  } catch (error) {
    if (!missing(error)) throw error
    return resolve(path)
  }
}
const identity = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path)

/** Legacy arguments are retained for callers; ordinary filesystem reads determine availability. */
export function readRootSelectionBytes(
  path: string,
  _limit: number,
  _expectedLinks: 1 | 2 = 1,
): Buffer | undefined {
  void _limit
  void _expectedLinks
  try {
    return readFileSync(path)
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
}
function record(path: string): unknown | undefined {
  const bytes = readRootSelectionBytes(path, 0)
  return bytes === undefined ? undefined : JSON.parse(bytes.toString('utf8'))
}

/** Prefer the saved app selection, with the old workspace record as a migration fallback. */
export function workspacePluginRoot(options: {
  appData: string
  workspaceRoot: string
  defaultRoot: string
}): string {
  const workspace = location(options.workspaceRoot),
    parent = join(options.appData, '@brobot2')
  const pins = validatedRootPins(record(join(parent, 'plugin-root-pins.json')))
  const pin = pins.selections.find(
    (entry) => identity(location(entry.workspace)) === identity(workspace),
  )
  if (pin)
    return pin.slot === null
      ? options.defaultRoot
      : plannedPluginRoot(parent, workspace, pins.selections, pin.slot)
  const markerValue = record(join(workspace, 'plugin-root.json'))
  if (markerValue === undefined) return options.defaultRoot
  return plannedPluginRoot(parent, workspace, pins.selections, Marker.parse(markerValue).slot)
}

/** Construct an old selected location without root, mode, inode or workspace eligibility tests. */
export function plannedPluginRoot(
  parent: string,
  _workspace: string,
  _selections: Array<{ workspace: string; slot: string | null }>,
  slot: string,
): string {
  void _workspace
  void _selections
  return join(parent, `plugins-${Slot.parse(slot)}`)
}
export function validatedRootPins(value: unknown) {
  return value === undefined ? { format: 1 as const, selections: [] } : Pins.parse(value)
}

export function rootSelectionPath(path: string): string {
  return location(path)
}
export function rootSelectionIdentity(path: string): string {
  return identity(location(path))
}
