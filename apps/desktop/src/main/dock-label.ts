import type { NativeImage } from 'electron'
import { over, type Rgba } from '../shared/themes/colour'
import {
  defaultDockLabelColours,
  defaultDockLabelName,
  dockLabelBand,
  dockLabelInk,
  dockLabelName,
  isDockLabelColour,
  type DockLabel,
  type DockLabelChange,
  type DockLabelColour,
  type DockLabelWorkspace,
} from '../shared/dock-label'
import { lstat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { readThemeFile } from './themes/files'
import { bitmapRedIndex } from './themes/picture-samples'
import { themeDirectory, writeWorkspaceFile } from './themes/state'
import { WORKSPACE_FILE } from './data-folder'
import { ownNameIn, workspaceNameOf, workspacesIn } from './workspaces'
import { samePath } from './same-folder'

/**
 * The Dock label (`shared/dock-label.ts`): this workspace's short name on a coloured band along
 * the bottom of the app's own icon. Kept per workspace in `<userData>/dock-label.json`, painted
 * here in the main process, and set in the Dock with `setIcon` alone, so the Dock's count badge
 * and bounce are never touched.
 */

export const DOCK_LABEL_FILE = 'dock-label.json'

/** What the file says; anything it doesn't say plainly is the default. */
interface Saved {
  readonly on?: boolean
  readonly name?: string
  readonly colour?: DockLabelColour
}

/**
 * A small JSON file in `folder`, read through the theme files' careful reader: a regular file only,
 * never through a link, at most `maximum` bytes, without waiting on a pipe. Answers `undefined` for
 * one that is missing, not readable that way, or not JSON.
 */
export async function readSmallJson(
  folder: string,
  name: string,
  maximum: number,
): Promise<unknown> {
  const root = await themeDirectory(folder)
  if (!root) return undefined
  const read = await readThemeFile(root, name, maximum)
  if (!read.ok) return undefined
  try {
    return JSON.parse(read.bytes.toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

/** The most the file may hold: a few lines of settings. */
export const DOCK_LABEL_FILE_BYTES = 4096

/**
 * The settings in a workspace's data folder, read through the theme files' careful reader: a
 * regular file only, never through a link, at most {@link DOCK_LABEL_FILE_BYTES}, without waiting
 * on a pipe. A missing, oversized, linked or unreadable file says nothing, so the defaults stand.
 */
export async function readDockLabelFile(folder: string): Promise<Saved> {
  const said = await readSmallJson(folder, DOCK_LABEL_FILE, DOCK_LABEL_FILE_BYTES)
  if (typeof said !== 'object' || said === null || Array.isArray(said)) return {}
  const fields = said as Record<string, unknown>
  const name = typeof fields.name === 'string' ? dockLabelName(fields.name) : ''
  return {
    ...(typeof fields.on === 'boolean' ? { on: fields.on } : {}),
    ...(name ? { name } : {}),
    ...(isDockLabelColour(fields.colour) ? { colour: fields.colour } : {}),
  }
}

/** Saves the settings through the app's careful writer for a workspace's state files. */
export async function writeDockLabelFile(folder: string, saved: Saved): Promise<void> {
  await writeWorkspaceFile(folder, DOCK_LABEL_FILE, `${JSON.stringify(saved, null, 2)}\n`)
}

/** The label a workspace shows: what its file says, else what its name gives. */
export function dockLabelOf(
  saved: Saved,
  workspaceName: string,
  startingColour?: DockLabelColour,
): DockLabel {
  const name = defaultDockLabelName(workspaceName)
  const colour = startingColour ?? defaultDockLabelColours([{ key: '', name }]).get('')!
  return {
    on: saved.on ?? true,
    name: saved.name ?? name,
    colour: saved.colour ?? colour,
    defaults: { name, colour },
  }
}

/** A change applied to what the file says; a name that shows nothing goes back to the default. */
export function changedDockLabel(saved: Saved, change: DockLabelChange): Saved {
  const next: { on?: boolean; name?: string; colour?: DockLabelColour } = { ...saved }
  if (change.on !== undefined) next.on = change.on
  if (change.name !== undefined) {
    const name = change.name === null ? '' : dockLabelName(change.name)
    if (name) next.name = name
    else delete next.name
  }
  if (change.colour !== undefined) {
    if (change.colour === null) delete next.colour
    else next.colour = change.colour
  }
  return next
}

// ── The letters ────────────────────────────────────────────────────────────────────────────────

/** A point on a glyph's grid: x from 0 to its width, y from 0 (cap top) to 6 (baseline). */
type Point = readonly [number, number]

/** Points along an ellipse from `from` to `to` degrees; 0 is right and 90 is down. */
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number): Point[] {
  const steps = Math.max(4, Math.ceil(Math.abs(to - from) / 10))
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as const
  })
}

/** A glyph: its width on the grid, and the strokes drawn through its points. */
interface Glyph {
  readonly width: number
  readonly strokes: readonly (readonly Point[])[]
}

const g = (width: number, ...strokes: Point[][]): Glyph => ({ width, strokes })

/** Capital letters and digits drawn as even strokes with round ends. */
const GLYPHS: Readonly<Record<string, Glyph>> = {
  A: g(
    4,
    [
      [0, 6],
      [2, 0],
      [4, 6],
    ],
    [
      [0.7, 4],
      [3.3, 4],
    ],
  ),
  B: g(
    3.9,
    [[0, 3], [0, 0], [2.3, 0], ...arc(2.3, 1.5, 1.4, 1.5, -90, 90), [0, 3]],
    [[0, 3], [2.4, 3], ...arc(2.4, 4.5, 1.5, 1.5, -90, 90), [0, 6], [0, 3]],
  ),
  C: g(4, arc(2.1, 3, 2.1, 3, -40, -320)),
  D: g(4, [[0, 0], [0, 6], [1.6, 6], ...arc(1.6, 3, 2.4, 3, 90, -90), [0, 0]]),
  E: g(
    3.6,
    [
      [3.6, 0],
      [0, 0],
      [0, 6],
      [3.6, 6],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ),
  F: g(
    3.6,
    [
      [3.6, 0],
      [0, 0],
      [0, 6],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ),
  G: g(4.2, [...arc(2.1, 3, 2.1, 3, -40, -360), [2.4, 3]]),
  H: g(
    4,
    [
      [0, 0],
      [0, 6],
    ],
    [
      [4, 0],
      [4, 6],
    ],
    [
      [0, 3],
      [4, 3],
    ],
  ),
  I: g(0, [
    [0, 0],
    [0, 6],
  ]),
  J: g(3, [[3, 0], [3, 4.5], ...arc(1.5, 4.5, 1.5, 1.5, 0, 180)]),
  K: g(
    3.9,
    [
      [0, 0],
      [0, 6],
    ],
    [
      [3.9, 0],
      [0, 3.8],
    ],
    [
      [1.3, 2.7],
      [3.9, 6],
    ],
  ),
  L: g(3.4, [
    [0, 0],
    [0, 6],
    [3.4, 6],
  ]),
  M: g(5, [
    [0, 6],
    [0, 0],
    [2.5, 4.2],
    [5, 0],
    [5, 6],
  ]),
  N: g(4, [
    [0, 6],
    [0, 0],
    [4, 6],
    [4, 0],
  ]),
  O: g(4.4, arc(2.2, 3, 2.2, 3, 0, 360)),
  P: g(3.8, [[0, 6], [0, 0], [2.2, 0], ...arc(2.2, 1.6, 1.6, 1.6, -90, 90), [0, 3.2]]),
  Q: g(4.4, arc(2.2, 3, 2.2, 3, 0, 360), [
    [2.7, 4.3],
    [4.4, 6.2],
  ]),
  R: g(
    3.9,
    [[0, 6], [0, 0], [2.2, 0], ...arc(2.2, 1.6, 1.6, 1.6, -90, 90), [0, 3.2]],
    [
      [2, 3.2],
      [3.9, 6],
    ],
  ),
  S: g(4, [...arc(2, 1.5, 1.85, 1.5, -25, -270), ...arc(2, 4.5, 2, 1.5, -90, 155)]),
  T: g(
    4,
    [
      [0, 0],
      [4, 0],
    ],
    [
      [2, 0],
      [2, 6],
    ],
  ),
  U: g(4, [[0, 0], [0, 4], ...arc(2, 4, 2, 2, 180, 0), [4, 0]]),
  V: g(4.2, [
    [0, 0],
    [2.1, 6],
    [4.2, 0],
  ]),
  W: g(5.6, [
    [0, 0],
    [1.4, 6],
    [2.8, 1.4],
    [4.2, 6],
    [5.6, 0],
  ]),
  X: g(
    4,
    [
      [0, 0],
      [4, 6],
    ],
    [
      [4, 0],
      [0, 6],
    ],
  ),
  Y: g(
    4.2,
    [
      [0, 0],
      [2.1, 3.2],
      [4.2, 0],
    ],
    [
      [2.1, 3.2],
      [2.1, 6],
    ],
  ),
  Z: g(4, [
    [0, 0],
    [4, 0],
    [0, 6],
    [4, 6],
  ]),
  '0': g(3.8, arc(1.9, 3, 1.9, 3, 0, 360)),
  '1': g(1.5, [
    [0, 1.3],
    [1.5, 0],
    [1.5, 6],
  ]),
  '2': g(3.9, [...arc(1.95, 1.8, 1.85, 1.8, 200, 395), [0, 6], [3.9, 6]]),
  '3': g(3.9, [...arc(1.9, 1.5, 1.8, 1.5, 205, 450), ...arc(1.9, 4.5, 2, 1.5, -90, 155)]),
  '4': g(4, [
    [3, 6],
    [3, 0],
    [0, 4.2],
    [4, 4.2],
  ]),
  '5': g(3.9, [[3.6, 0], [0.4, 0], [0.2, 2.8], ...arc(1.9, 4.15, 2, 1.85, -140, 150)]),
  '6': g(3.9, arc(1.95, 4.15, 1.95, 1.85, 0, 360), [
    [0, 4.15],
    [0.4, 1.8],
    [1.4, 0.35],
    [3, 0],
  ]),
  '7': g(3.9, [
    [0, 0],
    [3.9, 0],
    [1.3, 6],
  ]),
  '8': g(3.9, arc(1.95, 1.5, 1.7, 1.5, 0, 360), arc(1.95, 4.5, 1.95, 1.5, 0, 360)),
  '9': g(3.9, arc(1.95, 1.85, 1.95, 1.85, 0, 360), [
    [3.9, 1.85],
    [3.5, 4.2],
    [2.5, 5.65],
    [0.9, 6],
  ]),
}

/** A straight stroke, in icon pixels. */
interface Segment {
  readonly ax: number
  readonly ay: number
  readonly bx: number
  readonly by: number
}

/** Text laid out in icon pixels: its strokes, their half width, and where they reach. */
export interface DockLabelText {
  readonly segments: readonly Segment[]
  readonly half: number
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

// ── The icon ───────────────────────────────────────────────────────────────────────────────────

/**
 * The icon's canvas, and Apple's rounded tile on it, as the app's own icon draws them (an 824 px
 * tile with a 185 px radius on 1024), at half that size: 512 px is what a Retina Dock shows at
 * its largest.
 */
export const DOCK_ICON_SIZE = 512
const TILE_AT = 50
const TILE_SIZE = 412
const TILE_RADIUS = 92.5

/** The band: the bottom 30% of the tile, its corners the tile's own. */
export const DOCK_LABEL_BAND_TOP = TILE_AT + TILE_SIZE - Math.round(TILE_SIZE * 0.3)
/** The widest the text may be: clear of the tile's rounded corners beside it. */
const TEXT_ROOM = 300
/** The letters' height at most, and the stroke's width and the space between letters, on the grid. */
const CAP_HEIGHT = 56
const STROKE = 1.1
const SPACING = 1.15

/** `name` laid out in the band, as large as fits. */
export function layOutDockLabel(name: string): DockLabelText {
  const glyphs = [...name].map((c) => GLYPHS[c]).filter((glyph): glyph is Glyph => !!glyph)
  const units =
    glyphs.reduce((sum, glyph) => sum + glyph.width, 0) +
    SPACING * Math.max(0, glyphs.length - 1) +
    STROKE
  const unit = Math.min(CAP_HEIGHT / 6, TEXT_ROOM / Math.max(units, 1))
  const width = units * unit
  const bandHeight = TILE_AT + TILE_SIZE - DOCK_LABEL_BAND_TOP
  // A little above the band's middle: its bottom corners are rounded.
  const top = DOCK_LABEL_BAND_TOP + (bandHeight - 6 * unit) / 2 - 3
  let x = (DOCK_ICON_SIZE - width) / 2 + (STROKE * unit) / 2
  const segments: Segment[] = []
  for (const glyph of glyphs) {
    for (const stroke of glyph.strokes) {
      for (let i = 1; i < stroke.length; i++) {
        const [ax, ay] = stroke[i - 1]!
        const [bx, by] = stroke[i]!
        segments.push({
          ax: x + ax * unit,
          ay: top + ay * unit,
          bx: x + bx * unit,
          by: top + by * unit,
        })
      }
      if (stroke.length === 1) {
        const [ax, ay] = stroke[0]!
        segments.push({
          ax: x + ax * unit,
          ay: top + ay * unit,
          bx: x + ax * unit,
          by: top + ay * unit,
        })
      }
    }
    x += (glyph.width + SPACING) * unit
  }
  const half = (STROKE * unit) / 2
  const xs = segments.flatMap((s) => [s.ax, s.bx])
  const ys = segments.flatMap((s) => [s.ay, s.by])
  return {
    segments,
    half,
    left: Math.min(...xs) - half,
    right: Math.max(...xs) + half,
    top: Math.min(...ys) - half,
    bottom: Math.max(...ys) + half,
  }
}

/** Distance from a point to a segment. */
function toSegment(px: number, py: number, s: Segment): number {
  const dx = s.bx - s.ax
  const dy = s.by - s.ay
  const length = dx * dx + dy * dy
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / length))
  return Math.hypot(px - (s.ax + t * dx), py - (s.ay + t * dy))
}

/** How much of a pixel lies inside a shape whose signed distance from its edge is `d`. */
const coverage = (d: number): number => (d <= -0.5 ? 1 : d >= 0.5 ? 0 : 0.5 - d)

/** Signed distance from the tile's rounded edge: negative inside. */
function tileDistance(x: number, y: number): number {
  const half = TILE_SIZE / 2
  const qx = Math.abs(x - (TILE_AT + half)) - (half - TILE_RADIUS)
  const qy = Math.abs(y - (TILE_AT + half)) - (half - TILE_RADIUS)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - TILE_RADIUS
}

/** `top` (straight colour) painted over a premultiplied pixel with coverage `k`, in place. */
function blend(pixels: Float32Array, at: number, top: Rgba, k: number): void {
  const a = top.a * k
  if (a <= 0) return
  const keep = 1 - a
  pixels[at] = (top.r / 255) * a + pixels[at]! * keep
  pixels[at + 1] = (top.g / 255) * a + pixels[at + 1]! * keep
  pixels[at + 2] = (top.b / 255) * a + pixels[at + 2]! * keep
  pixels[at + 3] = a + pixels[at + 3]! * keep
}

/** A labelled icon being painted, some rows at a time. */
export interface DockLabelPainter {
  /** Paints rows `from` up to `to`. */
  rows(from: number, to: number): void
  /** The painted icon as premultiplied 8-bit pixels, red first (`0`) or third (`2`). */
  finish(red?: 0 | 2): Buffer
}

/**
 * Paints the band and the name over the app's icon: `icon` is its 512 px premultiplied RGBA, row
 * by row. Only the band's rows change; the rest of the icon, its top-right corner where the Dock
 * shows a count among it, is left exactly as it is.
 */
export function dockLabelPainter(
  icon: Uint8Array,
  name: string,
  colour: DockLabelColour,
): DockLabelPainter {
  const size = DOCK_ICON_SIZE
  const pixels = new Float32Array(icon.length)
  for (let i = 0; i < icon.length; i++) pixels[i] = icon[i]! / 255
  const band = dockLabelBand(colour)
  const ink = dockLabelInk(band)
  const text = layOutDockLabel(name)
  const rows = (from: number, to: number): void => {
    for (let y = Math.max(DOCK_LABEL_BAND_TOP - 1, from); y < Math.min(size, to); y++) {
      const py = y + 0.5
      const inBand = Math.min(1, Math.max(0, py - DOCK_LABEL_BAND_TOP + 0.5))
      if (inBand <= 0) continue
      const textRow = py >= text.top - 1 && py <= text.bottom + 1
      for (let x = 0; x < size; x++) {
        const px = x + 0.5
        const inside = coverage(tileDistance(px, py))
        if (inside <= 0) continue
        const at = (y * size + x) * 4
        blend(pixels, at, band, inside * inBand)
        if (!textRow || px < text.left - 1 || px > text.right + 1) continue
        let nearest = Infinity
        for (const segment of text.segments) {
          const d = toSegment(px, py, segment)
          if (d < nearest) nearest = d
        }
        const k = coverage(nearest - text.half)
        if (k > 0) blend(pixels, at, ink, k * inside)
      }
    }
  }
  const byte = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255)
  const finish = (red: 0 | 2 = 0): Buffer => {
    const out = Buffer.alloc(pixels.length)
    for (let i = 0; i < pixels.length; i += 4) {
      out[i + red] = byte(pixels[i]!)
      out[i + 1] = byte(pixels[i + 1]!)
      out[i + 2 - red] = byte(pixels[i + 2]!)
      out[i + 3] = byte(pixels[i + 3]!)
    }
    return out
  }
  return { rows, finish }
}

/** A labelled icon painted whole, as premultiplied RGBA, row by row. */
export function paintDockLabel(
  icon: Uint8Array,
  name: string,
  colour: DockLabelColour,
): Uint8Array {
  const painter = dockLabelPainter(icon, name, colour)
  painter.rows(0, DOCK_ICON_SIZE)
  return painter.finish()
}

/** What a band's text and band colour measure, for the readability check. */
export function dockLabelColours(colour: DockLabelColour): { band: Rgba; ink: Rgba } {
  const band = dockLabelBand(colour)
  return { band, ink: over(dockLabelInk(band), band) }
}

// ── Following the setting ──────────────────────────────────────────────────────────────────────

/** Rows painted between turns of the main process's event loop: about a millisecond's work. */
const ROWS_PER_SLICE = 8

/** The parts of `nativeImage` the label uses. */
export interface DockLabelImages {
  createFromPath(path: string): NativeImage
  createFromBuffer(bytes: Buffer): NativeImage
  createFromBitmap(
    bitmap: Buffer,
    options: { width: number; height: number; scaleFactor?: number },
  ): NativeImage
}

export interface DockLabelOptions {
  /** The workspace's data folder, where `dock-label.json` lives. */
  readonly folder: string
  /**
   * The workspace's name, as its chooser shows it, or how to read it. A read slower than
   * `withinMs` is given up, and the folder's own name stands.
   */
  readonly workspaceName: string | (() => Promise<string>)
  /** How long the name and the starting colour may take before they are given up (2 s). */
  readonly withinMs?: number
  /**
   * The colour this workspace starts with, worked out among all the known workspaces; read again
   * after every change. When it can't be worked out, the plain hash of the name stands.
   */
  readonly startingColour?: () => Promise<DockLabelColour>
  /** The app's own icon at 1024 px (`icon-1024.png`). */
  readonly iconPath: string
  readonly images: DockLabelImages
  /**
   * The Dock: how an image is shown in it and how the app's own icon comes back. Absent for a
   * launch kept out of the Dock, whose label is kept but never painted.
   */
  readonly dock?: {
    readonly show: (image: NativeImage) => void
    readonly restore: () => void
  }
  /** Waits one turn of the event loop; tests may hold it. */
  readonly turn?: () => Promise<void>
}

export interface DockLabelHost {
  /** The label as the window shows it, once the saved settings are read. */
  read(): Promise<DockLabel>
  /**
   * Saves a change and shows it in the Dock; answers the label as it now is. Changes are saved one
   * at a time, in order. Rejects when the settings can't be saved, leaving the label as it was.
   */
  set(change: DockLabelChange): Promise<DockLabel>
  /** Stops: a paint under way shows nothing. */
  stop(): void
  /** Settles once the latest paint has shown, been given up, or failed. */
  idle(): Promise<void>
}

/**
 * Shows the workspace's label in the Dock now and after every change; turning it off gives the
 * app's own icon back. Painting yields to the event loop between slices of rows, and a newer
 * change or stopping makes an older paint show nothing. A failure leaves the icon as it is.
 */
export function startDockLabel(options: DockLabelOptions): DockLabelHost {
  const turn = options.turn ?? (() => new Promise<void>((resolve) => setImmediate(resolve)))
  let saved: Saved = {}
  let starting: DockLabelColour | undefined
  let latest = 0
  let stopped = false
  let shown: string | null = null
  let work: Promise<void> = Promise.resolve()
  let base: { icon: Uint8Array; red: 0 | 2 } | null | undefined

  const startingNow = async (): Promise<DockLabelColour | undefined> => {
    try {
      return await options.startingColour?.()
    } catch {
      return undefined
    }
  }
  // The name and the starting colour may wait on a slow or odd folder: each is given up after
  // `withinMs`, timed from before anything is read, and a stand-in is used.
  const within = options.withinMs ?? 2000
  const bounded = <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), within)
      timer.unref?.()
    })
    return Promise.race([work().catch(() => fallback), late]).finally(() => clearTimeout(timer))
  }
  let workspaceName =
    typeof options.workspaceName === 'string' ? options.workspaceName : basename(options.folder)
  const askName = options.workspaceName
  const named: Promise<void> =
    typeof askName === 'string'
      ? Promise.resolve()
      : bounded(askName, workspaceName).then((name) => {
          workspaceName = name
        })
  const startingWithin = (): Promise<DockLabelColour | undefined> => bounded(startingNow, undefined)
  const started: Promise<void> = startingWithin().then((colour) => {
    starting = colour
  })
  // The saved settings are read away from the main path. A label whose name and colour are both
  // saved is painted without waiting on the workspace's name or the other workspaces.
  const loaded = (async (): Promise<void> => {
    saved = await readDockLabelFile(options.folder).catch(() => ({}))
  })()
  const settled = (): Promise<unknown> => Promise.all([loaded, named, started])
  const labelNow = (): DockLabel => dockLabelOf(saved, workspaceName, starting)

  const iconPixels = (): { icon: Uint8Array; red: 0 | 2 } | null => {
    if (base !== undefined) return base
    base = null
    const source = options.images.createFromPath(options.iconPath)
    if (source.isEmpty()) return null
    const image =
      source.getSize().width === DOCK_ICON_SIZE
        ? source
        : source.resize({ width: DOCK_ICON_SIZE, height: DOCK_ICON_SIZE, quality: 'best' })
    const red = bitmapRedIndex(options.images)
    const bitmap = image.toBitmap({ scaleFactor: 1 })
    if (red === null || bitmap.length !== DOCK_ICON_SIZE * DOCK_ICON_SIZE * 4) return null
    const icon = new Uint8Array(bitmap.length)
    for (let i = 0; i < bitmap.length; i += 4) {
      icon[i] = bitmap[i + red]!
      icon[i + 1] = bitmap[i + 1]!
      icon[i + 2] = bitmap[i + 2 - red]!
      icon[i + 3] = bitmap[i + 3]!
    }
    base = { icon, red }
    return base
  }

  const paint = async (mine: number): Promise<void> => {
    const alive = (): boolean => !stopped && mine === latest
    const dock = options.dock
    if (!dock) return
    await loaded
    if (saved.on !== false && !(saved.name && saved.colour)) await settled()
    if (!alive()) return
    const label = labelNow()
    const key = label.on ? `${label.name}:${label.colour}` : 'off'
    if (key === shown) return
    if (!label.on) {
      if (shown !== null) dock.restore()
      shown = key
      return
    }
    const pixels = iconPixels()
    if (!pixels) return
    const painter = dockLabelPainter(pixels.icon, label.name, label.colour)
    for (let row = DOCK_LABEL_BAND_TOP - 1; row < DOCK_ICON_SIZE; row += ROWS_PER_SLICE) {
      await turn()
      if (!alive()) return
      painter.rows(row, row + ROWS_PER_SLICE)
    }
    await turn()
    if (!alive()) return
    // 512 pixels at twice the scale: the 256-point icon a Retina Dock shows at its largest.
    const image = options.images.createFromBitmap(painter.finish(pixels.red), {
      width: DOCK_ICON_SIZE,
      height: DOCK_ICON_SIZE,
      scaleFactor: 2,
    })
    if (image.isEmpty()) return
    dock.show(image)
    shown = key
  }

  const schedule = (): void => {
    if (stopped) return
    const mine = ++latest
    work = paint(mine).catch((error: unknown) => {
      console.warn('BroCrew could not put its label on the Dock icon:', error)
    })
  }

  schedule()
  let writes: Promise<unknown> = settled()
  return {
    read: async () => {
      await settled()
      return labelNow()
    },
    set: (change) => {
      const run = writes.then(async () => {
        const next = changedDockLabel(saved, change)
        await writeDockLabelFile(options.folder, next)
        saved = next
        starting = await startingWithin()
        schedule()
        return labelNow()
      })
      writes = run.catch(() => undefined)
      return run
    },
    stop: () => {
      stopped = true
      latest++
    },
    idle: () => work,
  }
}

/** A workspace as the label sees it: its data folder and the name its chooser shows. */
export interface KnownWorkspace {
  readonly path: string
  readonly name: string
}

/**
 * This workspace's starting colour among the other known workspaces: each one's
 * chosen colour is read from its own folder, and the starting colours are shared out so that no
 * two are alike (`defaultDockLabelColours`), in the order of the folders' paths so the same set
 * of workspaces gives the same colours at every launch.
 */
export async function startingColourAmong(
  here: KnownWorkspace,
  others: readonly KnownWorkspace[],
  read: (folder: string) => Promise<Saved> = readDockLabelFile,
): Promise<DockLabelColour> {
  const all = [here, ...others.filter((one) => one.path !== here.path)]
  const ordered = [...all].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const entries: DockLabelWorkspace[] = await Promise.all(
    ordered.map(async (one) => {
      const chosen = (await read(one.path).catch(() => ({}) as Saved)).colour
      return {
        key: one.path,
        name: defaultDockLabelName(one.name),
        ...(chosen ? { chosen } : {}),
      }
    }),
  )
  return defaultDockLabelColours(entries).get(here.path)!
}

/** The most the workspace list may hold, read for the starting colours. */
export const WORKSPACE_LIST_BYTES = 256 * 1024
/** The most a workspace's `workspace.json` may hold, read for its name. */
const WORKSPACE_NAME_BYTES = 4096

/**
 * A workspace's name as its chooser shows it, with its own `workspace.json` read carefully: a
 * regular file only, never through a link, at most 4 KB, without waiting on a pipe.
 */
export function carefulWorkspaceName(folder: string, isDefault: boolean): Promise<string> {
  return workspaceNameOf(folder, isDefault, true, async (one) =>
    ownNameIn(await readSmallJson(one, WORKSPACE_FILE, WORKSPACE_NAME_BYTES)),
  )
}

/**
 * How this workspace's starting colour is worked out among every workspace the list names. The
 * list is read carefully ({@link readSmallJson}, at most {@link WORKSPACE_LIST_BYTES}); one that
 * can't be read that way, or a whole answer slower than `withinMs`, rejects, so the plain hash of
 * the name stands. A list that isn't there names no other workspace.
 */
export function startingColourFromList(options: {
  readonly here: string
  readonly listFile: string
  readonly defaultFolder: string
  readonly withinMs?: number
}): () => Promise<DockLabelColour> {
  const { here, listFile, defaultFolder } = options
  const nameOf = (folder: string): Promise<string> =>
    carefulWorkspaceName(folder, samePath(folder, defaultFolder))
  return () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const tooSlow = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('the workspace list was too slow')),
        options.withinMs ?? 2000,
      )
      timer.unref?.()
    })
    const work = (async (): Promise<DockLabelColour> => {
      const folder = dirname(listFile)
      const said = (await themeDirectory(folder))
        ? await readSmallJson(folder, basename(listFile), WORKSPACE_LIST_BYTES)
        : null
      if (said === undefined && (await listFileIsThere(listFile)))
        throw new Error('the workspace list could not be read')
      const listed = workspacesIn(said ?? {})
        .map((one) => one.path)
        .filter((path) => !samePath(path, here))
      const [self, ...others] = await Promise.all(
        [here, ...listed].map(async (path) => ({ path, name: await nameOf(path) })),
      )
      return startingColourAmong(self!, others)
    })()
    return Promise.race([work, tooSlow]).finally(() => clearTimeout(timer))
  }
}

/** Whether something is at `path` (a link or anything else counts), asked without following it. */
async function listFileIsThere(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}
