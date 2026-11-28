import { defineComponent, h, ref } from 'vue'
import type { PropType } from 'vue'
import { agentName, type Provider } from '../../src/shared/runtime-ipc'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import SheetShell from '../../src/renderer/src/components/SheetShell.vue'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { createAttachmentBook } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES, type LaunchChoices } from '../../src/renderer/src/lib/launch-choices'

/** Standalone Team form for tests that supply the screen-owned inputs directly. */
export const TeamLauncherFixture = defineComponent({
  inheritAttrs: false,
  props: {
    profileSlug: { type: String, required: true },
    provider: { type: String as PropType<Provider>, required: true },
    agents: Object as PropType<AgentStore>,
    draft: String,
  },
  setup(props, { attrs }) {
    const handing = createAttachmentBook().handing(props.profileSlug)
    const draft = ref('')
    const choices = ref<LaunchChoices>({ ...NO_LAUNCH_CHOICES })
    return () => {
      const name = agentName(props.profileSlug, props.agents?.identities.value?.identities ?? null)
      return h(
        SheetShell,
        { glyph: props.profileSlug.slice(0, 1).toUpperCase(), 'data-cy': 'start-as-agent' },
        {
          header: () =>
            h('strong', { 'data-cy': 'start-as-agent-title' }, `New conversation as ${name}`),
          body: () =>
            h(NewConversation, {
              busy: false,
              error: null,
              defaultApprovalMode: 'ask',
              capabilities: null,
              handing,
              ...attrs,
              team: { profileId: props.profileSlug, name },
              defaultProvider: choices.value.provider ?? props.provider,
              draft: props.draft ?? draft.value,
              choices: choices.value,
              'onUpdate:choices': (next: LaunchChoices) => (choices.value = next),
              'onUpdate:draft': (next: string) => {
                draft.value = next
                const update = attrs['onUpdate:draft']
                if (typeof update === 'function') update(next)
              },
            }),
        },
      )
    }
  },
})
