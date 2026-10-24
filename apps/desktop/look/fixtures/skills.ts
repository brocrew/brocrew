import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities, RuntimeBridge } from '../../src/shared/runtime-ipc'
import type { SkillDetail, SkillSelection } from '../../src/shared/skills-catalogue'
import type { SkillsWindow } from '../../src/shared/skills-window'
import { createAgentStore } from '../../src/renderer/src/lib/agent-store'

export const SKILLS_CAST: AgentIdentities = {
  identities: [
    {
      id: 'aid:recipe-reviewer',
      slug: 'recipe-reviewer',
      displayName: 'Mira',
      createdAt: 1,
      createdBy: null,
      provider: 'codex',
      externalMcpServerIds: [],
      capabilities: { ...DEFAULT_CAPABILITIES },
      chosen: {
        maxDepth: 'default',
        canMessage: 'default',
        canAssignWork: 'default',
        canCreateAgents: 'default',
        canWriteRules: 'default',
      },
    },
    {
      id: 'aid:recipe-writer',
      slug: 'recipe-writer',
      displayName: 'Theo',
      createdAt: 1,
      createdBy: null,
      provider: 'claude',
      externalMcpServerIds: [],
      capabilities: { ...DEFAULT_CAPABILITIES },
      chosen: {
        maxDepth: 'default',
        canMessage: 'default',
        canAssignWork: 'default',
        canCreateAgents: 'default',
        canWriteRules: 'default',
      },
    },
  ],
  use: [],
  foldersWithoutARow: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}
export function fictionalSkills() {
  function skill(name: string, personal = false): SkillDetail {
    const id = `${personal ? 'person' : 'built-in'}/${name}`
    const description = personal
      ? 'Check the ingredients before sharing a recipe.'
      : 'Ask when the recipe needs a decision.'
    const body = `---\nname: ${name}\ndescription: ${description}\n---\n\n# A fictional recipe\n\nCheck the flour, water and timing. Ask before changing a quantity.\n`
    return {
      id,
      name,
      description,
      origin: personal ? { kind: 'person' } : { kind: 'built-in' },
      alias: name,
      version: personal ? 'v2' : 'v23',
      versionId: `${id}@fictional-v2`,
      reminder: 'Check the quantities.',
      body,
      path: `${name}/SKILL.md`,
      bytes: body.length,
      sha256: 'a'.repeat(64),
      createdAt: 1,
      package: null,
      requirement: null,
      active: true,
      defaultEnabled: !personal,
    }
  }
  const state = {
    revision: 1,
    failRead: false,
    failSave: false,
    failChoice: false,
    pendingList: null as Promise<void> | null,
  }
  const skills = new Map(
    [skill('ask-and-wait'), skill('recipe-check', true)].map((one) => [one.id, one]),
  )
  const selections = new Map<string, SkillSelection>()
  const reading = (identityId: string) => ({
    revision: state.revision,
    identityId,
    choices: [...skills.values()].map((one) => {
      const selection = selections.get(`${identityId}:${one.id}`) ?? 'default'
      const selected = selection === 'on' || (selection === 'default' && one.defaultEnabled)
      return { skill: one, selection, selected, eligible: true, ready: selected, reason: null }
    }),
  })
  const bridge: SkillsWindow = async (input) => {
    const request = structuredClone(input)
    if (request.operation === 'shared-list') {
      if (state.pendingList) await state.pendingList
      if (state.failRead) throw new Error('fictional read failure')
      return {
        operation: 'shared-list',
        skills: [...skills.values()].map((one) => ({
          folder: one.name,
          name: one.name,
          description: one.description,
          body: one.body,
          builtIn: one.origin.kind === 'built-in',
          enabled: one.active,
        })),
      }
    }
    if (request.operation === 'shared-toggle') {
      if (state.failSave) throw new Error('fictional save failure')
      for (const [id, skill] of skills)
        if (skill.name === request.folder && skill.origin.kind !== 'built-in')
          skills.set(id, { ...skill, active: request.enabled })
      return { operation: 'shared-toggle' }
    }
    // This editor preview has no main-owned profile grant resolver.
    if (request.operation === 'profile-list')
      return { operation: 'refused', reason: 'source-unavailable' }
    if (request.operation === 'list') {
      if (state.pendingList) await state.pendingList
      if (state.failRead) throw new Error('fictional read failure')
      return {
        operation: 'list',
        page: {
          revision: state.revision,
          total: skills.size,
          items: [...skills.values()].slice(request.offset, request.offset + 50).map((one) => ({
            id: one.id,
            name: one.name,
            description: one.description,
            origin: one.origin,
            alias: one.alias,
            version: one.version,
            versionId: one.versionId,
            reminder: one.reminder,
            bytes: one.bytes,
            sha256: one.sha256,
            package: one.package,
            requirement: one.requirement,
            active: one.active,
            defaultEnabled: one.defaultEnabled,
          })),
        },
      }
    }
    if (request.operation === 'detail')
      return { operation: 'detail', skill: skills.get(request.id) ?? null }
    if (request.operation === 'choices')
      return { operation: 'choices', reading: reading(request.identityId) }
    if (request.operation === 'import')
      return {
        operation: 'import',
        skill: {
          name: 'oven-check',
          description: 'Check a fictional oven.',
          body: '---\nname: oven-check\ndescription: Check a fictional oven.\n---\n\nCheck the temperature.\n',
        },
      }
    if (request.operation === 'select') {
      if (state.failChoice) return { operation: 'refused', reason: 'stale' }
      selections.set(`${request.identityId}:${request.id}`, request.selection)
      state.revision++
      return { operation: 'select', revision: state.revision, reading: reading(request.identityId) }
    }
    if (state.failSave) return { operation: 'refused', reason: 'stale' }
    const one = skill(request.draft.name, true)
    const was = skills.get(one.id)
    skills.set(one.id, {
      ...one,
      ...request.draft,
      version: was ? 'v3' : 'v1',
      versionId: `${one.id}@fictional-new`,
    })
    return { operation: 'save', revision: ++state.revision }
  }
  const store = createAgentStore({ agentIdentities: async () => SKILLS_CAST } as RuntimeBridge)
  return { state, skills, selections, reading, bridge, store }
}
