import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { profileBundleSpans } from '../src/main/runtime/factory-text'
import { readBuiltInSkills } from '../src/main/skills/prepare-built-in-skills'
import {
  factoryTextOf,
  readTextPack,
  TEXT_PACK_VARIABLE,
  type TextPackRead,
} from '../src/main/skills/text-pack'
import { BUILT_IN_SKILL_NAMES } from '../src/shared/built-in-skills'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import {
  textPackRefusalSaid,
  textPackRefusedSaid,
  type TextPackRefusal,
} from '../src/shared/text-pack'

const shipped = resolve(import.meta.dirname, '../resources/built-in-skills')

/** A draft's core document, laid out as the prompt reviews write theirs. */
const CORE = [
  '# Core for every agent',
  '',
  'Send the first block to every agent.',
  '',
  '```text',
  'A first fictional paragraph.',
  '',
  'A second fictional paragraph.',
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

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A pack in a scratch folder: the fictional core, and the shipped turn lines and skills. */
function aPack(): string {
  const folder = mkdtempSync(join(tmpdir(), 'text-pack-'))
  folders.push(folder)
  writeFileSync(join(folder, 'core.md'), CORE)
  cpSync(join(shipped, 'turn-line.md'), join(folder, 'turn-line.md'))
  for (const name of BUILT_IN_SKILL_NAMES) {
    mkdirSync(join(folder, name))
    cpSync(join(shipped, name, 'SKILL.md'), join(folder, name, 'SKILL.md'))
  }
  return folder
}
const launchNaming = (folder: string) => ({ [TEXT_PACK_VARIABLE]: folder })
/** The shipped catalogue's version, as a run keeps it. */
const shippedNow = () => readBuiltInSkills(shipped).catalogue.version
const read = (folder: string): TextPackRead => readTextPack(launchNaming(folder), false, shippedNow)
const edit = (path: string, change: (text: string) => string) =>
  writeFileSync(path, change(readFileSync(path, 'utf8')))

describe('a text pack, read only by a build run from its source', () => {
  it('is never read by an installed build, whatever the launch names', () => {
    expect(readTextPack(launchNaming(aPack()), true, shippedNow)).toEqual({ kind: 'none' })
    expect(readTextPack(launchNaming('/no/such/folder'), true, shippedNow)).toEqual({
      kind: 'none',
    })
    expect(readTextPack(launchNaming('fictional/relative'), true, shippedNow)).toEqual({
      kind: 'none',
    })
  })
  it('is not read when the launch names none', () => {
    expect(readTextPack({}, false, shippedNow)).toEqual({ kind: 'none' })
    expect(readTextPack(launchNaming(''), false, shippedNow)).toEqual({ kind: 'none' })
  })
  it('gives the core, BroBot’s addition and the skills from the folder', () => {
    const folder = aPack()
    const pack = read(folder)
    if (pack.kind !== 'read') throw new Error(`not read: ${JSON.stringify(pack)}`)
    expect(pack.pack.folder).toBe(folder)
    expect(pack.pack.core).toEqual([
      'A first fictional paragraph.',
      'A second fictional paragraph.',
    ])
    expect(pack.pack.coordinator).toEqual(['A fictional addition for BroBot.'])
    // The shipped skills and turn lines give back exactly the catalogue the build ships.
    expect(pack.pack.skills.catalogue).toEqual(readBuiltInSkills(shipped).catalogue)
  })
  it('stands in for the shipped texts under their version, as read at its launch', () => {
    const later = readTextPack(launchNaming(aPack()), false, () => 'v12')
    if (later.kind !== 'read') throw new Error(`not read: ${JSON.stringify(later)}`)
    expect(later.pack.skills.catalogue.version).toBe('v12')
    const now = read(aPack())
    if (now.kind !== 'read') throw new Error(`not read: ${JSON.stringify(now)}`)
    expect(now.pack.skills.catalogue.version).toBe(shippedNow())
  })
  it('is not used when the shipped catalogue’s version cannot be read', () => {
    expect(readTextPack(launchNaming(aPack()), false, () => null)).toEqual({ kind: 'none' })
  })
  it('gives an edited skill a new digest, so its launch installs a view of its own', () => {
    const folder = aPack()
    edit(join(folder, 'remember', 'SKILL.md'), (text) => `${text}\nA fictional draft line.\n`)
    const pack = read(folder)
    if (pack.kind !== 'read') throw new Error(`not read: ${JSON.stringify(pack)}`)
    expect(pack.pack.skills.digest).not.toBe(readBuiltInSkills(shipped).digest)
  })
  it('puts its core and BroBot’s addition in the profile’s file in place of the shipped ones', () => {
    const factoryText = { core: ['A pack’s core.'], coordinator: ['A pack’s addition.'] }
    const brobot = profileBundleSpans({
      configured: '',
      profileSlug: DEFAULT_PROFILE_ID,
      factoryText,
    })
    expect(brobot.text).toContain('A pack’s core.')
    expect(brobot.text).toContain('A pack’s addition.')
    expect(brobot.text).not.toContain('is a desktop app where a person works with Claude and Codex')
    const other = profileBundleSpans({
      configured: '',
      profileSlug: 'fictional-analyst',
      factoryText,
    })
    expect(other.text).toContain('A pack’s core.')
    expect(other.text).not.toContain('A pack’s addition.')
  })
  /** The shipped service text's first words. */
  const SHIPPED_SERVICE = 'You serve many callers through one conversation'
  const fileOf = (pack: TextPackRead, profileSlug: string, isAService = false): string => {
    if (pack.kind !== 'read') throw new Error(`not read: ${JSON.stringify(pack)}`)
    return profileBundleSpans({
      configured: '',
      profileSlug,
      ...(isAService ? { isAService: true as const } : {}),
      factoryText: factoryTextOf(pack.pack),
    }).text
  }
  it('gives a service the pack’s service text in place of the shipped one, and no other profile', () => {
    const pack = read(aPack())
    // Without a pack, a service has the shipped text.
    expect(
      profileBundleSpans({ configured: '', profileSlug: 'fictional-browser', isAService: true })
        .text,
    ).toContain(SHIPPED_SERVICE)
    const service = fileOf(pack, 'fictional-browser', true)
    expect(service).toContain('A fictional line for services.')
    expect(service).not.toContain(SHIPPED_SERVICE)
    for (const other of [fileOf(pack, 'fictional-analyst'), fileOf(pack, DEFAULT_PROFILE_ID)]) {
      expect(other).not.toContain('A fictional line for services.')
      expect(other).not.toContain(SHIPPED_SERVICE)
    }
  })
  it('gives a service the shipped service text when the pack has none', () => {
    const folder = aPack()
    edit(join(folder, 'core.md'), (text) => text.slice(0, text.indexOf('# Service-only addition')))
    const service = fileOf(read(folder), 'fictional-browser', true)
    expect(service).toContain(SHIPPED_SERVICE)
    expect(service).toContain('A first fictional paragraph.')
  })

  const refusals: [string, (folder: string) => string, TextPackRefusal][] = [
    ['a folder that is not a full path', () => 'fictional/pack', { kind: 'not-absolute' }],
    ['a folder that is not there', (folder) => join(folder, 'missing'), { kind: 'unreadable' }],
    ['no core.md', (folder) => (rmSync(join(folder, 'core.md')), folder), { kind: 'core-missing' }],
    [
      'a core.md without the block for every agent',
      (folder) => (
        edit(join(folder, 'core.md'), (t) => t.replace('# Core for every agent', '# Draft')),
        folder
      ),
      { kind: 'core-block-missing', block: 'core' },
    ],
    [
      'a core.md without BroBot’s addition',
      (folder) => (
        edit(join(folder, 'core.md'), (t) => t.replace('# BroBot-only addition', '# Draft')),
        folder
      ),
      { kind: 'core-block-missing', block: 'coordinator' },
    ],
    [
      'no turn-line.md',
      (folder) => (rmSync(join(folder, 'turn-line.md')), folder),
      { kind: 'turn-line-missing' },
    ],
    [
      'a turn-line.md without remember’s line',
      (folder) => (
        edit(join(folder, 'turn-line.md'), (t) =>
          t
            .split('\n')
            .filter((line) => !line.startsWith('remember — '))
            .join('\n'),
        ),
        folder
      ),
      { kind: 'turn-line-without', skill: 'remember' },
    ],
    [
      'no SKILL.md for delegate',
      (folder) => (rmSync(join(folder, 'delegate', 'SKILL.md')), folder),
      { kind: 'skill-missing', skill: 'delegate' },
    ],
    [
      'a description longer than a skill may have',
      (folder) => (
        edit(join(folder, 'hand-back', 'SKILL.md'), (t) =>
          t.replace(/^description: .*$/m, `description: ${'A fictional word. '.repeat(40)}`),
        ),
        folder
      ),
      { kind: 'skill-rules' },
    ],
    [
      'a skill that names another',
      (folder) => (
        edit(join(folder, 'split-work', 'SKILL.md'), (t) =>
          t.replace(/^name: .*$/m, 'name: other'),
        ),
        folder
      ),
      { kind: 'skill-rules' },
    ],
    [
      'a skill larger than 64 KB',
      (folder) => (
        edit(join(folder, 'delegate', 'SKILL.md'), (t) => `${t}\n${'x'.repeat(70_000)}\n`),
        folder
      ),
      { kind: 'too-large', file: join('delegate', 'SKILL.md') },
    ],
  ]
  for (const [what, make, refusal] of refusals) {
    it(`refuses ${what}, and the launch keeps the shipped texts`, () => {
      const folder = make(aPack())
      expect(read(folder)).toEqual({ kind: 'refused', folder, refusal })
    })
  }

  describe('reads only what is inside its folder', () => {
    /** A scratch folder outside the pack, holding a valid copy of `delegate`'s file. */
    const outside = () => {
      const folder = mkdtempSync(join(tmpdir(), 'text-pack-outside-'))
      folders.push(folder)
      cpSync(join(shipped, 'delegate', 'SKILL.md'), join(folder, 'SKILL.md'))
      return folder
    }
    const unreadable = (folder: string) =>
      expect(read(folder)).toEqual({ kind: 'refused', folder, refusal: { kind: 'unreadable' } })
    it('refuses a pack whose folder is a link', () => {
      const link = join(mkdtempSync(join(tmpdir(), 'text-pack-link-')), 'pack')
      folders.push(dirname(link))
      symlinkSync(aPack(), link)
      unreadable(link)
    })
    it('refuses a skill’s folder that links outside, though its file would pass', () => {
      const folder = aPack()
      rmSync(join(folder, 'delegate'), { recursive: true })
      symlinkSync(outside(), join(folder, 'delegate'))
      unreadable(folder)
    })
    it('refuses a skill’s file that is a link', () => {
      const folder = aPack()
      rmSync(join(folder, 'delegate', 'SKILL.md'))
      symlinkSync(join(outside(), 'SKILL.md'), join(folder, 'delegate', 'SKILL.md'))
      unreadable(folder)
    })
    it('refuses a core.md that is a link', () => {
      const folder = aPack()
      const core = join(outside(), 'core.md')
      writeFileSync(core, CORE)
      rmSync(join(folder, 'core.md'))
      symlinkSync(core, join(folder, 'core.md'))
      unreadable(folder)
    })
  })

  it('says a refusal plainly, with the folder and why', () => {
    expect(
      textPackRefusedSaid({ folder: '/fictional/pack', refused: { kind: 'core-missing' } }),
    ).toBe(
      'The text pack at /fictional/pack could not be used: core.md is missing. This conversation uses the texts this build ships.',
    )
  })

  it('says each refusal in its own sentence, naming the block, skill or file it is about', () => {
    const said: [TextPackRefusal, string][] = [
      [{ kind: 'not-absolute' }, 'its folder is not a full path'],
      [{ kind: 'unreadable' }, 'its folder could not be read'],
      [{ kind: 'core-missing' }, 'core.md is missing'],
      [
        { kind: 'core-block-missing', block: 'core' },
        'core.md has no “Core for every agent” block',
      ],
      [
        { kind: 'core-block-missing', block: 'coordinator' },
        'core.md has no “BroBot-only addition” block',
      ],
      [{ kind: 'turn-line-missing' }, 'turn-line.md is missing'],
      [{ kind: 'turn-line-without', skill: 'remember' }, 'turn-line.md has no line for remember'],
      [{ kind: 'skill-missing', skill: 'delegate' }, 'delegate/SKILL.md is missing'],
      [
        { kind: 'skill-rules' },
        'a skill’s name, description or line breaks the rules built-in skills follow',
      ],
      [
        { kind: 'too-large', file: 'hand-back/SKILL.md' },
        'hand-back/SKILL.md is larger than 64 KB',
      ],
    ]
    for (const [refusal, why] of said) expect(textPackRefusalSaid(refusal), refusal.kind).toBe(why)
  })
})

describe('a later version label', () => {
  /** The shipped folder copied, with its manifest changed. */
  function shippedWith(change: (manifest: Record<string, unknown>) => unknown): string {
    const folder = mkdtempSync(join(tmpdir(), 'shipped-skills-'))
    folders.push(folder)
    cpSync(shipped, folder, { recursive: true })
    const path = join(folder, 'manifest.json')
    writeFileSync(path, JSON.stringify(change(JSON.parse(readFileSync(path, 'utf8')))))
    return folder
  }
  it('is read and verified as a launch’s preparation reads it; another format is not', () => {
    for (const label of ['v12', 'v9.1'])
      expect(
        readBuiltInSkills(shippedWith((one) => ({ ...one, version: label }))).catalogue.version,
      ).toBe(label)
    expect(() => readBuiltInSkills(shippedWith((one) => ({ ...one, formatVersion: 3 })))).toThrow()
  })
  it('names the pack a launch reads, with every pack edit seen at the next launch', () => {
    const folder = aPack()
    const first = readTextPack(launchNaming(folder), false, () => 'v12')
    edit(join(folder, 'remember', 'SKILL.md'), (text) => `${text}\nA fictional draft line.\n`)
    const next = readTextPack(launchNaming(folder), false, () => 'v12')
    if (first.kind !== 'read' || next.kind !== 'read') throw new Error('not read')
    expect(next.pack.skills.catalogue.version).toBe('v12')
    expect(next.pack.skills.digest).not.toBe(first.pack.skills.digest)
  })
})
