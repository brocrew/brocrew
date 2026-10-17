import { closeSync, constants, fstatSync, lstatSync, readSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { openNotThroughALink } from '@brobot2/runtime/provider-home'
import { BUILT_IN_SKILL_NAMES, type BuiltInSkillName } from '../../shared/built-in-skills'
import type { TextPackRefusal } from '../../shared/text-pack'
import type { FactoryTextGiven } from '../runtime/factory-text'
import { skillDigest, verifyBuiltInSkills, type VerifiedBuiltInSkills } from './built-in-catalogue'

/**
 * The launch environment's name for a folder of draft texts. Only a build run from its source reads
 * it, so a person's installed app and every instance started without it keep the shipped texts.
 */
export const TEXT_PACK_VARIABLE = 'BROCREW_TEXT_PACK'

/** The largest file a pack may hold, the bound a built-in skill's body has. */
const MOST_BYTES = 65_536

/** The texts a pack gives in place of the shipped ones, as the shipped ones are shaped. */
export interface TextPack {
  readonly folder: string
  /** The core every agent gets, one paragraph per item. */
  readonly core: readonly string[]
  /** What BroBot gets after the core. */
  readonly coordinator: readonly string[]
  /** What a service gets after the core, or `null` where the pack has none. */
  readonly service: readonly string[] | null
  readonly skills: VerifiedBuiltInSkills
}

export type TextPackRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'read'; readonly pack: TextPack }
  | { readonly kind: 'refused'; readonly folder: string; readonly refusal: TextPackRefusal }

/** A file's text, or why there is none; anything else unreadable throws. */
function packFile(path: string): string | 'missing' | 'too-large' {
  let fd: number
  try {
    fd = openNotThroughALink(path, constants.O_RDONLY)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('Not a file.')
    if (stat.size > MOST_BYTES) return 'too-large'
    const bytes = Buffer.alloc(MOST_BYTES + 1)
    const read = readSync(fd, bytes, 0, bytes.length, 0)
    if (read > MOST_BYTES) return 'too-large'
    return bytes.subarray(0, read).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** The lines of a document's fenced ```text blocks, in order, each block apart. */
function textBlocks(
  document: string,
): { readonly heading: string | null; readonly lines: string[] }[] {
  const blocks: { heading: string | null; lines: string[] }[] = []
  let heading: string | null = null
  let open: string[] | null = null
  for (const line of document.split(/\r?\n/)) {
    if (open !== null) {
      if (line.trim() === '```') {
        blocks.push({ heading, lines: open })
        open = null
      } else open.push(line)
    } else if (/^# /.test(line)) heading = line.slice(2).trim()
    else if (line.trim() === '```text') open = []
  }
  return blocks
}

/** A block's paragraphs, split at blank lines as the shipped texts are kept. */
function paragraphsOf(lines: readonly string[]): string[] {
  return lines
    .join('\n')
    .split(/\n[ \t]*\n/)
    .map((one) => one.trim())
    .filter((one) => one !== '')
}

/** The first block under a heading, as paragraphs; `null` when there is none or it is empty. */
function partUnder(document: string, heading: string): string[] | null {
  const block = textBlocks(document).find((one) => one.heading === heading)
  const paragraphs = block === undefined ? [] : paragraphsOf(block.lines)
  return paragraphs.length === 0 ? null : paragraphs
}

/** A frontmatter field's value, as a skill's file declares it. */
function frontmatterField(text: string, key: string): string | null {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1]
  const line = frontmatter?.split(/\r?\n/).find((one) => one.startsWith(`${key}: `))
  return line === undefined ? null : line.slice(key.length + 2)
}

class Refused extends Error {
  constructor(readonly refusal: TextPackRefusal) {
    super('The text pack was refused.')
  }
}

/**
 * A folder of the pack, which must be a folder and not a link to one. The check it returns refuses
 * when the folder was replaced since, so a pack is read from the folders it was found to hold.
 * ⚠️ A swap made and undone between the two looks is not seen.
 */
function heldFolder(path: string): () => void {
  const seen = lstatSync(path)
  if (!seen.isDirectory()) throw new Error('Not a folder of the pack.')
  return () => {
    const now = lstatSync(path)
    if (!now.isDirectory() || now.dev !== seen.dev || now.ino !== seen.ino)
      throw new Error('A folder of the pack changed while it was read.')
  }
}

function fileIn(folder: string, relative: string): string {
  const text = packFile(join(folder, relative))
  if (text === 'too-large') throw new Refused({ kind: 'too-large', file: relative })
  return text
}

/**
 * The skills' catalogue a pack implies: each skill's name and description from its own file, its
 * line on every turn from `turn-line.md`, and its size and digest from its bytes. It is then held to
 * the shipped catalogue's own rules.
 */
function packSkills(folder: string, version: string): VerifiedBuiltInSkills {
  const turnLine = fileIn(folder, 'turn-line.md')
  if (turnLine === 'missing') throw new Refused({ kind: 'turn-line-missing' })
  const lines = textBlocks(turnLine).flatMap((one) => one.lines)
  const lineFor = (prefix: string, skill: BuiltInSkillName): string => {
    const found = lines.filter((one) => one.startsWith(prefix))
    if (found.length === 0) throw new Refused({ kind: 'turn-line-without', skill })
    if (found.length > 1) throw new Refused({ kind: 'skill-rules' })
    return found[0]!
  }
  const bodies = new Map<string, string>()
  const skills = BUILT_IN_SKILL_NAMES.map((name) => {
    let still: () => void
    try {
      still = heldFolder(join(folder, name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Refused({ kind: 'skill-missing', skill: name })
      throw error
    }
    const body = fileIn(folder, join(name, 'SKILL.md'))
    if (body === 'missing') throw new Refused({ kind: 'skill-missing', skill: name })
    still()
    bodies.set(name, body)
    return {
      name,
      description: frontmatterField(body, 'description') ?? '',
      reminder: {
        codex: lineFor(`${name} — `, name),
        claude: lineFor(`brobot:${name} — `, name),
      },
      sha256: skillDigest(body),
      bytes: Buffer.byteLength(body, 'utf8'),
    }
  })
  try {
    return verifyBuiltInSkills({ formatVersion: 1, version, skills }, bodies)
  } catch {
    throw new Refused({ kind: 'skill-rules' })
  }
}

/**
 * The text pack a launch reads, from the folder the launch environment names: the core and BroBot's
 * addition from `core.md`, and the skills with their turn lines. ⛔ A packaged build never looks at
 * the variable. Read again at each conversation's start, so an edit is live at the next one.
 */
export function readTextPack(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
  shippedVersion: () => string | null,
): TextPackRead {
  if (isPackaged) return { kind: 'none' }
  const folder = env[TEXT_PACK_VARIABLE]
  if (folder === undefined || folder === '') return { kind: 'none' }
  if (!isAbsolute(folder)) return { kind: 'refused', folder, refusal: { kind: 'not-absolute' } }
  // The pack stands in for the shipped texts, under their version; without it, no pack is used
  // and the launch's own read of the shipped skills says what is wrong.
  const version = shippedVersion()
  if (version === null) return { kind: 'none' }
  try {
    const rootStill = heldFolder(folder)
    const core = fileIn(folder, 'core.md')
    if (core === 'missing') throw new Refused({ kind: 'core-missing' })
    const every = partUnder(core, 'Core for every agent')
    if (every === null) throw new Refused({ kind: 'core-block-missing', block: 'core' })
    const coordinator = partUnder(core, 'BroBot-only addition')
    if (coordinator === null)
      throw new Refused({ kind: 'core-block-missing', block: 'coordinator' })
    const service = partUnder(core, 'Service-only addition')
    const skills = packSkills(folder, version)
    rootStill()
    return { kind: 'read', pack: { folder, core: every, coordinator, service, skills } }
  } catch (error) {
    const refusal = error instanceof Refused ? error.refusal : { kind: 'unreadable' as const }
    return { kind: 'refused', folder, refusal }
  }
}

/** What a pack gives a profile's file: its core, BroBot's addition, and a service's text if any. */
export function factoryTextOf(pack: TextPack): FactoryTextGiven {
  return {
    core: pack.core,
    coordinator: pack.coordinator,
    ...(pack.service === null ? {} : { service: pack.service }),
  }
}
