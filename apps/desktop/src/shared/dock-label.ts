import { contrastRatio, parseColour, type Rgba } from './themes/colour'

/**
 * The Dock label: a short name on a coloured band along the bottom of the app's icon, so a person
 * running several workspaces can tell their icons apart. Each workspace keeps its own.
 */

export const DOCK_LABEL_CHANNELS = {
  read: 'app:dock-label:read',
  set: 'app:dock-label:set',
} as const

/** The band's colours, each with a name for screen readers. */
export const DOCK_LABEL_COLOURS = [
  { id: 'red', name: 'Red', hex: '#dc2626' },
  { id: 'orange', name: 'Orange', hex: '#c2410c' },
  { id: 'amber', name: 'Amber', hex: '#f5b301' },
  { id: 'green', name: 'Green', hex: '#15803d' },
  { id: 'teal', name: 'Teal', hex: '#0f766e' },
  { id: 'blue', name: 'Blue', hex: '#2563eb' },
  { id: 'violet', name: 'Violet', hex: '#7c3aed' },
  { id: 'pink', name: 'Pink', hex: '#be185d' },
] as const

export type DockLabelColour = (typeof DOCK_LABEL_COLOURS)[number]['id']

/** The longest name the band shows. */
export const DOCK_LABEL_MAX = 6

/** What a workspace's label is, as the window shows it. */
export interface DockLabel {
  readonly on: boolean
  readonly name: string
  readonly colour: DockLabelColour
  /** What the name and colour are when the person hasn't chosen: from the workspace's name. */
  readonly defaults: { readonly name: string; readonly colour: DockLabelColour }
}

/** A change the window asks for; a `null` name or colour goes back to the default. */
export interface DockLabelChange {
  readonly on?: boolean
  readonly name?: string | null
  readonly colour?: DockLabelColour | null
}

/**
 * A name as the band shows it: capital letters and digits only, accents dropped, at most
 * {@link DOCK_LABEL_MAX}. Empty when nothing of it can be shown.
 */
export function dockLabelName(typed: string): string {
  return [
    ...typed
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ''),
  ]
    .slice(0, DOCK_LABEL_MAX)
    .join('')
}

/** The app's own names, which say nothing about which workspace a folder is. */
const APP_NAMES = new Set(['BROBOT', 'BROCREW'])

/** Capital letters and digits only, accents dropped; nothing cut. */
function capitals(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * The name a workspace's band starts with, from the workspace's own name, by one rule:
 *  1. take its first word, passing over the app's own name when another word follows
 *     ("Atlas workspace" → ATLAS, "brobot-atlas" → ATLAS);
 *  2. keep the number that ends it, or that ends the name as a word of its own ("test1" and
 *     "Test 1" → TEST1);
 *  3. if the word is still too long beside that number, drop its vowels after the first two
 *     letters, then cut it ("Default" → DEFLT, "Harbour" → HARBR);
 *  4. `BRO` when nothing of it can be shown (a name in another script).
 */
export function defaultDockLabelName(workspaceName: string): string {
  const words = workspaceName
    .split(/[^\p{L}\p{N}]+/u)
    .map(capitals)
    .filter((word) => word)
  while (words.length > 1 && APP_NAMES.has(words[0]!)) words.shift()
  const first = words[0] ?? ''
  const own = /^(.*?[A-Z])(\d+)$/.exec(first)
  const last = words.length > 1 ? words[words.length - 1]! : ''
  const stem = own ? own[1]! : first
  const number = (own ? own[2]! : /^\d+$/.test(last) && /[A-Z]/.test(first) ? last : '').slice(0, 3)
  const room = DOCK_LABEL_MAX - number.length
  const short =
    stem.length > room
      ? (stem.slice(0, 2) + stem.slice(2).replace(/[AEIOU]/g, '')).slice(0, room)
      : stem
  return short + number || 'BRO'
}

/** The colour a workspace's band starts with: picked from its name, the same every time. */
export function defaultDockLabelColour(name: string): DockLabelColour {
  // FNV-1a: a stable, evenly spread pick from the name's characters.
  let hash = 0x811c9dc5
  for (const unit of name) {
    hash ^= unit.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return DOCK_LABEL_COLOURS[hash % DOCK_LABEL_COLOURS.length]!.id
}

/** A workspace as the colours are shared out: where it is, its starting name, any colour chosen. */
export interface DockLabelWorkspace {
  readonly key: string
  readonly name: string
  readonly chosen?: DockLabelColour
}

/**
 * The starting colour of every workspace, so that no two share one while there are swatches to
 * spare. Workspaces are taken in the order given (callers give a stable one): each takes the
 * swatch its name hashes to, or the next free one in palette order when another has it. A colour a
 * person chose is theirs, never changed, and the starting colours step around it. With more
 * workspaces than swatches, those left over take their plain hash.
 */
export function defaultDockLabelColours(
  workspaces: readonly DockLabelWorkspace[],
): Map<string, DockLabelColour> {
  const ids = DOCK_LABEL_COLOURS.map((colour) => colour.id)
  const taken = new Set<DockLabelColour>(
    workspaces.flatMap((workspace) => (workspace.chosen ? [workspace.chosen] : [])),
  )
  const out = new Map<string, DockLabelColour>()
  for (const workspace of workspaces) {
    if (workspace.chosen) {
      out.set(workspace.key, workspace.chosen)
      continue
    }
    const wanted = defaultDockLabelColour(workspace.name)
    const free = ids.length - taken.size > 0
    let at = ids.indexOf(wanted)
    while (free && taken.has(ids[at]!)) at = (at + 1) % ids.length
    const colour = ids[at]!
    out.set(workspace.key, colour)
    if (free) taken.add(colour)
  }
  return out
}

export function isDockLabelColour(value: unknown): value is DockLabelColour {
  return DOCK_LABEL_COLOURS.some((colour) => colour.id === value)
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }

/**
 * The band's text colour: white or black, whichever stands out more. For any opaque band one of
 * the two reaches at least 4.58 to 1; a near-black instead of black would fall under 4.5 on mid
 * greys.
 */
export function dockLabelInk(band: Rgba): Rgba {
  return contrastRatio(WHITE, band) >= contrastRatio(BLACK, band) ? WHITE : BLACK
}

/** A colour's band, as parsed numbers. */
export function dockLabelBand(colour: DockLabelColour): Rgba {
  return parseColour(DOCK_LABEL_COLOURS.find((c) => c.id === colour)!.hex)!
}

export function isDockLabelChange(value: unknown): value is DockLabelChange {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  if (!keys.every((key) => key === 'on' || key === 'name' || key === 'colour')) return false
  const change = value as Record<string, unknown>
  return (
    (change.on === undefined || typeof change.on === 'boolean') &&
    (change.name === undefined ||
      change.name === null ||
      (typeof change.name === 'string' && change.name.length <= 200)) &&
    (change.colour === undefined || change.colour === null || isDockLabelColour(change.colour))
  )
}
