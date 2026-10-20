import fs from 'node:fs'
import path from 'node:path'
import { PRIVATE } from './privateModes.js'
export const MAX_UPLOAD_FILES = 10
export const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024
export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024
export const MAX_DOWNLOAD_NAME = 120
const MIME: Record<string, string> = {
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.xml': 'application/xml',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
export function mimeFor(fileName: string): string {
  return MIME[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream'
}
export const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
export function sanitizeDownloadName(
  suggested: unknown,
  platform: NodeJS.Platform = process.platform,
): string {
  const raw = typeof suggested === 'string' ? suggested : ''
  const base = raw.split(/[\\/]/).pop() ?? ''
  let name = base
    .normalize('NFKC')
    .replace(/[^\w .-]/g, '_')
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '')
  if (name === '') name = 'download'
  if (platform === 'win32' && WINDOWS_DEVICE.test(name)) name = `_${name}`
  if (name.length > MAX_DOWNLOAD_NAME) {
    const ext = path.extname(name).slice(0, 20)
    name = name.slice(0, MAX_DOWNLOAD_NAME - ext.length) + ext
  }
  return name
}
export function uniqueName(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 1; i < 10000; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!exists(candidate)) return candidate
  }
  throw new Error('no free file name')
}
function lexists(p: string): boolean {
  try {
    fs.lstatSync(p)
    return true
  } catch {
    return false
  }
}
export function reserveFile(
  dir: string,
  name: string,
): {
  fd: number
  target: string
} {
  const reserved: Array<{
    fd: number
    target: string
  }> = []
  uniqueName(name, (candidate) => {
    const target = path.join(dir, candidate)
    if (process.platform === 'win32' && lexists(target)) return true
    try {
      reserved.push({ fd: fs.openSync(target, 'wx', PRIVATE.file), target })
      return false
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return true
      throw e
    }
  })
  return reserved[0]
}
export function dayFolder(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}
