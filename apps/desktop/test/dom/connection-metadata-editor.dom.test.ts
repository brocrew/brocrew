import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import { PROVIDER_DESCRIPTORS, type Provider, type ProviderConnection } from '@brobot2/shared'
import ProvidersScreen from '../../src/renderer/src/components/ProvidersScreen.vue'
import ProviderConnections from '../../src/renderer/src/components/ProviderConnections.vue'
import type { ProvidersChangedMessage } from '../../src/shared/runtime-ipc'
import { providersBridge, providerConnectionFixtures } from '../../look/fixtures/providers'
import { mount, unmountAll, type Mounted } from './harness'

type MetadataEdit = {
  provider: Provider
  connectionId: string
  name: string
  description: string | null
}
const settle = async () => {
  for (let n = 0; n < 5; n++) {
    await nextTick()
    await new Promise((done) => setTimeout(done, 0))
  }
}
afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'api')
})
function input(m: Mounted, id: string, value: string) {
  const field = m.q(id) as HTMLInputElement | HTMLTextAreaElement
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
function editSelected(m: Mounted, selected: ProviderConnection) {
  const entry = m
    .all('provider-connection')
    .find(
      (row) =>
        row.querySelector('strong')?.textContent ===
        `${selected.provider === 'claude' ? 'Fern' : 'Birch'} · ${selected.name}`,
    )
  expect(entry).toBeDefined()
  const edit = entry!.querySelector<HTMLButtonElement>('[data-cy=connection-edit]')
  expect(edit).not.toBeNull()
  edit!.click()
}
async function drawer(provider: Provider) {
  providersBridge()
  let rows = providerConnectionFixtures().map((row) => ({
    ...row,
    description: row.id === `${provider}:sign-in` ? 'Fictional existing description' : null,
  }))
  const selected = rows.find((row) => row.id === `${provider}:sign-in`)!
  const read = vi.fn(async () => rows)
  const listeners = new Set<(message: ProvidersChangedMessage) => void>()
  const update = vi.fn<(edit: MetadataEdit) => Promise<ProviderConnection>>(async (edit) => {
    const row = rows.find((row) => row.provider === edit.provider && row.id === edit.connectionId)!
    const changed = { ...row, name: edit.name, description: edit.description }
    rows = rows.map((row) => (row.id === changed.id ? changed : row))
    return changed
  })
  const auth = vi.spyOn(window.api.runtime, 'signInProvider')
  const key = vi.spyOn(window.api.runtime, 'setApiKey')
  Object.assign(window.api.runtime, {
    providerConnections: read,
    updateProviderConnection: update,
    onProvidersChanged: (listener: (message: ProvidersChangedMessage) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  })
  const shown = ref<Provider>(provider)
  const component: Component = ProviderConnections
  const Frame = defineComponent(
    () => () =>
      h(component, {
        provider: shown.value,
        name: shown.value === 'claude' ? 'Fern' : 'Birch',
        keyAuth: null,
        signInAuth: null,
        keyStatus: null,
        loginMoved: 0,
        modelsKnown: false,
      }),
  )
  const m = mount(Frame, {})
  await settle()
  return {
    m,
    selected,
    update,
    auth,
    key,
    read,
    rows: () => rows,
    changeProvider: (next: Provider) => {
      shown.value = next
    },
    refresh: () => {
      for (const listener of listeners) listener({ what: 'connections', provider })
    },
  }
}
for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: edits display metadata with the exact selected identity and renders its saved result`, async () => {
    const f = await drawer(provider)
    editSelected(f.m, f.selected)
    await settle()
    expect((f.m.q('connection-name') as HTMLInputElement).value).toBe(f.selected.name)
    expect((f.m.q('connection-description') as HTMLTextAreaElement).value).toBe(
      'Fictional existing description',
    )
    input(f.m, 'connection-name', 'Fictional research')
    input(f.m, 'connection-description', 'Writing and research')
    f.m.q('connection-save').click()
    await settle()
    expect(f.update.mock.calls).toEqual([
      [
        {
          provider,
          connectionId: f.selected.id,
          name: 'Fictional research',
          description: 'Writing and research',
        },
      ],
    ])
    expect(f.m.all('connection-editor')).toHaveLength(0)
    const row = f.m
      .all('provider-connection')
      .find((row) => row.textContent?.includes('Fictional research'))!
    expect(row.textContent).toContain('Writing and research')
    expect(f.rows().find((row) => row.id === f.selected.id)).toMatchObject({
      id: f.selected.id,
      authMethod: f.selected.authMethod,
      credentialSource: f.selected.credentialSource,
    })
    expect(f.auth).not.toHaveBeenCalled()
    expect(f.key).not.toHaveBeenCalled()
  })

  it(`${provider}: cancelling a metadata draft writes nothing and retains the existing entry`, async () => {
    const f = await drawer(provider)
    editSelected(f.m, f.selected)
    await settle()
    input(f.m, 'connection-name', 'Fictional unsaved name')
    input(f.m, 'connection-description', 'Fictional unsaved description')
    f.m.q('connection-cancel').click()
    await settle()
    expect(f.update).not.toHaveBeenCalled()
    expect(f.m.all('connection-editor')).toHaveLength(0)
    expect(f.m.host.textContent).toContain(f.selected.name)
    expect(f.m.host.textContent).not.toContain('Fictional unsaved name')
    expect(f.auth).not.toHaveBeenCalled()
    expect(f.key).not.toHaveBeenCalled()
  })

  it(`${provider}: a refused save retains both drafts and a successful retry saves the same selected identity`, async () => {
    const f = await drawer(provider)
    f.update.mockRejectedValueOnce(new Error('Fictional connection name already exists.'))
    editSelected(f.m, f.selected)
    await settle()
    input(f.m, 'connection-name', 'Fictional duplicate')
    input(f.m, 'connection-description', 'Fictional retained draft')
    f.m.q('connection-save').click()
    await settle()
    expect(f.update).toHaveBeenCalledOnce()
    expect(f.m.q('connection-error').textContent).toContain(
      'Fictional connection name already exists.',
    )
    expect((f.m.q('connection-name') as HTMLInputElement).value).toBe('Fictional duplicate')
    expect((f.m.q('connection-description') as HTMLTextAreaElement).value).toBe(
      'Fictional retained draft',
    )
    expect((f.m.q('connection-save') as HTMLButtonElement).disabled).toBe(false)
    expect(f.rows().find((row) => row.id === f.selected.id)).toEqual(f.selected)
    input(f.m, 'connection-name', 'Fictional unique retry')
    f.m.q('connection-save').click()
    await settle()
    expect(f.update.mock.calls).toEqual([
      [
        {
          provider,
          connectionId: f.selected.id,
          name: 'Fictional duplicate',
          description: 'Fictional retained draft',
        },
      ],
      [
        {
          provider,
          connectionId: f.selected.id,
          name: 'Fictional unique retry',
          description: 'Fictional retained draft',
        },
      ],
    ])
    expect(f.m.all('connection-editor')).toHaveLength(0)
    const changed = f.m
      .all('provider-connection')
      .find(
        (row) =>
          row.querySelector('strong')?.textContent ===
          `${provider === 'claude' ? 'Fern' : 'Birch'} · Fictional unique retry`,
      )
    expect(changed).toBeDefined()
    expect(changed!.textContent).toContain('Fictional retained draft')
    expect(f.rows().find((row) => row.id === f.selected.id)).toMatchObject({
      id: f.selected.id,
      name: 'Fictional unique retry',
      description: 'Fictional retained draft',
      authMethod: f.selected.authMethod,
      credentialSource: f.selected.credentialSource,
    })
    expect(f.auth).not.toHaveBeenCalled()
    expect(f.key).not.toHaveBeenCalled()
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: a composed Providers metadata save refreshes names without authentication or usage work`, async () => {
    providersBridge()
    let rows = providerConnectionFixtures()
    const selected = rows.find((row) => row.id === `${provider}:sign-in`)!
    const listeners = new Set<(message: { what: 'connections'; provider: Provider }) => void>()
    const read = vi.fn(async () => rows)
    const auth = vi.spyOn(window.api.runtime, 'checkProviderAuth')
    const keyRead = vi.spyOn(window.api.runtime, 'apiKeyStatus')
    const keyWrite = vi.spyOn(window.api.runtime, 'setApiKey')
    const signIn = vi.spyOn(window.api.runtime, 'signInProvider')
    const usage = vi.spyOn(window.api.runtime, 'providerUsage')
    const models = vi.spyOn(window.api.runtime, 'providerLaunchChoices')
    const update = vi.fn<(edit: MetadataEdit) => Promise<ProviderConnection>>(async (edit) => {
      const row = rows.find(
        (row) => row.id === edit.connectionId && row.provider === edit.provider,
      )!
      const changed = { ...row, name: edit.name, description: edit.description }
      rows = rows.map((row) => (row.id === changed.id ? changed : row))
      for (const listener of listeners) listener({ what: 'connections', provider })
      return changed
    })
    Object.assign(window.api.runtime, {
      providerConnections: read,
      updateProviderConnection: update,
      onProvidersChanged: (
        listener: (message: { what: 'connections'; provider: Provider }) => void,
      ) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    })
    const m = mount(ProvidersScreen, {
      capabilities: null,
      warnings: null,
      clock: Date.now(),
      descriptors: PROVIDER_DESCRIPTORS.map((row) => ({
        ...row,
        displayName: row.id === 'claude' ? 'Fern' : 'Birch',
      })),
    })
    await settle()
    const providerRow = m.host.querySelector<HTMLButtonElement>(
      `[data-cy=provider-row][data-provider=${provider}]`,
    )
    expect(providerRow).not.toBeNull()
    providerRow!.click()
    await settle()
    editSelected(m, selected)
    await settle()
    const readsBeforeSave = read.mock.calls.length
    const history = {
      auth: [...auth.mock.calls],
      key: [...keyRead.mock.calls],
      usage: [...usage.mock.calls],
      models: [...models.mock.calls],
    }
    input(m, 'connection-name', 'Fictional renamed in screen')
    input(m, 'connection-description', 'Fictional screen description')
    m.q('connection-save').click()
    await settle()
    expect(update.mock.calls).toEqual([
      [
        {
          provider,
          connectionId: selected.id,
          name: 'Fictional renamed in screen',
          description: 'Fictional screen description',
        },
      ],
    ])
    expect(
      m
        .all('provider-connection')
        .some((row) => row.textContent?.includes('Fictional renamed in screen')),
    ).toBe(true)
    expect(auth.mock.calls).toEqual(history.auth)
    expect(keyRead.mock.calls).toEqual(history.key)
    expect(usage.mock.calls).toEqual(history.usage)
    expect(models.mock.calls).toEqual(history.models)
    expect(read).toHaveBeenCalledTimes(readsBeforeSave + 1)
    const externalId = `${provider}:api-key`
    rows = rows.map((row) =>
      row.id === externalId ? { ...row, name: 'Fictional external rename' } : row,
    )
    for (const listener of listeners) listener({ what: 'connections', provider })
    await settle()
    expect(read).toHaveBeenCalledTimes(readsBeforeSave + 2)
    expect(
      m
        .all('provider-connection')
        .some((row) => row.textContent?.includes('Fictional external rename')),
    ).toBe(true)
    expect(update).toHaveBeenCalledOnce()
    expect(auth.mock.calls).toEqual(history.auth)
    expect(keyRead.mock.calls).toEqual(history.key)
    expect(usage.mock.calls).toEqual(history.usage)
    expect(models.mock.calls).toEqual(history.models)
    expect(signIn).not.toHaveBeenCalled()
    expect(keyWrite).not.toHaveBeenCalled()
  })
}

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: pending, failed and empty metadata refreshes retain the same unfinished input and Cancel`, async () => {
    const f = await drawer(provider)
    editSelected(f.m, f.selected)
    await settle()
    input(f.m, 'connection-name', 'Fictional unfinished name')
    input(f.m, 'connection-description', 'Fictional retained text')
    const field = f.m.q('connection-description') as HTMLTextAreaElement
    field.focus()
    field.setSelectionRange(4, 8)
    let reject!: (error: Error) => void
    f.read.mockImplementationOnce(
      () =>
        new Promise((_done, failed) => {
          reject = failed
        }),
    )
    f.refresh()
    await settle()
    expect(f.m.host.textContent).toContain('Reading…')
    expect(f.m.q('connection-description')).toBe(field)
    expect(document.activeElement).toBe(field)
    reject(new Error('Fictional metadata unavailable.'))
    await settle()
    expect(f.m.host.textContent).toContain('Connections could not be read.')
    expect(f.m.q('connection-description')).toBe(field)
    expect(field.value).toBe('Fictional retained text')
    f.read.mockResolvedValueOnce([])
    f.refresh()
    await settle()
    expect(f.m.all('provider-connection')).toHaveLength(0)
    expect(f.m.q('connection-description')).toBe(field)
    expect(field.value).toBe('Fictional retained text')
    expect(field.selectionStart).toBe(4)
    expect(field.selectionEnd).toBe(8)
    expect(document.activeElement).toBe(field)
    expect((f.m.q('connection-name') as HTMLInputElement).value).toBe('Fictional unfinished name')
    const cancel = f.m.q('connection-cancel') as HTMLButtonElement
    expect(cancel.disabled).toBe(false)
    cancel.click()
    await settle()
    expect(f.m.all('connection-editor')).toHaveLength(0)
    expect(f.update).not.toHaveBeenCalled()
    expect(f.auth).not.toHaveBeenCalled()
    expect(f.key).not.toHaveBeenCalled()
  })
}

async function aPendingEdit(
  f: Awaited<ReturnType<typeof drawer>>,
  selected: ProviderConnection,
  name: string,
) {
  let complete!: (row: ProviderConnection) => void
  let refuse!: (error: Error) => void
  f.update.mockImplementationOnce(
    () =>
      new Promise<ProviderConnection>((resolve, reject) => {
        complete = resolve
        refuse = reject
      }),
  )
  editSelected(f.m, selected)
  await settle()
  input(f.m, 'connection-name', name)
  input(f.m, 'connection-description', `${name} description`)
  f.m.q('connection-save').click()
  await settle()
  expect((f.m.q('connection-save') as HTMLButtonElement).disabled).toBe(true)
  return { complete, refuse }
}

for (const provider of ['claude', 'codex'] as const) {
  for (const outcome of ['success', 'failure'] as const) {
    it(`${provider}: an old save ${outcome} cannot overwrite or unlock the next provider's pending edit`, async () => {
      const f = await drawer(provider)
      const old = await aPendingEdit(f, f.selected, 'Fictional old-provider edit')
      const nextProvider = provider === 'claude' ? 'codex' : 'claude'
      f.changeProvider(nextProvider)
      await settle()
      expect(f.m.all('connection-editor')).toHaveLength(0)
      const selected = f.rows().find((row) => row.id === `${nextProvider}:sign-in`)!
      const next = await aPendingEdit(f, selected, 'Fictional next-provider edit')
      if (outcome === 'success')
        old.complete({
          ...f.selected,
          name: 'Fictional old-provider edit',
          description: 'Fictional old-provider edit description',
        })
      else old.refuse(new Error('Fictional old-provider save failed.'))
      await settle()
      expect((f.m.q('connection-name') as HTMLInputElement).value).toBe(
        'Fictional next-provider edit',
      )
      expect((f.m.q('connection-description') as HTMLTextAreaElement).value).toBe(
        'Fictional next-provider edit description',
      )
      expect((f.m.q('connection-save') as HTMLButtonElement).disabled).toBe(true)
      expect(f.m.q('connection-save').textContent).toContain('Saving…')
      expect(f.m.all('connection-error')).toHaveLength(0)
      expect(f.m.host.textContent).not.toContain('Fictional old-provider edit')
      next.complete({
        ...selected,
        name: 'Fictional next-provider edit',
        description: 'Fictional next-provider edit description',
      })
      await settle()
      expect(f.m.all('connection-editor')).toHaveLength(0)
      expect(f.m.host.textContent).toContain('Fictional next-provider edit description')
      expect(f.update.mock.calls).toEqual([
        [
          {
            provider,
            connectionId: f.selected.id,
            name: 'Fictional old-provider edit',
            description: 'Fictional old-provider edit description',
          },
        ],
        [
          {
            provider: nextProvider,
            connectionId: selected.id,
            name: 'Fictional next-provider edit',
            description: 'Fictional next-provider edit description',
          },
        ],
      ])
      expect(f.auth).not.toHaveBeenCalled()
      expect(f.key).not.toHaveBeenCalled()
    })

    it(`${provider}: save ${outcome} after unmount does not render or restart metadata reads`, async () => {
      const f = await drawer(provider)
      const pending = await aPendingEdit(f, f.selected, 'Fictional unmounted edit')
      f.m.unmount()
      const reads = [...f.read.mock.calls]
      f.refresh()
      if (outcome === 'success')
        pending.complete({
          ...f.selected,
          name: 'Fictional unmounted edit',
          description: 'Fictional unmounted edit description',
        })
      else pending.refuse(new Error('Fictional unmounted save failed.'))
      await settle()
      expect(f.m.host.isConnected).toBe(false)
      expect(f.m.all('connection-editor')).toHaveLength(0)
      expect(f.read.mock.calls).toEqual(reads)
      expect(f.update.mock.calls).toEqual([
        [
          {
            provider,
            connectionId: f.selected.id,
            name: 'Fictional unmounted edit',
            description: 'Fictional unmounted edit description',
          },
        ],
      ])
      expect(f.auth).not.toHaveBeenCalled()
      expect(f.key).not.toHaveBeenCalled()
    })
  }
}
