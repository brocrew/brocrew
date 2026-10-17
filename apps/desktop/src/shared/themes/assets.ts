/**
 * A theme's files: what kind each one really is (read from its first bytes, never its name), its
 * size in pixels, and whether it moves. The host reads each file and hands these facts to
 * `validateTheme`; nothing here touches the disk.
 */

/**
 * Pictures a theme may use, and fonts. WebP is left out because the host can't sample its colours
 * for the contrast check.
 */
export type AssetType = 'png' | 'jpeg' | 'woff2'

export interface AssetFacts {
  readonly type: AssetType
  readonly bytes: number
  /** Pixels; absent for fonts. */
  readonly width?: number
  readonly height?: number
  /** An animated PNG. */
  readonly animated?: boolean
}

/** What a file turned out to be, or why it can't be used. */
export type Sniffed =
  { readonly ok: true; readonly facts: AssetFacts } | { readonly ok: false; readonly says: string }

export const LIMITS = {
  pictureBytes: 4 * 1024 * 1024,
  picturePixels: 4096,
  fontBytes: 1024 * 1024,
  fonts: 4,
  themeBytes: 12 * 1024 * 1024,
  files: 64,
} as const

/** `assets/…` with plain names: no `..`, no scheme, no leading slash. */
const ASSET_PATH = /^assets\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/

/**
 * Whether a reference names a file inside the theme's own `assets/` folder; if not, the sentence
 * that says why.
 */
export function assetPathProblem(ref: unknown): string | null {
  if (typeof ref !== 'string' || ref === '')
    return 'it should name a file in the theme’s assets folder'
  const lower = ref.toLowerCase()
  if (/^[a-z][a-z0-9+.-]*:/.test(lower) || lower.startsWith('//')) {
    return lower.startsWith('http') || lower.startsWith('//')
      ? `“${short(ref)}” is a web address. Pictures and fonts must be files in the theme’s assets folder`
      : `“${short(ref)}” points outside the theme. Pictures and fonts must be files in the theme’s assets folder`
  }
  if (ref.split('/').includes('..') || ref.startsWith('/') || ref.includes('\\')) {
    return `“${short(ref)}” points outside the theme. Pictures and fonts must be files in the theme’s assets folder`
  }
  if (ref.length > 120 || !ASSET_PATH.test(ref)) {
    return `“${short(ref)}” isn’t a file name the app accepts: use assets/ followed by letters, digits, dots, hyphens and underscores`
  }
  return null
}

const short = (s: string): string => (s.length > 48 ? `${s.slice(0, 45)}…` : s)

const ascii = (b: Uint8Array, at: number, n: number): string =>
  String.fromCharCode(...b.subarray(at, at + n))
const u32be = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0
const u16be = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!

function png(b: Uint8Array): Sniffed {
  if (b.length < 33 || ascii(b, 12, 4) !== 'IHDR') return broken('PNG')
  let animated = false
  for (let at = 8; at + 8 <= b.length;) {
    const length = u32be(b, at)
    const type = ascii(b, at + 4, 4)
    if (type === 'acTL') animated = true
    if (type === 'IDAT' || type === 'IEND') break
    at += 12 + length
  }
  return ok({ type: 'png', bytes: b.length, width: u32be(b, 16), height: u32be(b, 20), animated })
}

function jpeg(b: Uint8Array): Sniffed {
  for (let at = 2; at + 9 < b.length;) {
    if (b[at] !== 0xff) return broken('JPEG')
    const marker = b[at + 1]!
    if (
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01 ||
      marker === 0xff
    ) {
      at += marker === 0xff ? 1 : 2
      continue
    }
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) {
      return ok({
        type: 'jpeg',
        bytes: b.length,
        height: u16be(b, at + 5),
        width: u16be(b, at + 7),
        animated: false,
      })
    }
    if (marker === 0xd9 || marker === 0xda) break
    at += 2 + u16be(b, at + 2)
  }
  return broken('JPEG')
}

const ok = (facts: AssetFacts): Sniffed => ({ ok: true, facts })
const broken = (kind: string): Sniffed => ({
  ok: false,
  says: `it starts like a ${kind} file but can’t be read as one`,
})

/** Reads what a file really is from its first bytes. */
export function sniffAsset(b: Uint8Array): Sniffed {
  if (b.length >= 8 && u32be(b, 0) === 0x89504e47 && u32be(b, 4) === 0x0d0a1a0a) return png(b)
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpeg(b)
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    return { ok: false, says: "WebP pictures aren't supported yet. Use PNG or JPEG" }
  }
  if (b.length >= 4 && ascii(b, 0, 4) === 'wOF2') return ok({ type: 'woff2', bytes: b.length })
  if (b.length >= 6 && /^GIF8[79]a$/.test(ascii(b, 0, 6))) {
    return { ok: false, says: "GIF pictures aren't supported. Use PNG or JPEG" }
  }
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(b.subarray(0, 1024))
    .trimStart()
    .toLowerCase()
  if (
    head.startsWith('<svg') ||
    (head.startsWith('<?xml') && head.includes('<svg')) ||
    head.includes('<svg')
  ) {
    return { ok: false, says: "SVG pictures aren't supported yet. Use PNG or JPEG" }
  }
  if (b.length >= 4 && ['wOFF', 'OTTO'].includes(ascii(b, 0, 4))) {
    return { ok: false, says: 'only woff2 fonts are accepted' }
  }
  return { ok: false, says: 'it isn’t a PNG or JPEG picture or a woff2 font' }
}

/** Problems with one file's facts against the limits, as sentences. */
export function assetLimitProblems(path: string, facts: AssetFacts): string[] {
  const problems: string[] = []
  const mb = (n: number): string => `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`
  if (facts.type === 'woff2') {
    if (facts.bytes > LIMITS.fontBytes)
      problems.push(`${path} is ${mb(facts.bytes)}; a font can be up to 1 MB.`)
    return problems
  }
  if (facts.bytes > LIMITS.pictureBytes)
    problems.push(`${path} is ${mb(facts.bytes)}; a picture can be up to 4 MB.`)
  const w = facts.width ?? 0
  const h = facts.height ?? 0
  if (w > LIMITS.picturePixels || h > LIMITS.picturePixels) {
    problems.push(`${path} is ${w}×${h} pixels; a picture can be up to 4096 pixels a side.`)
  }
  if (w === 0 || h === 0) problems.push(`${path} has no pixels.`)
  if (facts.animated) {
    problems.push(
      `${path} is animated. Pictures must be still; movement comes from the built-in effects.`,
    )
  }
  return problems
}
