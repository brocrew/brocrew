import { afterEach, describe, expect, it } from 'vitest'
import { nextTick, type Component } from 'vue'
// ⚠️ The MODULE, not the barrel — `@brobot2/runtime`'s index reaches `node:fs` and fails to import
// in this project.
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import type { Provider } from '@brobot2/shared'
import type { ProviderProgram } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * The new-conversation form says the program a conversation would start on only when it is not a
 * tested one. The copy BroCrew carries is the one it was built with, so it says nothing; a carried
 * copy that is missing says so, with no link, since there is nothing to install.
 */

afterEach(unmountAll)

const CODEX_PATH = '/Applications/BroBot.app/Contents/Resources/codex/bin/codex'

const CARRIED: ProviderProgram = {
  standing: 'tested',
  from: 'carried',
  path: CODEX_PATH,
  version: '0.160.0',
  tested: null,
  said: `Codex 0.160.0, the copy BroCrew carries, at ${CODEX_PATH}.`,
  help: null,
  others: [],
  updatedFrom: null,
  update: null,
}

const CARRIED_MISSING: ProviderProgram = {
  standing: 'missing',
  from: null,
  path: null,
  version: null,
  tested: null,
  said: 'Codex isn’t available — the bundled Codex binary is missing. Reinstall BroCrew to restore it.',
  help: null,
  others: [],
  updatedFrom: null,
  update: null,
}

const CLAUDE_OLDER: ProviderProgram = {
  standing: 'older-than-tested',
  from: 'native-installer',
  path: '/Users/someone/.local/bin/claude',
  version: '2.1.200',
  tested: { oldest: '2.1.280', newest: '2.1.305' },
  said: 'Claude Code 2.1.200, installed with Anthropic’s installer, at /Users/someone/.local/bin/claude. It is older than the versions BroCrew was tested with (2.1.280 to 2.1.305), so something may not work; updating it is the fix.',
  help: { label: 'How to update Claude Code', url: 'https://example.invalid/setup' },
  others: [],
  updatedFrom: null,
  update: { command: 'claude update' },
}

async function theForm(
  defaultProvider: Provider,
  programs: Readonly<Partial<Record<Provider, ProviderProgram>>>,
) {
  ;(window as unknown as { api: unknown }).api = {
    runtime: { checkProviderAuth: () => Promise.resolve({ state: 'usable' }) },
  }
  const m = mount(
    NewConversation as Component,
    {
      busy: false,
      error: null,
      debug: false,
      draft: '',
      handing: createAttachmentBook().handing(NEW_CONVERSATION),
      defaultProvider,
      defaultApprovalMode: 'ask',
      models: null,
      choices: NO_LAUNCH_CHOICES,
      capabilities: allProviderCapabilities(),
      programs,
    },
    { width: 1200, height: 900 },
  )
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
  return m
}

describe('the program a conversation would start on', () => {
  it('the copy BroCrew carries says nothing: it is the one BroCrew was built with', async () => {
    const m = await theForm('codex', { codex: CARRIED, claude: CLAUDE_OLDER })
    expect(m.all('launch-program')).toEqual([])
  })

  it('a carried copy that is missing says so, with no link to install it', async () => {
    const m = await theForm('codex', { codex: CARRIED_MISSING })
    const notice = m.q('launch-program')
    expect(notice.textContent).toContain('Reinstall BroCrew to restore it.')
    expect(notice.dataset.standing).toBe('missing')
    expect(notice.querySelector('a')).toBeNull()
  })

  it('a Claude Code newer than the versions tested says nothing: nothing is wrong', async () => {
    const m = await theForm('claude', {
      claude: { ...CLAUDE_OLDER, standing: 'newer-than-tested', version: '2.1.310' },
    })
    expect(m.all('launch-program')).toEqual([])
  })

  it('the control: a program a person installed, outside the tested versions, keeps its link', async () => {
    const m = await theForm('claude', { claude: CLAUDE_OLDER, codex: CARRIED })
    const notice = m.q('launch-program')
    expect(notice.textContent).toContain('older than the versions BroCrew was tested with')
    expect(notice.querySelector('a')?.textContent?.trim()).toBe('How to update Claude Code')
  })
})
