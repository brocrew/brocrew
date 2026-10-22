import { describe, expect, it } from 'vitest'
import { BUILT_IN_SKILL_NAMES } from '../src/shared/built-in-skills'
import {
  builtInSkillReminders,
  skillDigest,
  verifyBuiltInSkills,
} from '../src/main/skills/built-in-catalogue'

const description = 'Check the totals.'
const bodies = new Map(
  BUILT_IN_SKILL_NAMES.map((name) => [
    name,
    `---\nname: ${name}\ndescription: ${description}\n---\nFollow the request.\n`,
  ]),
)
const legacy = () => ({
  formatVersion: 1,
  version: 'v1',
  skills: BUILT_IN_SKILL_NAMES.map((name) => ({
    name,
    description,
    reminder: { codex: `${name} — ${description}`, claude: `brobot:${name} — ${description}` },
    sha256: skillDigest(bodies.get(name)!),
    bytes: Buffer.byteLength(bodies.get(name)!, 'utf8'),
  })),
})
const neutral = () => ({
  ...legacy(),
  formatVersion: 2,
  skills: legacy().skills.map((skill) => ({ ...skill, reminder: skill.reminder.codex })),
})

describe('the built-in skill catalogue format', () => {
  it('normalizes the old pair to the same neutral catalogue and digest', () => {
    const before = verifyBuiltInSkills(legacy(), bodies)
    const after = verifyBuiltInSkills(neutral(), bodies)
    expect(before.catalogue.formatVersion).toBe(2)
    expect(before.catalogue).toEqual(after.catalogue)
    expect(before.digest).toBe(after.digest)
    const line = BUILT_IN_SKILL_NAMES.map((name) => `${name} — ${description}`)
    for (const bundle of [before, after]) {
      expect(builtInSkillReminders('codex', bundle.catalogue.skills)).toBe(line.join('\n') + '\n')
      expect(builtInSkillReminders('claude', bundle.catalogue.skills)).toBe(
        line.map((text) => `brobot:${text}`).join('\n') + '\n',
      )
    }
  })

  it('refuses an inconsistent legacy pair before discarding either string', () => {
    const changed = legacy()
    changed.skills[0]!.reminder.claude += ' Different.'
    expect(() => verifyBuiltInSkills(changed, bodies)).toThrow()
  })

  it('refuses unknown formats, extra reminder fields and malformed neutral lines', () => {
    expect(() => verifyBuiltInSkills({ ...neutral(), formatVersion: 3 }, bodies)).toThrow()
    const wrong = neutral()
    wrong.skills[0]!.reminder = 'A different skill — Check the totals.'
    expect(() => verifyBuiltInSkills(wrong, bodies)).toThrow()
    const extra = neutral()
    expect(() =>
      verifyBuiltInSkills(
        { ...extra, skills: extra.skills.map((skill) => ({ ...skill, codex: '' })) },
        bodies,
      ),
    ).toThrow()
  })
})
