import fs from 'node:fs'
import { privateFolder } from './privatePaths.js'
import path from 'node:path'
export interface ExtensionInfo {
  id: string
  name: string
  version: string
  enabled: boolean
  unpacked: boolean
}
export const EXTENSION_ID = /^[a-p]{32}$/
const MAX_JSON_BYTES = 20 * 1024 * 1024
const MAX_MANIFEST_BYTES = 1024 * 1024
const BUILTIN_LOCATIONS = new Set([5, 10])
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const printable = (v: unknown, max: number): string =>
  typeof v === 'string'
    ? v
        .replace(/[^\x20-\x7e\u00a0-\uffff]/g, '')
        .trim()
        .slice(0, max)
    : ''
function readJsonFile(file: string, cap: number, profileDir?: string): unknown {
  if (profileDir) privateFolder(profileDir, path.dirname(file))
  try {
    const st = fs.lstatSync(file)
    if (!st.isFile() || st.size > cap) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
function localized(
  dir: string,
  manifest: Record<string, unknown>,
  raw: string,
  profileDir?: string,
): string | null {
  const m = /^__MSG_(\w+)__$/.exec(raw)
  if (!m) return raw
  const locale =
    typeof manifest.default_locale === 'string' && /^[\w-]{1,20}$/.test(manifest.default_locale)
      ? manifest.default_locale
      : 'en'
  const messages = readJsonFile(
    path.join(dir, '_locales', locale, 'messages.json'),
    MAX_MANIFEST_BYTES,
    profileDir,
  )
  if (!isObject(messages)) return null
  const wanted = m[1].toLowerCase()
  const key = Object.keys(messages).find((k) => k.toLowerCase() === wanted)
  const entry = key !== undefined ? messages[key] : undefined
  return isObject(entry) && typeof entry.message === 'string' ? entry.message : null
}
function describe(
  dir: string,
  id: string,
  pref: Record<string, unknown> | undefined,
  unpacked: boolean,
  profileDir?: string,
): ExtensionInfo | null {
  const manifest = readJsonFile(path.join(dir, 'manifest.json'), MAX_MANIFEST_BYTES, profileDir)
  if (!isObject(manifest)) return null
  const rawName = typeof manifest.name === 'string' ? manifest.name : ''
  const name = printable(localized(dir, manifest, rawName, profileDir) ?? '', 100) || id
  const reasons = pref && typeof pref.disable_reasons === 'number' ? pref.disable_reasons : 0
  const enabled = pref !== undefined && pref.state !== 0 && reasons === 0
  return { id, name, version: printable(manifest.version, 40), enabled, unpacked }
}
export function listExtensions(profileDir: string): ExtensionInfo[] {
  const settings: Record<string, Record<string, unknown>> = {}
  for (const file of ['Preferences', 'Secure Preferences']) {
    const root = readJsonFile(path.join(profileDir, 'Default', file), MAX_JSON_BYTES, profileDir)
    const ext = isObject(root) && isObject(root.extensions) ? root.extensions : null
    const map = ext && isObject(ext.settings) ? ext.settings : null
    if (map)
      for (const [id, v] of Object.entries(map))
        if (EXTENSION_ID.test(id) && isObject(v)) settings[id] = { ...settings[id], ...v }
  }
  const found = new Map<string, ExtensionInfo>()
  const root = privateFolder(profileDir, path.join(profileDir, 'Default', 'Extensions'))
  let ids: string[] = []
  try {
    ids = fs.readdirSync(root).filter((n) => EXTENSION_ID.test(n))
  } catch {
    /* Continue without this optional result. */
  }
  for (const id of ids) {
    const pref = settings[id]
    if (pref && typeof pref.location === 'number' && BUILTIN_LOCATIONS.has(pref.location)) continue
    let versions: string[]
    try {
      versions = fs
        .readdirSync(privateFolder(profileDir, path.join(root, id)))
        .filter((v) => /^[\w.-]{1,60}$/.test(v))
        .sort()
    } catch {
      continue
    }
    const latest = versions[versions.length - 1]
    if (latest === undefined) continue
    const info = describe(path.join(root, id, latest), id, pref, false, profileDir)
    if (info) found.set(id, info)
  }
  for (const [id, pref] of Object.entries(settings)) {
    if (found.has(id) || typeof pref.path !== 'string' || !path.isAbsolute(pref.path)) continue
    if (typeof pref.location === 'number' && BUILTIN_LOCATIONS.has(pref.location)) continue
    const info = describe(pref.path, id, pref, true)
    if (info) found.set(id, { ...info, unpacked: true })
  }
  return [...found.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  )
}
export function webStoreId(source: string): string | null {
  const s = source.trim()
  if (EXTENSION_ID.test(s)) return s
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (
    u.protocol !== 'https:' ||
    (u.hostname !== 'chromewebstore.google.com' && u.hostname !== 'chrome.google.com')
  )
    return null
  return u.pathname.split('/').find((seg) => EXTENSION_ID.test(seg)) ?? null
}
export const webStoreUrl = (id: string): string => `https://chromewebstore.google.com/detail/${id}`
