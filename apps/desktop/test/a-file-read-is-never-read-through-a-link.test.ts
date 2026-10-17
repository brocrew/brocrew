import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowsCreates } from '../../../packages/runtime/test/fixtures/an-open-that-follows-links'
import { openResolvedAsset } from '../src/main/asset-protocol'
import { resourceBytes } from '../src/main/resources/resources'
import { readBuiltInSkills } from '../src/main/skills/prepare-built-in-skills'
import { readTextPack, TEXT_PACK_VARIABLE } from '../src/main/skills/text-pack'
import {
  makeWorkerPieceFolder,
  WORKER_OUTPUT_DIRNAME,
  WORKER_OUTPUT_FAILURE,
} from '../src/main/worker-piece-folder'
import { BUILT_IN_SKILL_NAMES } from '../src/shared/built-in-skills'

/**
 * A file this app reads where a link must not lead it — a picture it draws, a worker folder's
 * marker, a kept resource, a text pack's file — is never read through a link left at its name.
 * Windows has no `O_NOFOLLOW`, and there an open follows such a link. Off Windows, this file's
 * `node:fs` behaves so; on Windows the system does. Scratch folders only.
 */

const creates = vi.hoisted((): WindowsCreates => ({ windows: true, swap: null, swapped: false }))

vi.mock('node:fs', async (importOriginal) => {
  const { asWindowsCreates } =
    await import('../../../packages/runtime/test/fixtures/an-open-that-follows-links')
  return asWindowsCreates(await importOriginal<typeof import('node:fs')>(), creates)
})

let root: string
let outside: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-read-'))
  outside = join(root, 'not-ours')
  mkdirSync(outside)
  creates.windows = true
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('a picture the window draws', () => {
  it('🔴 a link at its name is not opened', () => {
    const target = join(outside, 'secret.png')
    writeFileSync(target, 'PNG')
    const link = join(root, 'swapped.png')
    symlinkSync(target, link)

    expect(openResolvedAsset(link)).toBeNull()
  })

  it('a picture at its name is opened', () => {
    const picture = join(root, 'ordinary.png')
    writeFileSync(picture, 'PNG')
    const fd = openResolvedAsset(picture)
    expect(fd).not.toBeNull()
    if (fd !== null) closeSync(fd)
  })
})

describe('the marker that says a worker output folder is the app’s', () => {
  const MARKER_TEXT = 'BroCrew parallel piece output folders\n'

  it('🔴 a link to a file that holds the marker’s exact text is not taken for the marker', () => {
    makeWorkerPieceFolder(root, `work_${randomUUID()}`)
    const marker = join(root, WORKER_OUTPUT_DIRNAME, '.brocrew-worker-output')
    rmSync(marker)
    const pretend = join(outside, 'pretend-marker')
    writeFileSync(pretend, MARKER_TEXT)
    symlinkSync(pretend, marker)

    expect(() => makeWorkerPieceFolder(root, `work_${randomUUID()}`)).toThrow(WORKER_OUTPUT_FAILURE)
  })

  it('the marker itself is taken, and a second folder made', () => {
    makeWorkerPieceFolder(root, `work_${randomUUID()}`)
    expect(() => makeWorkerPieceFolder(root, `work_${randomUUID()}`)).not.toThrow()
  })
})

describe('a kept resource', () => {
  const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex')
  const kept = (name: string, text: string) => {
    const folder = join(root, 'resources', sha(text))
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, name), text)
    return { resource: `res_${randomUUID()}`, name, sha256: sha(text), path: join(folder, name) }
  }

  it('🔴 a link at its name, to another file inside the tree, is not read', () => {
    const row = kept('report.md', '# A fictional report\n')
    const neighbour = join(root, 'resources', 'neighbour.md')
    writeFileSync(neighbour, '# Another file inside the tree\n')
    rmSync(row.path)
    symlinkSync(neighbour, row.path)

    const read = resourceBytes(join(root, 'resources'), row)

    expect(!read.ok && read.refusal.rail).toBe('resource-bytes-unreadable')
  })

  it('the file at its name is read', () => {
    const row = kept('report.md', '# A fictional report\n')
    expect(resourceBytes(join(root, 'resources'), row).ok).toBe(true)
  })
})

describe('a text pack, in a build run from its source', () => {
  const shipped = resolve(import.meta.dirname, '../resources/built-in-skills')
  /** A core document laid out as the shipped one is: one block for all, BroBot's and a service's. */
  const CORE = [
    '# Core for every agent',
    '',
    '```text',
    'A fictional paragraph.',
    '```',
    '',
    '# BroBot-only addition',
    '',
    '```text',
    'A fictional addition for BroBot.',
    '```',
    '',
    '# Service-only addition',
    '',
    '```text',
    'A fictional line for services.',
    '```',
    '',
  ].join('\n')
  const aPack = (): string => {
    const folder = join(root, 'pack')
    mkdirSync(folder)
    writeFileSync(join(folder, 'core.md'), CORE)
    cpSync(join(shipped, 'turn-line.md'), join(folder, 'turn-line.md'))
    for (const name of BUILT_IN_SKILL_NAMES) {
      mkdirSync(join(folder, name))
      cpSync(join(shipped, name, 'SKILL.md'), join(folder, name, 'SKILL.md'))
    }
    return folder
  }
  const read = (folder: string) =>
    readTextPack(
      { [TEXT_PACK_VARIABLE]: folder },
      false,
      () => readBuiltInSkills(shipped).catalogue.version,
    )

  it('🔴 a skill’s file that is a link is refused', () => {
    const folder = aPack()
    const skill = join(folder, 'delegate', 'SKILL.md')
    const theirs = join(outside, 'SKILL.md')
    writeFileSync(theirs, readFileSync(skill))
    rmSync(skill)
    symlinkSync(theirs, skill)

    expect(read(folder)).toEqual({ kind: 'refused', folder, refusal: { kind: 'unreadable' } })
  })

  it('🔴 a core.md that is a link is refused', () => {
    const folder = aPack()
    const theirs = join(outside, 'core.md')
    writeFileSync(theirs, CORE)
    rmSync(join(folder, 'core.md'))
    symlinkSync(theirs, join(folder, 'core.md'))

    expect(read(folder)).toEqual({ kind: 'refused', folder, refusal: { kind: 'unreadable' } })
  })

  it('a pack of its own files is read', () => {
    expect(read(aPack()).kind).toBe('read')
  })
})
