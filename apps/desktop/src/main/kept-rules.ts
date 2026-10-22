import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import {
  CODEX_EXEC_POLICY_RULES,
  MAX_SETTINGS_BYTES,
  aStagingName,
  createFreshFile,
  forgetToolApproval,
  isStillTheFileOpened,
  keptToolApprovals,
  keptToolApprovalsFile,
  persistedRulesFile,
  type KeptToolApproval,
} from '@brobot2/runtime'
import { providerValue, type Provider } from '@brobot2/shared'
import type { KeptRule, KeptRuleRemoved, KeptRules, KeptRulesFile } from '../shared/runtime-ipc'

/**
 * The rules an *Always allow* kept beyond its conversation, where each provider keeps them, and the
 * one way to remove one (the Providers page's kept rules).
 *
 * - **Claude** keeps an allow rule in a settings file's `permissions.allow`, written `Tool` or
 *   `Tool(specifier)` (Claude Code's settings and permissions docs). Listed: for every folder a Claude
 *   conversation here worked in, the project's local settings, found as a launch finds them and
 *   handed in already found (`settings-locations.ts`: finding one runs git, never on the main
 *   thread); and each agent home's `settings.json`.
 * - **Codex** keeps a command's in each agent's home, one `prefix_rule(pattern=[…], decision="allow")`
 *   line per rule ({@link CODEX_EXEC_POLICY_RULES}); an MCP tool's in this app's own file beside it
 *   ({@link keptToolApprovals}). ⚠️ Codex appends to its file under a lock this process cannot take,
 *   so a rule Codex keeps in the instant a removal rewrites that file can be lost with it.
 *
 * ⚑ Only allow rules are listed: they are what *Always allow* keeps. ⛔ A removal edits only the
 * file it names, and only a rule this list holds when it is asked — anything else is refused.
 * ⛔ And never a file in the person's own provider folders (a conversation run in the home folder
 * keeps its project settings there): those are listed, and a rule in them is removed by hand.
 */

/** Where to look: the local settings of the folders Claude conversations worked in, and every agent's home. */
export interface WhereRulesAreKept {
  readonly claudeProjectFiles: readonly string[]
  readonly homes: readonly { readonly provider: Provider; readonly path: string }[]
  /** The person's own provider folders, which this app reads from and never writes to. */
  readonly personsOwn: readonly string[]
}

/** Every provider's kept rules, file by file; a file that keeps none is left out. */
export function readKeptRules(where: WhereRulesAreKept): KeptRules {
  const homesOf = (provider: Provider): string[] =>
    where.homes.filter((home) => home.provider === provider).map((home) => home.path)
  const claudeFiles = [
    ...new Set([...homesOf('claude').map(persistedRulesFile), ...where.claudeProjectFiles]),
  ]
  const marked = (file: KeptRulesFile): KeptRulesFile =>
    inThePersonsOwn(file.file, where.personsOwn) ? { ...file, notEditedHere: PERSONS_OWN } : file
  return {
    claude: claudeFiles.flatMap((file) => claudeRulesIn(file) ?? []).map(marked),
    codex: homesOf('codex')
      .flatMap((home) =>
        [codexRulesIn(join(home, CODEX_EXEC_POLICY_RULES)), codexApprovalsIn(home)].filter(
          (one): one is KeptRulesFile => one !== null,
        ),
      )
      .map(marked),
  }
}

const PERSONS_OWN = 'it is in your own provider folder, which BroCrew does not write to'

/** Whether a file is in one of the person's own provider folders, read through any link. */
function inThePersonsOwn(file: string, personsOwn: readonly string[]): boolean {
  const real = realOrResolved(file)
  return personsOwn.some((folder) => {
    const root = realOrResolved(folder)
    return real === root || real.startsWith(`${root}${sep}`)
  })
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

const NO_LONGER_KEPT = 'That rule is no longer kept there.'

/**
 * Remove one kept rule from its file. ⛔ Only a rule the list holds now, in the file it names: the
 * window's word is checked against a fresh reading, never trusted. ⛔ Never throws: a refusal says
 * why.
 */
export function removeKeptRule(
  where: WhereRulesAreKept,
  input: { readonly provider: Provider; readonly file: string; readonly kept: string },
  platform: NodeJS.Platform = process.platform,
): KeptRuleRemoved {
  const listed = readKeptRules(where)[input.provider].find((one) => one.file === input.file)
  if (listed === undefined || !listed.rules.some((one) => one.kept === input.kept)) {
    return { removed: false, why: NO_LONGER_KEPT }
  }
  if (listed.notEditedHere !== undefined) return { removed: false, why: listed.notEditedHere }
  try {
    if (
      providerValue(input.provider, { claude: false, codex: true }) &&
      input.file === keptToolApprovalsFile(dirname(input.file))
    ) {
      forgetToolApproval(dirname(input.file), JSON.parse(input.kept) as KeptToolApproval)
    } else if (providerValue(input.provider, { claude: false, codex: true })) {
      rewrite(
        input.file,
        (text) => {
          const lines = text.split('\n')
          const left = lines.filter((line) => withoutCr(line) !== input.kept)
          if (left.length === lines.length) throw new Error(NO_LONGER_KEPT)
          return left.join('\n')
        },
        platform,
      )
    } else {
      rewrite(input.file, (text) => withoutAllowRule(text, input.kept), platform)
    }
    return { removed: true }
  } catch (error) {
    return { removed: false, why: error instanceof Error ? error.message : String(error) }
  }
}

/** A Claude permission rule, as Claude Code's settings spell one: `Tool`, or `Tool(specifier)`. */
function claudeRule(kept: string): KeptRule['rule'] {
  const open = kept.indexOf('(')
  return open > 0 && kept.endsWith(')')
    ? { kind: 'tool', tool: kept.slice(0, open), content: kept.slice(open + 1, -1) }
    : { kind: 'tool', tool: kept }
}

/** A settings file's `permissions.allow`, or `null` when there is none. */
function allowOf(parsed: unknown): string[] | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const permissions = (parsed as { permissions?: unknown }).permissions
  if (typeof permissions !== 'object' || permissions === null) return null
  const allow = (permissions as { allow?: unknown }).allow
  return Array.isArray(allow) ? allow.filter((one): one is string => typeof one === 'string') : null
}

function claudeRulesIn(file: string): KeptRulesFile | null {
  const read = readSmall(file)
  if (read.state === 'absent') return null
  if (read.state === 'unreadable') return { file, rules: [], unreadable: read.why }
  let parsed: unknown
  try {
    parsed = JSON.parse(read.text)
  } catch {
    return { file, rules: [], unreadable: 'it is not JSON' }
  }
  const allow = [...new Set(allowOf(parsed) ?? [])]
  return allow.length === 0
    ? null
    : { file, rules: allow.map((kept) => ({ kept, rule: claudeRule(kept) })) }
}

/** One line Codex writes for a kept command: its prefix, as a JSON list of words. */
const PREFIX_RULE = /^prefix_rule\(pattern=(\[.*\]), decision="allow"\)$/

/** A line as written on any system: a Windows line ending is not part of it. */
const withoutCr = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line)

function codexRulesIn(file: string): KeptRulesFile | null {
  const read = readSmall(file)
  if (read.state === 'absent') return null
  if (read.state === 'unreadable') return { file, rules: [], unreadable: read.why }
  const lines = [...new Set(read.text.split('\n').map(withoutCr))]
  const rules = lines.flatMap((line): KeptRule[] => {
    const pattern = PREFIX_RULE.exec(line)?.[1]
    if (pattern === undefined) return []
    try {
      const prefix: unknown = JSON.parse(pattern)
      return Array.isArray(prefix) && prefix.every((word) => typeof word === 'string')
        ? [{ kept: line, rule: { kind: 'command-prefix', prefix: prefix as string[] } }]
        : []
    } catch {
      return []
    }
  })
  return rules.length === 0 ? null : { file, rules }
}

function codexApprovalsIn(home: string): KeptRulesFile | null {
  const kept = keptToolApprovals(home)
  return kept.length === 0
    ? null
    : {
        file: keptToolApprovalsFile(home),
        rules: kept.map((one) => ({
          kept: JSON.stringify({ server: one.server, url: one.url, tool: one.tool }),
          rule: { kind: 'tool', tool: one.tool, server: one.server },
        })),
      }
}

/** A settings file's text with one allow rule gone, and everything else in it as it was. */
function withoutAllowRule(text: string, kept: string): string {
  const parsed: unknown = JSON.parse(text)
  const allow = allowOf(parsed)
  if (allow === null || !allow.includes(kept)) throw new Error(NO_LONGER_KEPT)
  const permissions = (parsed as { permissions: { allow: unknown[] } }).permissions
  permissions.allow = permissions.allow.filter((one) => one !== kept)
  return `${JSON.stringify(parsed, null, 2)}\n`
}

type Read =
  | { readonly state: 'absent' }
  | { readonly state: 'read'; readonly text: string }
  | { readonly state: 'unreadable'; readonly why: string }

/**
 * A file's text, read only when it is a regular file no larger than a settings file a person's
 * choices make — opened without blocking, so a pipe planted at the name cannot hang the read.
 */
function readSmall(file: string): Read {
  let fd: number | null = null
  try {
    try {
      fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' }
      throw error
    }
    const stat = fstatSync(fd)
    if (!stat.isFile()) return { state: 'unreadable', why: 'it is not a regular file' }
    if (stat.size > MAX_SETTINGS_BYTES) return { state: 'unreadable', why: 'it is too large' }
    return { state: 'read', text: readAll(fd, stat.size) }
  } catch (error) {
    return { state: 'unreadable', why: error instanceof Error ? error.message : String(error) }
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function readAll(fd: number, size: number): string {
  const buffer = Buffer.alloc(size)
  let read = 0
  while (read < size) {
    const got = readSync(fd, buffer, read, size - read, read)
    if (got === 0) break
    read += got
  }
  return buffer.subarray(0, read).toString('utf8')
}

/**
 * The file rewritten from what it holds now, keeping its permissions: staged under a fresh name and
 * renamed over it, so a reader never sees half of it.
 *
 * ⛔ **Never through a link**, its own or its folder's: the file is opened refusing to follow one, so
 * nothing a link points at is read or rewritten here. On Windows, whose opens follow a link, the
 * opened file must still be the one at its name. ⛔ **Never a file with a second name** (a hard
 * link): renaming over one name would part it from the other.
 */
function rewrite(file: string, change: (text: string) => string, platform: NodeJS.Platform): void {
  if (lstatSync(dirname(file)).isSymbolicLink()) {
    throw new Error(`${dirname(file)} is a link, so ${file} was not rewritten`)
  }
  let fd: number
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error(`${file} is a link, so it was not rewritten`, { cause: error })
    }
    throw error
  }
  let text: string
  let mode: number
  try {
    if (platform === 'win32' && !isStillTheFileOpened(file, fd)) {
      throw new Error(`${file} is a link or was just replaced, so it was not rewritten`)
    }
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error(`${file} is not a regular file, so it was not rewritten`)
    if (stat.nlink > 1) throw new Error(`${file} has another name too, so it was not rewritten`)
    if (stat.size > MAX_SETTINGS_BYTES) throw new Error(`${file} is too large to rewrite`)
    text = readAll(fd, stat.size)
    mode = stat.mode & 0o7777
  } finally {
    closeSync(fd)
  }
  const next = change(text)
  const staged = aStagingName(file)
  const out = createFreshFile(staged)
  try {
    try {
      writeSync(out, next)
      fchmodSync(out, mode)
    } finally {
      closeSync(out)
    }
    renameSync(staged, file)
  } catch (error) {
    try {
      unlinkSync(staged)
    } catch {
      // best effort — the reason below is what matters
    }
    throw error
  }
}
