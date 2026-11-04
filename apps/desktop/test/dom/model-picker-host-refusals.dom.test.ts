import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ModelPicker from '../../src/renderer/src/components/ModelPicker.vue'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import type { ListedModel, ModelList, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

afterEach(unmountAll)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const words = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
const button = (m: Mounted, cy: string): HTMLButtonElement => m.q(cy) as HTMLButtonElement
const row = (id: string, addedBy: ListedModel['addedBy']): ListedModel => ({
  id,
  label: id,
  addedBy,
  efforts: [{ id: 'high', label: 'High', description: 'More time for reasoning.' }],
  defaultEffort: 'high',
})

function picker() {
  let models = [row('listed-model', 'the-provider'), row('personal-model', 'a-person')]
  const list = (): ModelList => ({
    provider: 'codex',
    models,
    notAsked: null,
    standIn: null,
    lastPicked: null,
    startsOn: null,
  })
  const host = {
    modelList: vi.fn(async () => list()),
    addHandAddedModel: vi.fn(async ({ model }: { provider: string; model: string }) => {
      models = [...models, row(model, 'a-person')]
      return models.filter((one) => one.addedBy === 'a-person').map((one) => one.id)
    }),
    deleteHandAddedModel: vi.fn(async ({ model }: { provider: string; model: string }) => {
      models = models.filter((one) => one.id !== model)
      return models.filter((one) => one.addedBy === 'a-person').map((one) => one.id)
    }),
  } satisfies Pick<RuntimeBridge, 'modelList' | 'addHandAddedModel' | 'deleteHandAddedModel'>
  const take = vi.fn(async (): Promise<string | null> => null)
  const m = mount(ModelPicker, {
    providers: ['codex'],
    profileId: 'fictional-worker',
    shown: null,
    takeWords: 'Use this model',
    take,
    lists: createModelLists(() => host),
  })
  return { m, host, take }
}

async function open(m: Mounted): Promise<void> {
  button(m, 'model-picker-face').click()
  await expect.poll(() => m.all('model-picker-row').length).toBe(2)
  expect(words(m.q('model-picker-panel'))).toContain('Codex')
}

async function draft(m: Mounted, id: string): Promise<void> {
  const selected = m.all('model-picker-row').find((one) => words(one).includes(id))
  expect(selected).toBeDefined()
  selected!.querySelector('input')!.click()
  await nextTick()
}

async function typeName(m: Mounted, name: string): Promise<void> {
  const input = m.q('model-picker-add-name') as HTMLInputElement
  input.value = name
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

describe('model picker host refusals and pending gestures', () => {
  it('blocks repeated confirmation while pending, shows a thrown refusal, and retries by Enter', async () => {
    const { m, take } = picker()
    const pending = deferred<string | null>()
    take.mockImplementationOnce(() => pending.promise)
    await open(m)
    expect(button(m, 'model-picker-take').disabled).toBe(true)
    await draft(m, 'listed-model')
    expect(words(m.q('model-picker-effort-said'))).toBe('More time for reasoning.')
    button(m, 'model-picker-take').click()
    await nextTick()
    expect(button(m, 'model-picker-take').disabled).toBe(true)
    button(m, 'model-picker-take').click()
    const level = m.q('model-picker-effort').querySelector('input')!
    level.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(take).toHaveBeenCalledTimes(1)
    expect(take).toHaveBeenLastCalledWith({
      provider: 'codex',
      model: 'listed-model',
      effort: 'high',
    })

    pending.reject(new Error('The fictional host refused this choice.'))
    await expect.poll(() => m.all('model-picker-refusal').length).toBe(1)
    expect(words(m.q('model-picker-refusal'))).toBe('The fictional host refused this choice.')
    expect(button(m, 'model-picker-take').disabled).toBe(false)
    expect(m.q('model-picker-panel').matches(':popover-open')).toBe(true)
    level.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await expect.poll(() => m.q('model-picker-panel').matches(':popover-open')).toBe(false)
    expect(take).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(m.q('model-picker-face'))
  })

  it('keeps a refused addition editable and retries its trimmed id without duplicate pending writes', async () => {
    const { m, host } = picker()
    const pending = deferred<string[]>()
    host.addHandAddedModel.mockImplementationOnce(() => pending.promise)
    await open(m)
    button(m, 'model-picker-add-open').click()
    await nextTick()
    await typeName(m, '   ')
    expect(button(m, 'model-picker-add').disabled).toBe(true)
    button(m, 'model-picker-add').click()
    expect(host.addHandAddedModel).not.toHaveBeenCalled()
    await typeName(m, '  extra-model  ')
    m.q('model-picker-add-name').dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
      }),
    )
    await nextTick()
    expect(button(m, 'model-picker-add').disabled).toBe(true)
    expect(button(m, 'model-picker-delete').disabled).toBe(true)
    button(m, 'model-picker-add').click()
    expect(host.addHandAddedModel).toHaveBeenCalledExactlyOnceWith({
      provider: 'codex',
      model: 'extra-model',
    })
    pending.reject(new Error('This fictional list is temporarily read-only.'))
    await expect.poll(() => m.all('model-picker-add-said').length).toBe(1)
    expect(words(m.q('model-picker-add-said'))).toBe(
      'This fictional list is temporarily read-only.',
    )
    expect((m.q('model-picker-add-name') as HTMLInputElement).value).toBe('  extra-model  ')
    expect(button(m, 'model-picker-add').disabled).toBe(false)
    button(m, 'model-picker-add').click()
    await expect.poll(() => m.all('model-picker-add-name').length).toBe(0)
    const added = m.all('model-picker-row').find((one) => words(one).includes('extra-model'))!
    expect(words(added)).toContain('added by you')
    expect(added.querySelector('input')!.checked).toBe(true)
    expect(host.addHandAddedModel).toHaveBeenCalledTimes(2)
    expect(m.all('model-picker-add-said')).toHaveLength(0)
  })

  it('selects an already listed id without writing a second row', async () => {
    const { m, host, take } = picker()
    await open(m)
    button(m, 'model-picker-add-open').click()
    await nextTick()
    await typeName(m, ' LISTED-MODEL ')
    button(m, 'model-picker-add').click()
    await expect.poll(() => m.all('model-picker-add-name').length).toBe(0)
    expect(words(m.q('model-picker-add-said'))).toBe(
      '“LISTED-MODEL” is already in Codex’s list — selected it.',
    )
    expect(host.addHandAddedModel).not.toHaveBeenCalled()
    button(m, 'model-picker-take').click()
    await expect.poll(() => take.mock.calls.length).toBe(1)
    expect(take).toHaveBeenLastCalledWith({
      provider: 'codex',
      model: 'listed-model',
      effort: 'high',
    })
  })

  it('keeps a refused deletion selected, then removes it on retry and waits for another choice', async () => {
    const { m, host } = picker()
    const pending = deferred<string[]>()
    host.deleteHandAddedModel.mockImplementationOnce(() => pending.promise)
    await open(m)
    await draft(m, 'personal-model')
    button(m, 'model-picker-delete').click()
    await nextTick()
    expect(button(m, 'model-picker-delete').disabled).toBe(true)
    button(m, 'model-picker-delete').click()
    expect(host.deleteHandAddedModel).toHaveBeenCalledExactlyOnceWith({
      provider: 'codex',
      model: 'personal-model',
    })
    pending.reject(new Error('The fictional host kept the model.'))
    await expect.poll(() => m.all('model-picker-add-said').length).toBe(1)
    expect(words(m.q('model-picker-add-said'))).toBe('The fictional host kept the model.')
    expect(button(m, 'model-picker-delete').disabled).toBe(false)
    const personal = m.all('model-picker-row').find((one) => words(one).includes('personal-model'))!
    expect(personal.querySelector('input')!.checked).toBe(true)
    button(m, 'model-picker-delete').click()
    await expect.poll(() => m.all('model-picker-row').length).toBe(1)
    expect(words(m.q('model-picker-row'))).toContain('listed-model')
    expect(button(m, 'model-picker-take').disabled).toBe(true)
    expect(document.activeElement).toBe(m.q('model-picker-add-open'))
    expect(host.deleteHandAddedModel).toHaveBeenCalledTimes(2)
  })
})
