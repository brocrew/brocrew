import { describe, expect, it } from 'vitest'
import { aLaunchRecordIn } from '../src/main/runtime/what-this-agent-was-given'
import type { GivenBuiltInSkills } from '../src/shared/what-this-agent-was-given'

const offered: GivenBuiltInSkills = {
  version: 'v6',
  reminder: 'delegate — Fictional launch reminder.\n',
  listed: ['delegate', 'hand-back', 'split-work', 'ask-and-wait', 'remember', 'build-software'].map(
    (name) => ({
      name,
      description: `Description of ${name}.`,
      descriptionMayBeCut: false,
      path: `/tmp/fictional/skills/${name}/SKILL.md`,
      scope: null,
    }),
  ),
}

describe('the built-in skill view kept on a launch', () => {
  it('keeps full names, descriptions, paths and exact versioned reminder', () => {
    const read = aLaunchRecordIn({ placement: 'first-message', builtInSkills: offered })
    expect(read?.builtInSkills).toEqual(offered)
    expect(read?.builtInSkills?.reminder.endsWith('\n')).toBe(true)
  })
  it('does not invent an installed set for a historical launch', () => {
    expect(aLaunchRecordIn({ placement: 'system-prompt' })?.builtInSkills).toBeUndefined()
  })
  it.each(['extra-field', 'cut-description', 'too-many', 'missing-path', 'unknown-scope'])(
    'rejects a malformed %s skill record',
    (kind) => {
      const changed = structuredClone(offered)
      if (kind === 'extra-field') Object.assign(changed, { unrelated: 'text' })
      if (kind === 'cut-description')
        Object.assign(changed.listed[0]!, { descriptionMayBeCut: true })
      if (kind === 'too-many')
        Object.assign(changed, { listed: [...changed.listed, ...changed.listed] })
      if (kind === 'missing-path') Object.assign(changed.listed[0]!, { path: null })
      if (kind === 'unknown-scope') Object.assign(changed.listed[0]!, { scope: 'foreign' })
      expect(
        aLaunchRecordIn({ placement: 'first-message', builtInSkills: changed })?.builtInSkills,
      ).toBeUndefined()
    },
  )
})

describe('the text pack kept on a launch', () => {
  it('keeps the folder a launch read, or why it could not use it', () => {
    const used = { folder: '/fictional/pack', refused: null }
    expect(aLaunchRecordIn({ placement: 'first-message', textPack: used })?.textPack).toEqual(used)
    const refused = {
      folder: '/fictional/pack',
      refused: { kind: 'turn-line-without', skill: 'remember' },
    }
    expect(aLaunchRecordIn({ placement: 'first-message', textPack: refused })?.textPack).toEqual(
      refused,
    )
  })
  it.each([
    ['an unknown reason', { folder: '/fictional/pack', refused: { kind: 'a-new-reason' } }],
    [
      'a skill that is not built in',
      { folder: '/fictional/pack', refused: { kind: 'skill-missing', skill: 'other' } },
    ],
    ['an extra field', { folder: '/fictional/pack', refused: null, unrelated: 'text' }],
    ['no folder', { refused: null }],
  ])('drops a record with %s', (_, textPack) => {
    expect(aLaunchRecordIn({ placement: 'first-message', textPack })?.textPack).toBeUndefined()
  })
})

it('keeps an explicitly empty installed view instead of inventing defaults', () => {
  const empty = { version: 'v23', reminder: '', listed: [], catalogueRevision: 4, versions: [] }
  expect(
    aLaunchRecordIn({ placement: 'first-message', builtInSkills: empty })?.builtInSkills,
  ).toEqual(empty)
})
it('keeps more than eight version pins and refuses a mismatched pin or an overfull record', () => {
  const listed = Array.from({ length: 12 }, (_, index) => ({
    name: `personal-recipe-${index}`,
    description: 'A fictional recipe.',
    descriptionMayBeCut: false as const,
    path: `/fictional/skills/personal-recipe-${index}/SKILL.md`,
    scope: null,
  }))
  const versions = listed.map((one) => ({
    id: `person/${one.name}`,
    versionId: `person/${one.name}@v1`,
    version: 'v1',
    alias: one.name,
    sourceSha256: 'a'.repeat(64),
    sha256: 'b'.repeat(64),
    bytes: 128,
    requirement: null,
  }))
  const offered = {
    version: 'v23',
    reminder: 'A fictional installed reminder.',
    listed,
    versions,
    catalogueRevision: 5,
  }
  expect(
    aLaunchRecordIn({ placement: 'first-message', builtInSkills: offered })?.builtInSkills,
  ).toEqual(offered)
  expect(
    aLaunchRecordIn({
      placement: 'first-message',
      builtInSkills: {
        ...offered,
        versions: [{ ...versions[0], alias: 'wrong' }, ...versions.slice(1)],
      },
    })?.builtInSkills,
  ).toBeUndefined()
  const many = Array.from({ length: 65 }, (_, index) => ({
    ...listed[0],
    name: `recipe-${index}`,
    path: `/fictional/skills/recipe-${index}/SKILL.md`,
  }))
  expect(
    aLaunchRecordIn({
      placement: 'first-message',
      builtInSkills: { ...offered, versions: undefined, listed: many },
    })?.builtInSkills,
  ).toBeUndefined()
})
