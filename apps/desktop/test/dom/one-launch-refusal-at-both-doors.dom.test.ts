import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'

import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import LaunchRefusalBox from '../../src/renderer/src/components/LaunchRefusalBox.vue'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { TeamLauncherFixture } from './team-launcher.fixture'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount, unmountAll } from './harness'

/**
 * A refused launch is drawn by one component at both doors that start one: the launcher and the
 * start-as-agent sheet. Each door is given the same refusal and must mount `LaunchRefusalBox`.
 */

afterEach(unmountAll)

const REFUSED = 'The fictional launch was refused.'

/** `LaunchRefusalBox`'s scope attribute: only elements its own template draws carry it. */
const REFUSAL_SCOPE = (LaunchRefusalBox as { __scopeId?: string }).__scopeId

function launcher(): Element {
  return mount(
    NewConversation,
    {
      busy: false,
      error: REFUSED,
      draft: '',
      defaultProvider: 'codex',
      choices: NO_LAUNCH_CHOICES,
      defaultApprovalMode: 'ask',
      capabilities: allProviderCapabilities(),
      handing: createAttachmentBook().handing(NEW_CONVERSATION),
    },
    { width: 1200, height: 900 },
  ).host
}

function sheet(): Element {
  ;(window as unknown as { api: unknown }).api = {
    runtime: { checkProviderAuth: () => Promise.resolve({ state: 'usable' }) },
  }
  const agents = {
    identities: ref(null),
    loaded: ref(false),
    loadError: ref(null),
  } as unknown as AgentStore
  const Host = defineComponent({
    setup: () => () =>
      h(TeamLauncherFixture as Component, {
        profileSlug: 'pm',
        provider: 'claude',
        defaultApprovalMode: 'ask',
        capabilities: CAPABILITY_FIXTURE,
        agents,
        busy: false,
        error: REFUSED,
      }),
  })
  return mount(Host, {}, { width: 992, height: 808 }).host
}

describe('one refusal box at both launch doors', () => {
  it('the launcher and the sheet each draw the refusal with LaunchRefusalBox, in the same words', async () => {
    expect(REFUSAL_SCOPE, 'LaunchRefusalBox has a scope attribute').toMatch(/^data-v-/)
    for (const [door, open, sentence] of [
      ['launcher', launcher, 'command-error'],
      ['sheet', sheet, 'start-as-agent-error'],
    ] as const) {
      const place = open()
      await nextTick()
      const boxes = [...place.querySelectorAll('[role="alert"]')].filter((el) =>
        el.textContent?.includes(REFUSED),
      )
      expect(boxes, `${door}: one refusal`).toHaveLength(1)
      const box = boxes[0]!
      expect(box.hasAttribute(REFUSAL_SCOPE!), `${door}: drawn by LaunchRefusalBox`).toBe(true)
      expect(box.textContent, `${door}: its heading`).toContain('The launch didn’t start')
      expect(place.querySelector(`[data-cy="${sentence}"]`)?.textContent?.trim()).toBe(REFUSED)
      unmountAll()
    }
  })
})
