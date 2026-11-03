import { expect, it, vi } from 'vitest'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import type { RuntimeHost, RuntimeEventSink } from '../src/main/runtime/runtime-host'

const sink: RuntimeEventSink = {
  ownerId: 'fictional-window',
  aPersonIsBehindIt: true,
  alive: true,
  send: () => {},
  sendLiveness: () => {},
}

it('keeps a canonical connection reference on a model-list command through dispatch', async () => {
  const input = {
    kind: 'modelList',
    provider: 'claude',
    profileId: 'fern',
    connectionId: 'claude:sign-in',
  }
  const command = runtimeCommandSchema.parse(input)
  expect(command).toEqual(input)
  const modelList = vi.fn(async () => ({ fictional: true }))
  await executeRuntimeCommand({ modelList } as unknown as RuntimeHost, sink, command)
  expect(modelList).toHaveBeenCalledExactlyOnceWith('claude', 'fern', 'claude:sign-in')
})

it('keeps provider, connection and model together on the person-default door', async () => {
  const input = {
    kind: 'setAgentModelAndEffort',
    profileId: 'fern',
    provider: 'codex',
    connectionId: 'codex:api-key',
    model: 'fictional-small',
    effort: 'medium',
  }
  const command = runtimeCommandSchema.parse(input)
  expect(command).toEqual(input)
  const save = vi.fn(async () => ({ ok: true }))
  await executeRuntimeCommand(
    { setAgentModelAndEffort: save } as unknown as RuntimeHost,
    sink,
    command,
  )
  expect(save).toHaveBeenCalledExactlyOnceWith('fern', {
    provider: 'codex',
    connectionId: 'codex:api-key',
    model: 'fictional-small',
    effort: 'medium',
  })
})

it('does not accept a selected connection beside a cleared provider and model', () => {
  expect(
    runtimeCommandSchema.safeParse({
      kind: 'setAgentModelAndEffort',
      profileId: 'fern',
      provider: null,
      model: null,
      effort: null,
      connectionId: 'claude:sign-in',
    }).success,
  ).toBe(false)
})

it('keeps an omitted legacy model-list payload and dispatch unchanged', async () => {
  const input = { kind: 'modelList', provider: 'claude' }
  const command = runtimeCommandSchema.parse(input)
  expect(command).toEqual(input)
  const modelList = vi.fn(async () => ({ fictional: true }))
  await executeRuntimeCommand({ modelList } as unknown as RuntimeHost, sink, command)
  expect(modelList).toHaveBeenCalledExactlyOnceWith('claude', 'brobot')
})

it('still accepts the legacy all-null clear', () => {
  const input = {
    kind: 'setAgentModelAndEffort',
    profileId: 'fern',
    provider: null,
    model: null,
    effort: null,
  }
  expect(runtimeCommandSchema.parse(input)).toEqual(input)
})
