import fs from 'node:fs'
import { privateFolder } from './privatePaths.js'
import path from 'node:path'
import { ToolError } from './toolError.js'
import { PRIVATE } from './privateModes.js'
export type SettingKind = 'bool' | 'languages' | 'content'
export const SETTINGS: Readonly<Record<string, SettingKind>> = {
  'download.prompt_for_download': 'bool',
  'intl.accept_languages': 'languages',
  'translate.enabled': 'bool',
  credentials_enable_service: 'bool',
  'browser.enable_spellchecking': 'bool',
  'profile.default_content_setting_values.notifications': 'content',
  'profile.default_content_setting_values.geolocation': 'content',
  'profile.default_content_setting_values.popups': 'content',
  'profile.default_content_setting_values.automatic_downloads': 'content',
}
export const SETTING_KEYS = Object.keys(SETTINGS)
const MAX_PREFS_BYTES = 20 * 1024 * 1024
const LANGUAGES =
  /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?(?:,[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?){0,9}$/
export function prefsFile(profileDir: string): string {
  return path.join(privateFolder(profileDir, path.join(profileDir, 'Default')), 'Preferences')
}
export function validateSetting(key: string, value: unknown): boolean | string | number {
  const kind = Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : undefined
  if (!kind) throw new ToolError('this setting is not on the allowlist')
  if (kind === 'bool') {
    if (typeof value !== 'boolean') throw new ToolError('this setting takes true or false')
    return value
  }
  if (kind === 'content') {
    if (value !== 1 && value !== 2) throw new ToolError('this setting takes 1 (allow) or 2 (block)')
    return value
  }
  if (typeof value !== 'string' || value.length > 100 || !LANGUAGES.test(value))
    throw new ToolError(
      'this setting takes language codes like "en-US,en" (at most 100 characters)',
    )
  return value
}
function readJson(file: string): Record<string, unknown> | null {
  let text: string
  try {
    const st = fs.lstatSync(file)
    if (!st.isFile() || st.size > MAX_PREFS_BYTES)
      throw new ToolError('the profile preferences cannot be read')
    text = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if (e instanceof ToolError) throw e
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new ToolError('the profile preferences cannot be read')
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      throw new Error('shape')
    return parsed as Record<string, unknown>
  } catch {
    throw new ToolError('the profile preferences are not valid JSON')
  }
}
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
function getPath(root: Record<string, unknown>, dotted: string): unknown {
  let cur: unknown = root
  for (const part of dotted.split('.')) {
    if (!isObject(cur) || !Object.hasOwn(cur, part)) return null
    cur = cur[part]
  }
  return cur ?? null
}
export function readSettings(profileDir: string): Record<string, unknown> {
  const root = readJson(prefsFile(profileDir)) ?? {}
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, getPath(root, k)]))
}
function setPath(root: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split('.')
  let cur = root
  for (const part of parts.slice(0, -1)) {
    const next = Object.hasOwn(cur, part) ? cur[part] : undefined
    if (isObject(next)) cur = next
    else {
      const made: Record<string, unknown> = {}
      cur[part] = made
      cur = made
    }
  }
  cur[parts[parts.length - 1]] = value
}
const ALSO_WRITTEN: Readonly<Record<string, readonly string[]>> = {
  'intl.accept_languages': ['intl.selected_languages'],
}
export function writeSetting(
  profileDir: string,
  key: string,
  value: boolean | string | number,
): void {
  validateSetting(key, value)
  const file = prefsFile(profileDir)
  const root = readJson(file) ?? {}
  setPath(root, key, value)
  for (const also of ALSO_WRITTEN[key] ?? []) setPath(root, also, value)
  privateFolder(profileDir, path.dirname(file), true)
  const tmp = path.join(path.dirname(file), `.Preferences.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, JSON.stringify(root), { mode: PRIVATE.file })
  fs.renameSync(tmp, file)
}
