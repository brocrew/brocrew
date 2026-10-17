import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  assetLimitProblems,
  assetPathProblem,
  LIMITS,
  sniffAsset,
  type AssetFacts,
} from '../../shared/themes/assets'
import type { PictureSamples } from '../../shared/themes/contrast'
import { resolveTheme, type Theme, type ThemeProblem } from '../../shared/themes/theme'
import { themeBaseName, validateTheme } from '../../shared/themes/validate'
import type { AdmittedThemeAsset } from './asset-protocol'
import {
  readRefused,
  readThemeFile,
  THEME_JSON_BYTES,
  THEME_READ_FILES,
  type ThemeFileFailure,
  type ThemeReadFiles,
} from './files'
import {
  themeFileSizeProblem,
  themeFilesProblem,
  themeFontsProblem,
  themeSizeProblem,
  THEME_PICTURE_FORMAT_PROBLEM,
} from './words'

export const THEME_FOLDER_LIMIT = 513
export const THEME_ASSET_DEPTH = 8

async function readDirectory(path: string): Promise<readonly Dirent[]> {
  const entries: Dirent[] = []
  const directory = await opendir(path)
  for await (const entry of directory) {
    entries.push(entry)
    if (entries.length > LIMITS.files) break
  }
  return entries
}

export type ThemeHostProblem = ThemeFileFailure | 'json-size' | 'json' | 'id' | 'files' | 'decode'

export interface ThemeLoader {
  readonly problem: (kind: ThemeHostProblem) => string
  readonly sample: (bytes: Buffer, facts: AssetFacts) => PictureSamples | null
  readonly readDirectory?: (path: string) => Promise<readonly Dirent[]>
  /** How a theme's files are read; the real file system unless given. */
  readonly readFiles?: ThemeReadFiles
  /** Reads the settings the window doesn't paint yet as well; the app's own host never does. */
  readonly readsHeld?: boolean
  /** Built-ins a theme may extend that a refusal doesn't suggest. */
  readonly hiddenBases?: ReadonlySet<string>
}

export interface LoadedTheme {
  readonly theme: Theme
  readonly resolved: Theme
  readonly root: string
  readonly version: string
  readonly assets: ReadonlyMap<string, AdmittedThemeAsset>
  readonly pictures: ReadonlyMap<string, PictureSamples>
  /** Readability problems of a theme loaded with them as notes. */
  readonly notes?: readonly ThemeProblem[]
}

export type ThemeLoad =
  | { readonly ok: true; readonly loaded: LoadedTheme }
  | {
      readonly ok: false
      readonly problems: readonly ThemeProblem[]
      /**
       * Set when a read the theme needed was refused by the system, or the built-in it extends
       * couldn't be read, so the folder may load later; absent when the folder itself is missing a
       * file or holds something invalid.
       */
      readonly refused?: unknown
    }

/**
 * Built-in themes the app couldn't read right now. A theme that extends one is unresolved rather
 * than invalid: its base may read on a later load.
 */
export interface UnreadBases {
  has(id: string): boolean
}

const NO_UNREAD_BASES: UnreadBases = { has: () => false }

export interface ThemeAssetBytes {
  readonly path: string
  readonly bytes: Buffer
  readonly facts: AssetFacts
}

export function inspectThemeAsset(
  path: string,
  bytes: Buffer,
):
  | { readonly ok: true; readonly facts: AssetFacts }
  | { readonly ok: false; readonly problems: readonly ThemeProblem[]; readonly tooLarge: boolean } {
  const pathProblem = assetPathProblem(path)
  if (pathProblem)
    return { ok: false, problems: [{ at: path, says: pathProblem }], tooLarge: false }
  const sniffed = sniffAsset(bytes)
  if (!sniffed.ok)
    return {
      ok: false,
      problems: [{ at: path, says: sniffed.says.replace('PNG, JPEG or WebP', 'PNG or JPEG') }],
      tooLarge: false,
    }
  const facts = sniffed.facts
  if (facts.type !== 'png' && facts.type !== 'jpeg' && facts.type !== 'woff2')
    return {
      ok: false,
      problems: [{ at: path, says: THEME_PICTURE_FORMAT_PROBLEM }],
      tooLarge: false,
    }
  const maximum = facts.type === 'woff2' ? LIMITS.fontBytes : LIMITS.pictureBytes
  if (facts.bytes > maximum)
    return {
      ok: false,
      problems: [{ at: path, says: themeFileSizeProblem(path, facts.bytes, maximum) }],
      tooLarge: true,
    }
  const tooLarge =
    (facts.width ?? 0) > LIMITS.picturePixels || (facts.height ?? 0) > LIMITS.picturePixels
  const problems = assetLimitProblems(path, facts).map((says) => ({ at: path, says }))
  return problems.length ? { ok: false, problems, tooLarge } : sniffed
}

export function validateThemeBytes(
  raw: unknown,
  assets: readonly ThemeAssetBytes[],
  bases: ReadonlyMap<string, LoadedTheme>,
  loader: ThemeLoader,
  builtIn = false,
  readability: 'refuse' | 'note' = 'refuse',
  unread: UnreadBases = NO_UNREAD_BASES,
):
  | {
      readonly ok: true
      readonly theme: Theme
      readonly resolved: Theme
      readonly pictures: ReadonlyMap<string, PictureSamples>
      readonly version: string
      readonly notes?: readonly ThemeProblem[]
    }
  | {
      readonly ok: false
      readonly problems: readonly ThemeProblem[]
      readonly tooLarge: boolean
      /** Set when the built-in the theme extends couldn't be read right now. */
      readonly refused?: unknown
    } {
  const fonts = assets.filter((asset) => asset.facts.type === 'woff2').length
  if (fonts > LIMITS.fonts)
    return {
      ok: false,
      problems: [{ at: 'assets', says: themeFontsProblem(fonts, LIMITS.fonts) }],
      tooLarge: true,
    }
  const pictures = new Map<string, PictureSamples>()
  const problems: ThemeProblem[] = []
  for (const asset of assets) {
    if (asset.facts.type === 'woff2') continue
    const sampled = loader.sample(asset.bytes, asset.facts)
    if (!sampled) problems.push({ at: asset.path, says: loader.problem('decode') })
    else pictures.set(asset.path, sampled)
  }
  if (problems.length) return { ok: false, problems, tooLarge: false }
  // Without its base the theme can't be judged: its settings, pictures and readability all
  // depend on it.
  const base = themeBaseName(raw)
  if (base !== undefined && !bases.has(base) && unread.has(base))
    return {
      ok: false,
      problems: [{ at: 'extends', says: loader.problem('unreadable') }],
      tooLarge: false,
      refused: new Error(`the built-in theme ${base} could not be read`),
    }
  const inheritedPictures = new Map(pictures)
  for (const [id, base] of bases) {
    for (const [path, samples] of base.pictures) inheritedPictures.set(`@${id}/${path}`, samples)
  }
  const builtIns = new Map([...bases].map(([id, loaded]) => [id, loaded.resolved]))
  const result = validateTheme(raw, {
    assets: new Map(assets.map((asset) => [asset.path, asset.facts])),
    pictures: inheritedPictures,
    builtIns,
    ...(loader.hiddenBases ? { hiddenBases: loader.hiddenBases } : {}),
    builtIn,
    readsHeld: loader.readsHeld === true,
    readability,
  })
  if (!result.ok) return { ...result, tooLarge: false }
  const digest = createHash('sha256').update(JSON.stringify(result.theme))
  for (const asset of [...assets].sort((a, b) => a.path.localeCompare(b.path))) {
    digest.update(asset.path).update('\0').update(createHash('sha256').update(asset.bytes).digest())
  }
  return {
    ok: true,
    theme: result.theme,
    resolved: resolveTheme(result.theme, builtIns.get(result.theme.extends ?? '')),
    pictures,
    version: digest.digest('hex'),
    ...(result.notes?.length ? { notes: result.notes } : {}),
  }
}

export async function loadThemeFolder(
  offeredRoot: string,
  id: string,
  bases: ReadonlyMap<string, LoadedTheme>,
  loader: ThemeLoader,
  builtIn = false,
  readability: 'refuse' | 'note' = 'refuse',
  unread: UnreadBases = NO_UNREAD_BASES,
): Promise<ThemeLoad> {
  const failed = (at: string, kind: ThemeHostProblem, refused?: unknown): ThemeLoad => ({
    ok: false,
    problems: [{ at, says: loader.problem(kind) }],
    ...(refused !== undefined ? { refused } : {}),
  })
  const readFiles = loader.readFiles ?? THEME_READ_FILES
  try {
    const rootStat = await lstat(offeredRoot)
    if (rootStat.isSymbolicLink()) return failed('theme.json', 'link')
    if (!rootStat.isDirectory()) return failed('theme.json', 'unreadable')
    const root = await realpath(offeredRoot)
    if (root !== resolve(offeredRoot)) return failed('theme.json', 'link')
    const realRootStat = await lstat(root)
    if (realRootStat.dev !== rootStat.dev || realRootStat.ino !== rootStat.ino)
      return failed('theme.json', 'changed')
    const document = await readThemeFile(root, 'theme.json', THEME_JSON_BYTES, readFiles)
    if (!document.ok)
      return document.failure === 'too-large'
        ? {
            ok: false,
            problems: [
              {
                at: 'theme.json',
                says: themeFileSizeProblem('theme.json', document.size, document.maximum),
              },
            ],
          }
        : failed(
            'theme.json',
            document.failure,
            'refused' in document ? document.refused : undefined,
          )
    let raw: unknown
    try {
      raw = JSON.parse(document.bytes.toString('utf8'))
    } catch {
      return failed('theme.json', 'json')
    }
    if (typeof raw !== 'object' || raw === null || !('id' in raw) || raw.id !== id)
      return failed('id', 'id')
    const files: ThemeAssetBytes[] = []
    let folders = 0
    let total = document.bytes.length
    const walk = async (
      directory: string,
      prefix: string,
      depth: number,
    ): Promise<ThemeLoad | null> => {
      if (folders >= THEME_FOLDER_LIMIT) return failed(prefix, 'files')
      folders++
      const stat = await lstat(directory)
      if (stat.isSymbolicLink()) return failed(prefix, 'link')
      if (!stat.isDirectory() || depth > THEME_ASSET_DEPTH) return failed(prefix, 'files')
      const entries = await (loader.readDirectory ?? readDirectory)(directory)
      if (entries.length > LIMITS.files) return failed(prefix, 'files')
      for (const entry of entries) {
        const path = `${prefix}/${entry.name}`
        const at = join(directory, entry.name)
        const one = await lstat(at)
        if (one.isSymbolicLink()) return failed(path, 'link')
        if (one.isDirectory()) {
          const result = await walk(at, path, depth + 1)
          if (result) return result
        } else {
          if (files.length >= LIMITS.files)
            return {
              ok: false,
              problems: [{ at: path, says: themeFilesProblem(files.length + 1, LIMITS.files) }],
            }
          const file = await readThemeFile(root, path, LIMITS.pictureBytes, readFiles)
          if (!file.ok)
            return file.failure === 'too-large'
              ? {
                  ok: false,
                  problems: [
                    { at: path, says: themeFileSizeProblem(path, file.size, file.maximum) },
                  ],
                }
              : failed(path, file.failure, 'refused' in file ? file.refused : undefined)
          total += file.bytes.length
          if (total > LIMITS.themeBytes)
            return {
              ok: false,
              problems: [{ at: path, says: themeSizeProblem(total, LIMITS.themeBytes, false) }],
            }
          const inspected = inspectThemeAsset(path, file.bytes)
          if (!inspected.ok) return inspected
          files.push({ path, bytes: file.bytes, facts: inspected.facts })
        }
      }
      return null
    }
    const assetsRoot = join(root, 'assets')
    let hasAssets = true
    try {
      await lstat(assetsRoot)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
        return failed('assets', 'unreadable', readRefused(error) ? error : undefined)
      hasAssets = false
    }
    if (hasAssets) {
      const result = await walk(assetsRoot, 'assets', 0)
      if (result) return result
    }
    const checked = validateThemeBytes(raw, files, bases, loader, builtIn, readability, unread)
    if (!checked.ok) return checked
    const finalRootStat = await lstat(offeredRoot)
    if (
      finalRootStat.isSymbolicLink() ||
      finalRootStat.dev !== rootStat.dev ||
      finalRootStat.ino !== rootStat.ino
    )
      return failed('theme.json', 'changed')
    const assets = new Map<string, AdmittedThemeAsset>()
    for (const file of files) {
      assets.set(file.path, {
        root,
        path: file.path,
        facts: file.facts,
        digest: createHash('sha256').update(file.bytes).digest('hex'),
        version: checked.version,
      })
    }
    return { ok: true, loaded: { ...checked, root, assets } }
  } catch (error) {
    return failed('theme.json', 'unreadable', readRefused(error) ? error : undefined)
  }
}
