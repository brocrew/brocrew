import { describe, expect, it } from 'vitest'
import {
  PluginSkillBundle,
  SkillDraft,
  SkillOrigin,
  SkillSelection,
} from '../src/shared/skills-catalogue'

const draft = {
  name: 'recipe-check',
  description: 'Check a fictional recipe.',
  reminder: 'Check quantities.',
  path: 'recipe-check/SKILL.md',
  body: 'Fictional instruction.',
  bytes: 23,
  sha256: 'a'.repeat(64),
}
describe('the shared skill catalogue contract', () => {
  it('admits a bounded document and all three origins without granting capabilities', () => {
    expect(SkillDraft.parse(draft)).toEqual(draft)
    for (const origin of [
      { kind: 'built-in' },
      { kind: 'person' },
      { kind: 'plugin', pluginId: 'recipe-kit' },
    ])
      expect(SkillOrigin.parse(origin)).toEqual(origin)
    expect(SkillDraft.safeParse({ ...draft, canCreateAgents: true }).success).toBe(false)
    expect(SkillSelection.options).toEqual(['default', 'on', 'off'])
  })
  it.each([
    { name: '../escape' },
    { description: '' },
    { reminder: 'x'.repeat(161) },
    { bytes: 65537 },
    { sha256: 'not-a-digest' },
    { body: '' },
  ])('refuses malformed declaration %j', (over) => {
    expect(SkillDraft.safeParse({ ...draft, ...over }).success).toBe(false)
  })
  it('requires pinned plugin provenance and declares no run command', () => {
    const bundle = {
      pluginId: 'recipe-kit',
      packageVersion: '1',
      packageSha256: 'b'.repeat(64),
      skills: [{ ...draft, version: '1' }],
    }
    expect(PluginSkillBundle.parse(bundle)).toEqual(bundle)
    expect(PluginSkillBundle.safeParse({ ...bundle, run: 'fictional-command' }).success).toBe(false)
    expect(PluginSkillBundle.safeParse({ ...bundle, packageSha256: '' }).success).toBe(false)
  })
})
