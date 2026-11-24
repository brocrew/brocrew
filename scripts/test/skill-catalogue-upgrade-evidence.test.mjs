import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { skillsKept, rowsPreserved, sha256, verifyCandidateSkills } from '../lib/upgrade-path.mjs'

describe('skill catalogue upgrade evidence', () => {
  const skill = (id = 'built-in/delegate', version = 'v23') => {
    const name = id.split('/').at(-1)
    const body = `Fictional ${version} instruction.`
    const digest = sha256(Buffer.from(body))
    return {
      id: `${id}@${version}`,
      skill_id: id,
      body,
      sha256: digest,
      bytes: Buffer.byteLength(body),
      metadata: JSON.stringify({
        origin: { kind: id.startsWith('built-in/') ? 'built-in' : 'person' },
        name,
        alias: name,
        bytes: Buffer.byteLength(body),
        sha256: digest,
      }),
    }
  }
  const tables = () => {
    const version = skill()
    return {
      skill_version: [version],
      skill_current: [
        { id: 'built-in/delegate', alias: 'delegate', active: 1, current_version: version.id },
      ],
      skill_selection: [
        { identity_id: 'aid:recipe-worker', skill_id: 'built-in/delegate', choice: 'off' },
      ],
      skill_catalogue_state: [{ id: 1, revision: 1 }],
    }
  }
  const candidateBundle = (names = []) => {
    const bodies = new Map(
      names.map((name) => [
        name,
        Buffer.from(
          `---\nname: ${name}\ndescription: A fictional instruction.\n---\nUse fake data only.\n`,
        ),
      ]),
    )
    const manifest = {
      formatVersion: 1,
      version: 'v24',
      skills: names.map((name) => ({
        name,
        description: 'A fictional instruction.',
        reminder: { codex: `${name} — Use fake data.`, claude: `brobot:${name} — Use fake data.` },
      })),
    }
    return { manifest, bodies }
  }
  const proofFor = (names) => {
    const { manifest, bodies } = candidateBundle(names)
    return verifyCandidateSkills(manifest, bodies)
  }
  const compare = (before, after, proof) => ({
    rows: rowsPreserved(before, after, undefined, { skill_current: ['id'] }, proof).lost,
    skills: skillsKept(before, after, proof),
  })
  it.each([
    ['omitted', 1, 0, []],
    ['returning', 0, 1, ['delegate']],
  ])(
    'accepts only the %s built-in availability matching the verified bundle',
    (_, was, now, names) => {
      const before = tables(),
        after = tables()
      before.skill_current[0].active = was
      after.skill_current[0].active = now
      after.skill_catalogue_state[0].revision++
      expect(compare(before, after, proofFor(names))).toEqual({ rows: [], skills: [] })
      expect(after.skill_selection).toEqual(before.skill_selection)
      expect(after.skill_version).toEqual(before.skill_version)
    },
  )
  it.each(['person', 'plugin'])('never exempts a %s-origin availability change', (origin) => {
    const before = tables()
    const version = skill(`${origin}/delegate`)
    version.metadata = JSON.stringify({ ...JSON.parse(version.metadata), origin: { kind: origin } })
    before.skill_version = [version]
    before.skill_current[0].id = version.skill_id
    before.skill_current[0].current_version = version.id
    const after = structuredClone(before)
    after.skill_current[0].active = 0
    after.skill_catalogue_state[0].revision++
    const result = compare(before, after, proofFor([]))
    expect(result.rows).toHaveLength(1)
    expect(result.skills).toContain('an existing skill head changed')
  })
  it.each(['body', 'choice', 'history', 'alias', 'pointer', 'origin'])(
    'preserves %s even during an otherwise permitted availability flip',
    (fault) => {
      const before = tables(),
        after = tables()
      after.skill_current[0].active = 0
      after.skill_catalogue_state[0].revision++
      if (fault === 'body') after.skill_version[0].body += 'Changed.'
      if (fault === 'choice') after.skill_selection[0].choice = 'on'
      if (fault === 'history') after.skill_version = []
      if (fault === 'alias') after.skill_current[0].alias = 'other'
      if (fault === 'pointer') {
        const next = skill('built-in/delegate', 'v24')
        after.skill_version.push(next)
        after.skill_current[0].current_version = next.id
      }
      if (fault === 'origin') {
        for (const state of [before, after]) {
          const meta = JSON.parse(state.skill_version[0].metadata)
          meta.origin.kind = 'person'
          state.skill_version[0].metadata = JSON.stringify(meta)
        }
      }
      const result = compare(before, after, proofFor([]))
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.skills.length).toBeGreaterThan(0)
    },
  )
  it.each([
    ['shipped-but-disabled', 1, 0, ['delegate']],
    ['absent-but-enabled', 0, 1, []],
  ])('refuses %s flips', (_, was, now, names) => {
    const before = tables(),
      after = tables()
    before.skill_current[0].active = was
    after.skill_current[0].active = now
    after.skill_catalogue_state[0].revision++
    const result = compare(before, after, proofFor(names))
    expect(result.rows).toHaveLength(1)
    expect(result.skills).toContain('an existing skill head changed')
  })
  it.each([undefined, { names: [] }, new Set()])(
    'fails closed without a verified bundle receipt: %s',
    (proof) => {
      const before = tables(),
        after = tables()
      after.skill_current[0].active = 0
      after.skill_catalogue_state[0].revision++
      const result = compare(before, after, proof)
      expect(result.rows).toHaveLength(1)
      expect(result.skills).toContain('an existing skill head changed')
    },
  )
  it('requires an availability change to advance the catalogue revision', () => {
    const before = tables(),
      after = tables()
    after.skill_current[0].active = 0
    expect(skillsKept(before, after, proofFor([]))).toContain(
      'a changed catalogue did not advance its revision',
    )
  })
  it.each(['body', 'missing', 'frontmatter', 'duplicate', 'path'])(
    'does not trust candidate membership with invalid %s evidence',
    (fault) => {
      const { manifest, bodies } = candidateBundle(['delegate'])
      if (fault === 'body') bodies.set('delegate', Buffer.from('Different.'))
      if (fault === 'missing') bodies.clear()
      if (fault === 'frontmatter') {
        const body = Buffer.from(
          bodies.get('delegate').toString().replace('name: delegate', 'name: other'),
        )
        bodies.set('delegate', body)
      }
      if (fault === 'duplicate') {
        manifest.skills.push({ ...manifest.skills[0] })
        bodies.set('other', bodies.get('delegate'))
      }
      if (fault === 'path') manifest.skills[0].name = '../delegate'
      expect(() => verifyCandidateSkills(manifest, bodies)).toThrow()
    },
  )
  it.each([
    'missing-reminder',
    'missing-codex',
    'missing-claude',
    'wrong-name',
    'wrong-pair',
    'multiline',
    'too-long',
    'unknown-manifest-key',
    'unknown-entry-key',
    'unknown-reminder-key',
  ])('refuses a candidate manifest with %s', (fault) => {
    const { manifest, bodies } = candidateBundle(['delegate'])
    const entry = manifest.skills[0]
    if (fault === 'missing-reminder') delete entry.reminder
    if (fault === 'missing-codex') delete entry.reminder.codex
    if (fault === 'missing-claude') delete entry.reminder.claude
    if (fault === 'wrong-name') {
      entry.reminder.codex = 'other — Use fake data.'
      entry.reminder.claude = `brobot:${entry.reminder.codex}`
    }
    if (fault === 'wrong-pair') entry.reminder.claude = 'brobot:delegate — Different words.'
    if (fault === 'multiline') {
      entry.reminder.codex += '\nMore words.'
      entry.reminder.claude = `brobot:${entry.reminder.codex}`
    }
    if (fault === 'too-long') {
      entry.reminder.codex = 'delegate — ' + 'x'.repeat(241 - 'delegate — '.length)
      entry.reminder.claude = `brobot:${entry.reminder.codex}`
    }
    if (fault === 'unknown-manifest-key') manifest.extra = true
    if (fault === 'unknown-entry-key') entry.extra = true
    if (fault === 'unknown-reminder-key') entry.reminder.extra = true
    expect(() => verifyCandidateSkills(manifest, bodies)).toThrow()
  })
  it.each([1, 2])('accepts reminders at the app format limits for format %d', (format) => {
    const { manifest, bodies } = candidateBundle(['delegate'])
    manifest.formatVersion = format
    const text = 'delegate — ' + 'x'.repeat(240 - 'delegate — '.length)
    manifest.skills[0].reminder = format === 1 ? { codex: text, claude: `brobot:${text}` } : text
    expect(verifyCandidateSkills(manifest, bodies).names).toEqual(['delegate'])
  })
  it.each(['pair', 'wrong-name', 'multiline', 'too-long'])(
    'refuses a neutral candidate reminder with %s',
    (fault) => {
      const { manifest, bodies } = candidateBundle(['delegate'])
      manifest.formatVersion = 2
      const entry = manifest.skills[0]
      if (fault !== 'pair') entry.reminder = entry.reminder.codex
      if (fault === 'wrong-name') entry.reminder = 'other — Use fake data.'
      if (fault === 'multiline') entry.reminder += '\nMore words.'
      if (fault === 'too-long')
        entry.reminder = 'delegate — ' + 'x'.repeat(241 - 'delegate — '.length)
      expect(() => verifyCandidateSkills(manifest, bodies)).toThrow()
    },
  )
  it('verifies the candidate source bundle with the same body checks', () => {
    const folder = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../apps/desktop/resources/built-in-skills',
    )
    const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))
    const bodies = new Map(
      manifest.skills.map(({ name }) => [name, readFileSync(join(folder, name, 'SKILL.md'))]),
    )
    expect(verifyCandidateSkills(manifest, bodies).names).toEqual(
      manifest.skills.map(({ name }) => name),
    )
  })
  it('requires all four tables even when upgrading from before skills existed', () => {
    expect(skillsKept({}, tables())).toEqual([])
    for (const name of Object.keys(tables())) {
      const missing = tables()
      delete missing[name]
      expect(skillsKept({}, missing)).toContain(`${name} is missing`)
    }
  })
  it('allows a new built-in version but preserves choices and immutable bodies', () => {
    const before = tables(),
      after = tables()
    const next = skill('built-in/delegate', 'v24')
    after.skill_version.push(next)
    after.skill_current[0].current_version = next.id
    after.skill_catalogue_state[0].revision++
    expect(rowsPreserved(before, after).lost).toEqual([])
    expect(skillsKept(before, after)).toEqual([])
    after.skill_selection[0].choice = 'on'
    expect(skillsKept(before, after)).toContain('skill_selection lost or changed a row')
  })
  it.each(['body', 'alias', 'missing-version', 'backwards', 'unadvanced', 'lost-head', 'personal'])(
    'catches %s changes rather than widening the generic row allowance',
    (fault) => {
      const before = tables(),
        after = tables()
      if (fault === 'body') after.skill_version[0].body += 'changed'
      if (fault === 'alias') after.skill_current[0].alias = 'wrong'
      if (fault === 'missing-version') after.skill_version = []
      if (fault === 'backwards') after.skill_catalogue_state[0].revision = 0
      if (fault === 'unadvanced') {
        const next = skill('built-in/delegate', 'v24')
        after.skill_version.push(next)
        after.skill_current[0].current_version = next.id
      }
      if (fault === 'lost-head') after.skill_current = []
      if (fault === 'personal') {
        const previous = skill('person/recipe-check', 'v1'),
          next = skill('person/recipe-check', 'v2')
        before.skill_version.push(previous)
        after.skill_version.push(previous, next)
        before.skill_current.push({
          id: previous.skill_id,
          alias: 'recipe-check',
          active: 1,
          current_version: previous.id,
        })
        after.skill_current.push({
          id: next.skill_id,
          alias: 'recipe-check',
          active: 1,
          current_version: next.id,
        })
        after.skill_catalogue_state[0].revision++
      }
      expect(skillsKept(before, after).length).toBeGreaterThan(0)
    },
  )
})
