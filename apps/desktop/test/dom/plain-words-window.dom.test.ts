import { afterEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import WorkSearchDialog from '../../src/renderer/src/components/WorkSearchDialog.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import type { WorkSearchHit, WorkSearchPage } from '../../src/shared/work-search'
import { drawerProps, mount, unmountAll } from './harness'
import { assertDrawn, drawnReady } from './drawn'
import { providersBridge } from '../../look/fixtures/providers'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'

afterEach(unmountAll)
const settle = async () => {
  await nextTick()
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

it.each([undefined, null, '', 'The menu is ready.'])(
  'shows only a recorded done condition in search (%s)',
  async (condition) => {
    const hit: WorkSearchHit = {
      kind: 'piece',
      piece: 'fictional-piece',
      label: 'W9.1',
      title: 'Plan a menu',
      definition_of_done: condition,
      state: 'working',
      owner: { conversation: 'fictional-owner', name: 'Baker', profile: 'baker' },
      giver: null,
      result: null,
      status: null,
      resource_ids: { brief: [], result: [], attachments: [], working: [] },
      clipped: { title: false, result: false, status: false },
      resources_omitted: 0,
    }
    const page: WorkSearchPage = {
      hits: [hit],
      searched: 1,
      rows_unread: 0,
      ledgers_skipped: 0,
      complete: true,
      next_cursor: null,
    }
    const m = mount(
      WorkSearchDialog,
      {
        conversation: 'fictional-owner',
        canOpen: false,
        search: async () => ({ ok: true as const, page }),
      },
      { width: 900, height: 700 },
    )
    m.q('work-search-submit').click()
    await settle()
    expect(m.q('work-search').textContent).toContain('Plan a menu')
    if (condition) expect(m.q('work-search').textContent).toContain(`Done when: ${condition}`)
    else expect(m.q('work-search').textContent).not.toContain('Done when:')
  },
)

it('names the existing drawer tab Agent with its exact purpose', async () => {
  const m = mount(SessionDrawer, drawerProps({ tab: 'open', fit: 'docked' }), {
    width: 380,
    height: 900,
  })
  await drawnReady()
  const tab = m.q('drawer-tab-open')
  expect(tab.textContent?.trim()).toBe('Agent')
  expect(tab.title).toBe('Agent settings, current work and anything waiting for you.')
  expect(tab.getAttribute('aria-label')).toContain('Agent')
  assertDrawn(tab, 'Agent tab', m.host)
})

it('asks the approved question in the New conversation composer', async () => {
  providersBridge()
  const m = mount(
    NewConversation,
    {
      busy: false,
      error: null,
      draft: '',
      defaultProvider: 'claude',
      defaultApprovalMode: 'ask',
      approvalDefaultChosen: true,
      choices: NO_LAUNCH_CHOICES,
      lists: createModelLists(() => window.api.runtime),
      handing: createAttachmentBook().handing(NEW_CONVERSATION),
    },
    { width: 1180, height: 1000 },
  )
  await drawnReady()
  const input = m.q('prompt-input') as HTMLTextAreaElement
  expect(input.placeholder).toBe('What would you like BroBot to do?')
  assertDrawn(input, 'New conversation question', m.host)
})
