import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import WorkspacesSection from '../../src/renderer/src/components/WorkspacesSection.vue'
import { forgetUpdates } from '../../src/renderer/src/composables/useUpdates'
import type { WorkspaceRow } from '../../src/shared/workspaces'
import { binWord } from '../../src/renderer/src/lib/this-computer'
import { mount, unmountAll } from './harness'

/**
 * # 🔴 A3 · the footer's menu chooses a workspace
 *
 * The list (this one, open, closed, not found), opening one, a missing one taken off the list,
 * Open workspace…, New workspace… with its folder checked before anything is made, and Rename this
 * workspace. ⚑ Driven through a fake `window.api.workspaces`, the bridge A2 gave the window; every
 * act is checked to reach it, and every refusal or warning is shown as main wrote it.
 */

const HERE: WorkspaceRow = {
  path: '/Users/x/Library/Application Support/@brobot2/desktop',
  name: 'Default',
  isDefault: true,
  isThisOne: true,
  state: 'open',
  lastOpenedAt: 3,
  readers: null,
}
const RESEARCH: WorkspaceRow = {
  path: '/Users/x/BroBot workspaces/Research',
  name: 'Research',
  isDefault: false,
  isThisOne: false,
  state: 'closed',
  lastOpenedAt: 2,
  readers: null,
}
const GONE: WorkspaceRow = {
  path: '/Users/x/BroBot workspaces/Old',
  name: 'Old',
  isDefault: false,
  isThisOne: false,
  state: 'missing',
  lastOpenedAt: 1,
  readers: null,
}

const api = (): { api?: Record<string, unknown> } =>
  window as unknown as { api?: Record<string, unknown> }

function fakeWorkspaces(rows: WorkspaceRow[] = [HERE, RESEARCH, GONE]) {
  let listed = rows
  const fake = {
    list: vi.fn(async () => listed),
    open: vi.fn(async (path: string) => ({ opened: true as const, path, warning: null })),
    create: vi.fn(async (input: { name: string; path?: string }) => ({
      opened: true as const,
      path: input.path ?? '',
      warning: null,
    })),
    rename: vi.fn(async (input: { path: string; name: string }) => {
      listed = listed.map((row) => (row.path === input.path ? { ...row, name: input.name } : row))
      return { done: true as const }
    }),
    remove: vi.fn(async (path: string) => {
      listed = listed.filter((row) => row.path !== path)
      return { done: true as const }
    }),
    checkFolder: vi.fn(async (path: string) => ({
      path,
      ok: true,
      refusal: null,
      warning: null,
      exists: false,
      isBroBots: false,
    })),
    folderFor: vi.fn(async (name: string) => `/Users/x/BroBot workspaces/${name}`),
    chooseFolder: vi.fn(async () => '/Users/x/Elsewhere/Picked' as string | null),
    checkDelete: vi.fn(async (path: string) => ({
      ok: true as const,
      path,
      bytes: 3 * 1024 * 1024,
      files: 120,
      workingFiles: 4,
      exports: 2,
      pastedImages: null,
      warning: null as string | null,
    })),
    delete: vi.fn(async (path: string) => {
      listed = listed.filter((row) => row.path !== path)
      return { deleted: true as const, trashed: [path], warning: null as string | null }
    }),
  }
  api().api = {
    workspaces: fake,
    runtime: { listResumable: async () => [], listUnresumable: async () => [] },
  }
  return fake
}

/** Where a deleted folder goes, on the computer the tests run on. */
const BIN = binWord(navigator.platform)

afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  forgetUpdates()
  delete api().api
})

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

const text = (element: Element | null): string =>
  element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

async function section(rows?: WorkspaceRow[]) {
  const fake = fakeWorkspaces(rows)
  const m = mount(WorkspacesSection, {}, { width: 300, height: 500 })
  await settle()
  return { m, fake }
}

const type = async (input: Element, value: string) => {
  ;(input as HTMLInputElement).value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}

async function selectActions(
  m: ReturnType<typeof mount>,
  which: 'current' | 'other' | 'missing' | 'new',
) {
  const trigger =
    which === 'new'
      ? m.q('workspace-more')
      : m
          .all('workspace-open')
          .find(
            (node) =>
              node.dataset.workspacePath ===
              (which === 'current' ? HERE.path : which === 'other' ? RESEARCH.path : GONE.path),
          )!
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    trigger.click()
    await settle()
  }
}

describe('A3 · the list', () => {
  it('🔴 most recent first, each with its state, its folder on hover, and this one marked', async () => {
    const { m } = await section()
    const rows = m.all('workspace-row')
    expect(rows.map((row) => row.getAttribute('data-state'))).toEqual(['open', 'closed', 'missing'])
    const opens = m.all('workspace-open')
    expect(m.all('workspace-state').map(text)).toEqual(['this one', 'closed', 'not found'])
    expect(opens.map((one) => text(one.querySelector('.name')))).toEqual([
      'Default',
      'Research',
      'Old',
    ])
    expect(opens[1]!.getAttribute('title')).toBe(RESEARCH.path)
    expect((opens[0] as HTMLButtonElement).disabled).toBe(false)
    expect(opens[0]!.getAttribute('aria-current')).toBe('true')
  })

  it('selecting a row reveals Open, then preserves the main-process warning', async () => {
    const { m, fake } = await section()
    fake.open.mockResolvedValueOnce({
      opened: true,
      path: RESEARCH.path,
      warning: 'Research was already open: its window is in front now.',
    } as never)
    await selectActions(m, 'other')
    expect(fake.open).not.toHaveBeenCalled()
    ;(m.q('workspace-open-selected') as HTMLButtonElement).click()
    await settle()
    expect(fake.open).toHaveBeenCalledWith(RESEARCH.path)
    expect(text(m.q('workspaces-said'))).toBe(
      'Research was already open: its window is in front now.',
    )
  })

  it('⚑ a refusal from main is shown as it is', async () => {
    const { m, fake } = await section()
    fake.open.mockResolvedValueOnce({
      opened: false,
      refusal: 'Not found — /Users/x/BroBot workspaces/Research',
    } as never)
    await selectActions(m, 'other')
    expect(fake.open).not.toHaveBeenCalled()
    ;(m.q('workspace-open-selected') as HTMLButtonElement).click()
    await settle()
    expect(text(m.q('workspaces-said'))).toBe('Not found — /Users/x/BroBot workspaces/Research')
  })

  it('🔴 a missing one says Not found, with its folder, and Remove from list takes it off', async () => {
    const { m, fake } = await section()
    await selectActions(m, 'missing')
    expect(text(m.q('workspace-missing'))).toBe('Old · Not found — /Users/x/BroBot workspaces/Old')
    ;(m.q('workspace-remove') as HTMLButtonElement).click()
    await settle()
    expect(fake.remove).toHaveBeenCalledWith(GONE.path)
    expect(m.all('workspace-missing')).toHaveLength(0)
  })

  it('⚑ Open workspace… picks a folder and opens it; a cancelled pick does nothing', async () => {
    const { m, fake } = await section()
    await selectActions(m, 'new')
    ;(m.q('workspace-open-folder') as HTMLButtonElement).click()
    await settle()
    expect(fake.open).toHaveBeenCalledWith('/Users/x/Elsewhere/Picked')
    fake.chooseFolder.mockResolvedValueOnce(null)
    fake.open.mockClear()
    await selectActions(m, 'new')
    ;(m.q('workspace-open-folder') as HTMLButtonElement).click()
    await settle()
    expect(fake.open).not.toHaveBeenCalled()
  })
})

describe('A3 · a new workspace', () => {
  it('🔴 a name, its folder suggested, checked, then made and opened', async () => {
    const { m, fake } = await section()
    await selectActions(m, 'new')
    ;(m.q('workspace-new') as HTMLButtonElement).click()
    await settle()
    await type(m.q('workspace-new-name'), 'Try')
    expect((m.q('workspace-new-path') as HTMLInputElement).value).toBe(
      '/Users/x/BroBot workspaces/Try',
    )
    expect(fake.checkFolder).toHaveBeenLastCalledWith('/Users/x/BroBot workspaces/Try', true)
    ;(m.q('workspace-new-make') as HTMLButtonElement).click()
    await settle()
    expect(fake.create).toHaveBeenCalledWith({
      name: 'Try',
      path: '/Users/x/BroBot workspaces/Try',
    })
    expect(m.all('workspace-new-form')).toHaveLength(0)
  })

  it('🔴 a folder main refuses says why, and nothing can be made', async () => {
    const { m, fake } = await section()
    fake.checkFolder.mockResolvedValue({
      path: '/Users/x/Documents',
      ok: false,
      refusal: 'This folder holds other files: choose an empty folder.',
      warning: null,
      exists: true,
      isBroBots: false,
    } as never)
    await selectActions(m, 'new')
    ;(m.q('workspace-new') as HTMLButtonElement).click()
    await settle()
    await type(m.q('workspace-new-name'), 'Docs')
    await type(m.q('workspace-new-path'), '/Users/x/Documents')
    expect(text(m.q('workspace-new-verdict'))).toBe(
      'This folder holds other files: choose an empty folder.',
    )
    expect((m.q('workspace-new-make') as HTMLButtonElement).disabled).toBe(true)
  })

  it('⚑ Choose… puts the picked folder in, and the name no longer moves it', async () => {
    const { m } = await section()
    await selectActions(m, 'new')
    ;(m.q('workspace-new') as HTMLButtonElement).click()
    await settle()
    await type(m.q('workspace-new-name'), 'A')
    ;(m.q('workspace-new-choose') as HTMLButtonElement).click()
    await settle()
    expect((m.q('workspace-new-path') as HTMLInputElement).value).toBe('/Users/x/Elsewhere/Picked')
    await type(m.q('workspace-new-name'), 'AB')
    expect((m.q('workspace-new-path') as HTMLInputElement).value).toBe('/Users/x/Elsewhere/Picked')
  })

  it('⚑ a create main refuses keeps the form, with its words', async () => {
    const { m, fake } = await section()
    fake.create.mockResolvedValueOnce({
      opened: false,
      refusal: 'This folder is a workspace already: open it instead.',
    } as never)
    await selectActions(m, 'new')
    ;(m.q('workspace-new') as HTMLButtonElement).click()
    await settle()
    await type(m.q('workspace-new-name'), 'Research')
    ;(m.q('workspace-new-make') as HTMLButtonElement).click()
    await settle()
    expect(text(m.q('workspaces-said'))).toBe(
      'This folder is a workspace already: open it instead.',
    )
    expect(m.all('workspace-new-form')).toHaveLength(1)
  })
})

describe('A3 · a new workspace waits for its folder', () => {
  it('⛔ nothing is made while the folder for the name is still on its way', async () => {
    const { m, fake } = await section()
    let answer: (folder: string) => void = () => {}
    fake.folderFor.mockImplementationOnce(
      () => new Promise<string>((resolve) => (answer = resolve)),
    )
    await selectActions(m, 'new')
    ;(m.q('workspace-new') as HTMLButtonElement).click()
    await settle()
    await type(m.q('workspace-new-name'), 'Try')
    expect((m.q('workspace-new-make') as HTMLButtonElement).disabled).toBe(true)
    answer('/Users/x/BroBot workspaces/Try')
    await settle()
    expect((m.q('workspace-new-make') as HTMLButtonElement).disabled).toBe(false)
  })

  it('⚑ a check that could not be asked says so, and nothing can be made', async () => {
    const { m, fake } = await section()
    fake.checkFolder.mockRejectedValue(new Error('the folder could not be read'))
    await selectActions(m, 'new')
    ;(m.q('workspace-new') as HTMLButtonElement).click()
    await settle()
    await type(m.q('workspace-new-name'), 'Try')
    expect(text(m.q('workspace-new-check-failed'))).toBe(
      'BroCrew couldn’t check this folder: the folder could not be read',
    )
    expect((m.q('workspace-new-make') as HTMLButtonElement).disabled).toBe(true)
  })

  it('⚑ Esc in the form cancels the form only, and focus goes back to New workspace…', async () => {
    const { m } = await section()
    await selectActions(m, 'new')
    ;(m.q('workspace-new') as HTMLButtonElement).click()
    await settle()
    expect(document.activeElement).toBe(m.q('workspace-new-name'))
    m.q('workspace-new-name').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await settle()
    expect(m.all('workspace-new-form')).toHaveLength(0)
    expect(document.activeElement).toBe(m.q('workspace-new'))
  })
})

describe('A3 · rename this workspace', () => {
  it('🔴 renames this one, and the footer says the new name at once', async () => {
    const fake = fakeWorkspaces()
    const rail = mount(
      SideRail,
      {
        open: [],
        activeId: null,
        place: null,
        workspaceFolder: { name: 'Default', path: HERE.path, isDefault: true },
      },
      { width: 251.68 },
    )
    await settle()
    ;(rail.q('rail-workspace') as HTMLButtonElement).click()
    await settle()
    await selectActions(rail, 'current')
    ;(rail.q('workspace-rename') as HTMLButtonElement).click()
    await settle()
    await type(rail.q('workspace-rename-name'), 'Home')
    ;(rail.q('workspace-rename-save') as HTMLButtonElement).click()
    await settle()
    expect(fake.rename).toHaveBeenCalledWith({ path: HERE.path, name: 'Home' })
    expect(text(rail.q('rail-workspace-name'))).toBe('Home')
    expect(text(rail.q('rail-workspace-initial'))).toBe('H')
  })
})

describe('F092 · delete a closed workspace', () => {
  const del = (m: { q: (cy: string) => Element }) =>
    m.q(`workspace-delete:${RESEARCH.path}`) as HTMLButtonElement

  it('🔴 offered on a closed row only — never on this one, the default, an open or a missing one', async () => {
    const OPEN: WorkspaceRow = {
      ...RESEARCH,
      path: '/Users/x/BroBot workspaces/Busy',
      name: 'Busy',
      state: 'open',
    }
    const { m } = await section([HERE, RESEARCH, OPEN, GONE])
    await selectActions(m, 'other')
    const offered = m.host.querySelectorAll('[data-cy^="workspace-delete:"]')
    expect([...offered].map((one) => one.getAttribute('data-cy'))).toEqual([
      `workspace-delete:${RESEARCH.path}`,
    ])
    await selectActions(m, 'current')
    expect(m.host.querySelectorAll('[data-cy^="workspace-delete:"]')).toHaveLength(0)
    await selectActions(m, 'missing')
    expect(m.all('workspace-remove')).toHaveLength(1)
  })

  it('🔴 the confirmation names the folder, its size, what goes with it, and the Trash; Cancel has focus', async () => {
    const { m, fake } = await section()
    await selectActions(m, 'other')
    del(m).click()
    await settle()
    expect(fake.checkDelete).toHaveBeenCalledWith(RESEARCH.path)
    expect(text(m.q('workspace-delete-what'))).toBe(
      `Its folder ${RESEARCH.path} (3.0 MB, 120 files) goes to the ${BIN}. You can put it back from there.`,
    )
    expect(text(m.q('workspace-delete-with'))).toBe(
      'It takes 4 files its conversations made and 2 exported conversations with it.',
    )
    expect(text(m.q('workspace-delete-yes'))).toBe(`Move to ${BIN}`)
    expect(document.activeElement).toBe(m.q('workspace-delete-cancel'))
  })

  it('🔴 on a Windows PC it is the Recycle Bin, never the Trash', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    const { m } = await section()
    await selectActions(m, 'other')
    del(m).click()
    await settle()
    expect(text(m.q('workspace-delete-what'))).toBe(
      `Its folder ${RESEARCH.path} (3.0 MB, 120 files) goes to the Recycle Bin. You can put it back from there.`,
    )
    expect(text(m.q('workspace-delete-yes'))).toBe('Move to Recycle Bin')
    ;(m.q('workspace-delete-yes') as HTMLButtonElement).click()
    await settle()
    expect(text(m.q('workspaces-said'))).toBe('Moved to the Recycle Bin.')
  })

  it('🔴 on a Windows PC the rail’s shortcuts say Ctrl, and on a Mac ⌘', async () => {
    fakeWorkspaces()
    const props = {
      open: [],
      activeId: null,
      place: null,
      workspaceFolder: { name: 'Default', path: HERE.path, isDefault: true },
    }
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32')
    const pc = mount(SideRail, props, { width: 251.68 })
    await settle()
    expect(text(pc.q('command-palette'))).toBe('Ctrl K')
    expect(pc.q('command-palette').title).toContain('(Ctrl+K)')
    expect(text(pc.q('new-conversation'))).toBe('New conversation Ctrl N')
    expect(pc.host.textContent).not.toContain('⌘')
    unmountAll()

    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    const mac = mount(SideRail, props, { width: 251.68 })
    await settle()
    expect(text(mac.q('command-palette'))).toBe('⌘ K')
    expect(mac.q('command-palette').title).toContain('(⌘K)')
    expect(text(mac.q('new-conversation'))).toBe('New conversation ⌘ N')
  })

  it('🔴 Move to Trash deletes it: the row goes, and it says so', async () => {
    const { m, fake } = await section()
    await selectActions(m, 'other')
    del(m).click()
    await settle()
    ;(m.q('workspace-delete-yes') as HTMLButtonElement).click()
    await settle()
    expect(fake.delete).toHaveBeenCalledWith(RESEARCH.path)
    expect(m.all('workspace-delete-confirm')).toHaveLength(0)
    expect(m.host.querySelector(`[data-cy="workspace-delete:${RESEARCH.path}"]`)).toBeNull()
    expect(text(m.q('workspaces-said'))).toBe(`Moved to the ${BIN}.`)
  })

  it('⛔ Cancel and Esc delete nothing', async () => {
    const { m, fake } = await section()
    await selectActions(m, 'other')
    del(m).click()
    await settle()
    ;(m.q('workspace-delete-cancel') as HTMLButtonElement).click()
    await settle()
    expect(m.all('workspace-delete-confirm')).toHaveLength(0)
    await selectActions(m, 'other')
    del(m).click()
    await settle()
    m.q('workspace-delete-cancel').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await settle()
    expect(m.all('workspace-delete-confirm')).toHaveLength(0)
    expect(fake.delete).not.toHaveBeenCalled()
  })

  it('⚑ a refusal from checkDelete is shown as it is, and no confirmation opens', async () => {
    const { m, fake } = await section()
    fake.checkDelete.mockResolvedValueOnce({
      ok: false,
      refusal: 'Research is open: quit it first.',
    } as never)
    await selectActions(m, 'other')
    del(m).click()
    await settle()
    expect(text(m.q('workspaces-said'))).toBe('Research is open: quit it first.')
    expect(m.all('workspace-delete-confirm')).toHaveLength(0)
  })

  it('⚑ a warning before and after is shown as written; a refused delete keeps the row', async () => {
    const { m, fake } = await section()
    fake.checkDelete.mockResolvedValueOnce({
      ok: true,
      path: RESEARCH.path,
      bytes: 10,
      files: 1,
      workingFiles: 0,
      exports: 0,
      pastedImages: null,
      warning: 'Its pasted pictures folder holds other files, so it stays.',
    } as never)
    await selectActions(m, 'other')
    del(m).click()
    await settle()
    expect(m.all('workspace-delete-with')).toHaveLength(0)
    expect(text(m.q('workspace-delete-warning'))).toBe(
      'Its pasted pictures folder holds other files, so it stays.',
    )
    fake.delete.mockResolvedValueOnce({
      deleted: false,
      refusal: 'The Trash could not take it.',
    } as never)
    ;(m.q('workspace-delete-yes') as HTMLButtonElement).click()
    await settle()
    expect(text(m.q('workspaces-said'))).toBe('The Trash could not take it.')
    expect(m.host.querySelector(`[data-cy="workspace-delete:${RESEARCH.path}"]`)).not.toBeNull()
  })
})

describe('A3 · only from the footer', () => {
  it('⛔ the rail asks nothing about workspaces until the footer is pressed', async () => {
    const fake = fakeWorkspaces()
    const rail = mount(
      SideRail,
      {
        open: [],
        activeId: null,
        place: null,
        workspaceFolder: { name: 'Default', path: HERE.path, isDefault: true },
      },
      { width: 251.68 },
    )
    await settle()
    expect(fake.list).not.toHaveBeenCalled()
    expect(rail.all('workspaces')).toHaveLength(0)
    ;(rail.q('rail-workspace') as HTMLButtonElement).click()
    await settle()
    expect(fake.list).toHaveBeenCalledTimes(1)
    expect(rail.all('workspace-row')).toHaveLength(3)
  })
})
