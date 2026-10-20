import type {
  PluginCard,
  PluginsClient,
  PluginSettingsRequest,
} from '../../src/shared/plugin-settings'
/** Explicitly fictional install/uninstall seams. No installation, supervisor or Chrome process. */
export function fictionalPlugins(installed = true) {
  let cards: PluginCard[] = [
    { id: 'chrome', name: 'Chrome', installed, state: installed ? 'Running' : 'Available' },
    { id: 'fictional-maps', name: 'Fictional Maps', installed: false, state: 'Available' },
  ]
  const calls: PluginSettingsRequest[] = [],
    closed = new Set<(screenId: string) => void>()
  let held: Promise<void> | null = null
  const client: PluginsClient = {
    async request(input) {
      calls.push(input)
      if (input.kind === 'install' && held) await held
      if (input.kind === 'install')
        cards = cards.map((card) =>
          card.id === input.id ? { ...card, installed: true, state: 'Installed' } : card,
        )
      if (input.kind === 'uninstall')
        cards = cards.map((card) =>
          card.id === input.id ? { ...card, installed: false, state: 'Available' } : card,
        )
      return { ok: true, cards: cards.map((card) => ({ ...card })) }
    },
    onClosed(listener) {
      closed.add(listener)
      return () => {
        closed.delete(listener)
      }
    },
  }
  return {
    client,
    calls,
    closed,
    set: (next: PluginCard[]) => {
      cards = next
    },
    /** Holds the next install's answer, as a slow first start does, until the returned call. */
    holdInstall: () => {
      let release = () => {}
      held = new Promise((resolve) => {
        release = resolve
      })
      return () => {
        held = null
        release()
      }
    },
  }
}
