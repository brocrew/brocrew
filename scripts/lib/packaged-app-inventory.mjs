import { closeSync, openSync, readdirSync, readSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Every file and folder under `dir`: its path relative to `dir`, spelled with `/`. */
export function entriesUnder(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true })
  } catch {
    return []
  }
  return entries.map((entry) => ({
    path: relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'),
    isFile: entry.isFile(),
  }))
}

/** Every file and folder packed in an asar archive, read from its header — nothing is unpacked. */
export function asarEntries(archive) {
  const fd = openSync(archive, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const length = head.readUInt32LE(12)
    const json = Buffer.alloc(length)
    readSync(fd, json, 0, length, 16)
    const entries = []
    const walk = (node, at) => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const path = at === '' ? name : `${at}/${name}`
        entries.push({ path, isFile: child.files === undefined })
        walk(child, path)
      }
    }
    walk(JSON.parse(json.toString('utf8')), '')
    return entries
  } finally {
    closeSync(fd)
  }
}

/** What of Claude Code `entries` hold: each `claude` program, and each Agent SDK platform package once. */
export function claudeCodeIn(entries) {
  const found = new Set()
  for (const { path, isFile } of entries) {
    const parts = path.split('/')
    const at = parts.findIndex(
      (part, index) => parts[index - 1] === '@anthropic-ai' && part.startsWith('claude-agent-sdk-'),
    )
    if (at !== -1) found.add(parts.slice(0, at + 1).join('/'))
    else if (isFile && /^claude(\.exe)?$/i.test(parts.at(-1))) found.add(path)
  }
  return [...found]
}

/** `-1`, `0` or `1` as `a` is older than, the same as or newer than `b`, part by part. */
export function versionOrder(a, b) {
  const parts = (text) => text.split(/[.+-]/, 3).map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let at = 0; at < 3; at += 1) {
    if (x[at] !== y[at]) return Math.sign(x[at] - y[at])
  }
  return 0
}
