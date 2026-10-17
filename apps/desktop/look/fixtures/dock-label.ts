import {
  defaultDockLabelColour,
  defaultDockLabelName,
  dockLabelName,
  type DockLabel,
  type DockLabelChange,
} from '../../src/shared/dock-label'

/**
 * Fake data for the Dock label row: one workspace's label, held in memory, changed as the main
 * process would change it.
 */
export function dockLabelBridge(workspaceName = 'Atlas workspace', start: Partial<DockLabel> = {}) {
  const name = defaultDockLabelName(workspaceName)
  const colour = defaultDockLabelColour(name)
  let label: DockLabel = { on: true, name, colour, defaults: { name, colour }, ...start }
  const bridge = {
    read: async (): Promise<DockLabel> => label,
    set: async (change: DockLabelChange): Promise<DockLabel> => {
      label = {
        ...label,
        ...(change.on !== undefined ? { on: change.on } : {}),
        ...(change.name !== undefined
          ? { name: change.name === null ? name : dockLabelName(change.name) || name }
          : {}),
        ...(change.colour !== undefined ? { colour: change.colour ?? colour } : {}),
      }
      return label
    },
  }
  const api = ((window as unknown as { api?: Record<string, unknown> }).api ??= {})
  api.dockLabel = bridge
  return bridge
}
