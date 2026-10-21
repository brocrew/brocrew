import type { AppInfo } from '@brobot2/shared'
import { scene, crop, boxOf } from '../capture'
import { settle, windowStage } from '../fixtures/window'
import { wearTheme } from '../fixtures/themes'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import type { AgentIdentities } from '../../src/shared/runtime-ipc'
import { assertDrawn } from '../../test/dom/drawn'

const info: AppInfo = {
  name: 'BroCrew',
  windowTitle: 'BroCrew',
  workspace: { name: 'Local workspace', path: '/fictional/bakery', isDefault: false },
  version: '0.1.5',
  step: '',
  build: { id: 'dev', commit: '', dirty: false, branches: null },
  db: { migrationsApplied: 7, providerSessionCount: 0 },
}

scene('plain words chrome', async (stage) => {
  wearTheme('brocrew')
  const component = windowStage({ titleBar: true, titleInfo: info, railCollapsed: false })
  window.api.runtime.providerUsage = async () => ({ claude: [], codex: [] })
  const safety = useSpawnSafety()
  safety.supply(
    {
      identities: [],
      foldersWithoutARow: [],
      use: [],
      externalMcpServers: [],
      spawningEnabled: true,
      defaultApprovalMode: 'ask',
    } satisfies AgentIdentities,
    () => {},
  )
  const m = stage.mount(component, {})
  await settle()
  assertDrawn(m.q('rail-spawning'), 'new conversations control', m.host)
  const width = Number(import.meta.env.LOOK_RAIL_WIDTH ?? 251.68)
  m.q('side-rail').parentElement!.style.width = `${width}px`
  await settle()
  const footer = m.q('rail-workspace').getBoundingClientRect()
  const control = m.q('rail-spawning').getBoundingClientRect()
  if (footer.top < control.bottom || footer.bottom > m.host.getBoundingClientRect().bottom)
    throw new Error('The workspace card must remain visible below the spawning card.')
  const state = `${import.meta.env.LOOK_WORDS_STATE ?? 'after'}-${width}`
  await crop(`sidebar-${state}`, boxOf(m.q('side-rail')))
  await crop(`titlebar-${state}`, boxOf(m.q('app-titlebar')))
})
