import type {
  PluginCard,
  PluginPackageInspection,
  PluginsClient,
  PluginSettingsRequest,
} from '../../src/shared/plugin-settings'
/** Explicitly fictional install/uninstall seams. No installation, supervisor or Chrome process. */
export function fictionalPlugins(installed = true) {
  let cards: PluginCard[] = [
    {
      id: 'chrome',
      name: 'Chrome',
      installed,
      state: installed ? 'Running' : 'Available',
      uninstallDeletesData: false,
    },
    { id: 'fictional-maps', name: 'Fictional Maps', installed: false, state: 'Available' },
  ]
  const calls: PluginSettingsRequest[] = [],
    closed = new Set<(screenId: string) => void>()
  let held: Promise<void> | null = null
  const client: PluginsClient = {
    async request(input) {
      input = structuredClone(input)
      calls.push(input)
      if (input.kind === 'inspect' && 'id' in input) {
        const card = cards.find((one) => one.id === input.id)
        if (!card) return { ok: false, error: 'Plugin unavailable. Try again.' }
        const inspection: PluginPackageInspection = {
          id: card.id,
          name: card.name,
          ref: {
            source: `https://fictional.invalid/${encodeURIComponent(card.id)}.tar.gz`,
            sha256: 'a'.repeat(64),
            bytes: 1234,
          },
          manifest: {},
          details: {
            version: card.updateVersion ?? card.installedVersion ?? '1.0.0',
            digest: 'a'.repeat(64),
            manifestSha256: 'b'.repeat(64),
            authors: ['Fictional plugin makers'],
            permissions: { description: 'Use fictional data.', resources: [] },
          },
        }
        return structuredClone({ ok: true as const, inspection })
      }
      if (input.kind === 'install' && held) await held
      if (input.kind === 'install')
        cards = cards.map((card) =>
          card.id === input.id ? { ...card, installed: true, state: 'Installed' } : card,
        )
      if (input.kind === 'uninstall')
        cards = cards.map((card) =>
          card.id === input.id ? { ...card, installed: false, state: 'Available' } : card,
        )
      return structuredClone({ ok: true as const, cards })
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
