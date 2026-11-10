import { expect, it, vi } from 'vitest'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { SkillsRequest, SkillsWindow } from '../src/shared/skills-window'

const source =
  '---\r\nname: recipe-check\r\ndescription: Check a fictional recipe.\r\n---\r\n\r\n# Recipe\r\nCheck the flour.\r\n'
const draft = {
  name: 'recipe-check',
  description: 'Check a fictional recipe.',
  reminder: 'Check quantities.',
  body: source,
}
function sink(person: boolean): RuntimeEventSink {
  return {
    ownerId: person ? 'webContents:fictional' : 'agent:fictional',
    alive: true,
    aPersonIsBehindIt: person,
    send: () => {},
    sendLiveness: () => {},
  }
}
function host(run: SkillsWindow): RuntimeHost {
  return { closing: false, skillsForAPerson: run } as unknown as RuntimeHost
}

it.each<SkillsRequest>([
  { operation: 'list', offset: 0 },
  { operation: 'detail', id: 'person/recipe-check' },
  { operation: 'choices', identityId: 'aid:recipe-reviewer' },
  { operation: 'import' },
  { operation: 'save', draft, revision: 0, versionId: null },
  {
    operation: 'select',
    identityId: 'aid:recipe-reviewer',
    id: 'built-in/remember',
    revision: 0,
    selection: 'off',
  },
])('refuses a non-person before the %j operation reaches the service', async (request) => {
  const run = vi.fn<SkillsWindow>()
  await expect(
    executeRuntimeCommand(host(run), sink(false), { kind: 'skills', request }),
  ).rejects.toThrow('unless a person is asking')
  expect(run).not.toHaveBeenCalled()
})

it('refuses writes and imports during quit before calling the service', async () => {
  const run = vi.fn<SkillsWindow>()
  const quitting = { closing: true, skillsForAPerson: run } as unknown as RuntimeHost
  await expect(
    executeRuntimeCommand(quitting, sink(true), {
      kind: 'skills',
      request: { operation: 'import' },
    }),
  ).rejects.toThrow()
  expect(run).not.toHaveBeenCalled()
})

it('strictly refuses forged grants and oversized editor payloads at the wire', async () => {
  const run = vi.fn<SkillsWindow>()
  for (const request of [
    { operation: 'choices', identityId: 'aid:recipe-reviewer', canCreateAgents: true },
    {
      operation: 'save',
      draft: { ...draft, body: 'x'.repeat(65537) },
      revision: 0,
      versionId: null,
    },
  ])
    await expect(
      executeRuntimeCommand(host(run), sink(true), { kind: 'skills', request }),
    ).rejects.toThrow('invalid runtime command')
  expect(run).not.toHaveBeenCalled()
})
