import { defineComponent, h, type Component } from 'vue'
import type { WorkspaceRow } from '../../src/shared/workspaces'
import type { UpdatesSnapshot } from '../../src/shared/updates'

/** 🎨 Three workspaces and an update on offer — the footer menu's data. Fake data only. */
const NOW = Date.now()

export const WORKSPACES: WorkspaceRow[] = [
  {
    path: '/Users/someone/Library/Application Support/@brobot2/desktop',
    name: 'Default',
    isDefault: true,
    isThisOne: true,
    state: 'open',
    lastOpenedAt: NOW - 3_600_000,
    readers: null,
  },
  {
    path: '/Users/someone/BroBot workspaces/Bakery',
    name: 'Bakery',
    isDefault: false,
    isThisOne: false,
    state: 'closed',
    lastOpenedAt: NOW - 2 * 86_400_000,
    readers: null,
  },
  {
    path: '/Users/someone/BroBot workspaces/Old client',
    name: 'Old client',
    isDefault: false,
    isThisOne: false,
    state: 'missing',
    lastOpenedAt: NOW - 40 * 86_400_000,
    readers: null,
  },
]

export const UPDATES: UpdatesSnapshot = {
  version: '0.9.2',
  checkAutomatically: true,
  channel: 'stable',
  state: { kind: 'available', version: '0.9.3' },
}

/** ⚑ The bridge the footer menu reads: workspaces and updates, answered at once. */
export function settingsBridge(): void {
  const snapshot = async () => UPDATES
  window.api = {
    ...(window.api ?? {}),
    updates: {
      read: snapshot,
      checkNow: snapshot,
      set: snapshot,
      download: snapshot,
      restartWhenQuiet: snapshot,
      cancelRestart: snapshot,
      onChanged: () => () => {},
    },
    workspaces: {
      list: async () => WORKSPACES,
      open: async () => ({ ok: true }),
      create: async () => ({ ok: true }),
      rename: async () => ({ ok: true }),
      remove: async () => ({ ok: true }),
      checkFolder: async () => null,
      folderFor: async (name: string) => `/Users/someone/BroBot workspaces/${name}`,
      chooseFolder: async () => null,
      checkDelete: async (path: string) => ({
        ok: true,
        path,
        bytes: 48_200_000,
        files: 312,
        workingFiles: 41,
        exports: 2,
        pastedImages: `${path}-pasted-images`,
        warning: null,
      }),
      delete: async () => ({ ok: true }),
    },
  } as never
}

/**
 * ⚑ A component as the rail's footer opens it: at its own height, not stretched to the picture's,
 * on the rail's dark ground.
 */
export function asAMenu(component: unknown, props: Record<string, unknown> = {}): Component {
  return defineComponent({
    setup: () => () =>
      h(
        'div',
        { style: 'display:block;width:100%;height:100%;padding:12px;background:var(--bg)' },
        [h('div', { style: 'width:fit-content' }, [h(component as never, props)])],
      ),
  })
}
