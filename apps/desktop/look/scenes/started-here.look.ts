import { nextTick } from 'vue'
import { expect } from 'vitest'
import { scene, crop, boxOf } from '../capture'
import { rightPanelStage } from '../fixtures/right-panel'
import { wearTheme } from '../fixtures/themes'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { META } from '../../test/dom/harness'
import { conv, forestOf, task } from '../../test/dom/forest-fixture'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentity } from '../../src/shared/runtime-ipc'

const names = ['Aster', 'Mira', 'Rowan', 'Niko', 'Pia', 'Ellis']
const ids = names.map((name) => `sess_${name.toLowerCase()}`)
const identities: AgentIdentity[] = names.map((name) => ({
  id: `aid:${name.toLowerCase()}`,
  slug: name.toLowerCase(),
  displayName: name,
  createdAt: 1,
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
}))
scene('started-here', async (stage) => {
  const phase = import.meta.env['LOOK_PHASE'] ?? 'before'
  for (const theme of ['crew-night', 'defined'] as const) {
    wearTheme(theme)
    localStorage.removeItem('brobot2.subAgents.latestFirst')
    localStorage.removeItem('brobot2.subAgents.showIdle')
    const Panel = rightPanelStage({ identities })
    const cast = useWhoCalledWhom()
    const reading = cast.reading.value!
    cast.cardFiles.value = null
    cast.reading.value = {
      ...reading,
      read: {
        ...reading.read,
        children: {
          rows: [
            { conversation: ids[0]!, identity: 'aster', provider: 'claude', running: 'unwatched' },
          ],
          walk: 'every-conversation-this-one-spawned',
          ledgers: 1,
          rowsUnread: 0,
        },
        workGivenOut: {
          rows: [],
          walk: 'every-conversation-this-one-gave-work-to',
          ledgers: 0,
          rowsUnread: 0,
        },
        workTakenIn: {
          rows: [],
          walk: 'every-piece-of-work-this-one-was-given',
          ledgers: 0,
          rowsUnread: 0,
        },
      },
    }
    cast.forest.value = forestOf([
      conv(META.sessionId, null),
      ...ids.flatMap((id, i) => [
        conv(id, i === 0 ? META.sessionId : ids[i - 1]!, { identity: names[i]!.toLowerCase() }),
        task(
          id,
          `work_scene_${i}`,
          `W1.${i + 1}`,
          [
            'Plan the community workshop',
            'Prepare the room layout',
            'Check the access routes',
            'Review the supply list',
            'Confirm the welcome desk',
            'Check the final timetable',
          ][i]!,
          i === 0 ? META.sessionId : ids[i - 1]!,
        ),
      ]),
    ])
    cast.railSays.value = new Map(
      ids.map((id, i) => [
        id,
        {
          facets: { doing: i === 4 ? ('idle' as const) : ('working' as const) },
          word: i === 4 ? 'idle' : 'working',
        },
      ]),
    )
    const m = stage.mount(Panel, {}, { width: 440, height: 1750 })
    await nextTick()
    await crop(`${theme}-${phase}-panel`, boxOf(m.host))
    await crop(`${theme}-${phase}-started-here`, boxOf(m.q('cast-sub-agents')))
    expect(m.q('cast-sub-agents').scrollWidth).toBeLessThanOrEqual(
      m.q('cast-sub-agents').clientWidth,
    )
    m.unmount()
  }
})
