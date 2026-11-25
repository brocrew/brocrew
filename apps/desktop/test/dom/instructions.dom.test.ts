import type { CreatedSession } from '../../src/shared/runtime-ipc'
import type { SessionInstructions } from '../../src/shared/instruction-contracts'
import { afterEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { META, launchRecordProps, mount, paneProps, record, unmountAll, visible } from './harness'

afterEach(unmountAll)

function launch(instructions: Partial<SessionInstructions>) {
  return mount(AgentInputPopup, launchRecordProps({ ...META.instructions, ...instructions }), {
    width: 900,
    height: 800,
  })
}

it('keeps the held body, path and truncation against the source from that launch', async () => {
  const m = launch({
    injected: [
      {
        kind: 'project-memory',
        path: '/work/repo/CLAUDE.md',
        text: 'The launch kept this line.',
        bytes: 26,
        truncated: true,
      },
    ],
    note: 'Read at launch.',
  })
  ;(m.q('input-launch-evidence') as HTMLDetailsElement).open = true
  const row = m.q('input-launch-source')
  const paper = row.querySelector('[data-cy="document-body"]')!
  expect(visible(paper)).toBe(false)
  row.querySelector('summary')!.click()
  await nextTick()
  expect(visible(paper)).toBe(true)
  expect(paper.textContent).toContain('The launch kept this line.')
  expect(row.textContent).toContain('/work/repo/CLAUDE.md')
  expect(row.textContent).toContain('Only part of the file was kept.')
  expect(m.q('instructions-note').textContent).toContain('Read at launch.')
})

it('labels each provider layer and reports when none belongs to the profile', async () => {
  const project = { path: '/work/repo/AGENTS.md', scope: 'project' } as const
  const elsewhere = { path: '/work/AGENTS.md', scope: 'unknown' } as const
  const m = launch({ provider: [project, elsewhere] })
  const list = m.q('input-reported-files') as HTMLDetailsElement
  list.querySelector('summary')!.click()
  await nextTick()
  expect(visible(m.q('provider-instructions-lead'))).toBe(true)
  expect(m.q('provider-instructions-lead').textContent).toBe('Reported by the provider.')
  expect(m.all('provider-scope').map((row) => row.dataset.scope)).toEqual(['project', 'unknown'])
  expect(
    m.all('provider-instruction').map((row) => row.querySelector('.path')?.textContent),
  ).toEqual([project.path, elsewhere.path])
  expect(m.q('provider-instructions-absent').textContent).toContain("this profile's own")
  m.unmount()

  const withProfile = launch({
    provider: [{ path: '/home/test/AGENTS.override.md', scope: 'profile' }, project],
  })
  expect(withProfile.all('provider-scope').map((row) => row.dataset.scope)).toEqual([
    'profile',
    'project',
  ])
  expect(withProfile.all('provider-instructions-absent')).toHaveLength(0)
})

it('shows the separate reasons for missing, excluded and unreadable files', async () => {
  const m = launch({
    refused: [
      { path: '/work/large.md', reason: 'over-budget' },
      { path: '/home/test/memory/MEMORY.md', reason: 'dangling-link', link: '/missing/index' },
      { path: '/work/custom.md', reason: 'unknown-fixture-reason' },
    ],
  })
  ;(m.q('input-launch-evidence') as HTMLDetailsElement).open = true
  const [budget, link, unknown] = m.all('refused-instruction')
  budget!.closest('details')!.open = true
  await nextTick()
  expect(visible(budget!)).toBe(true)
  expect(budget!.textContent).toContain('read, but not sent')
  expect(budget!.textContent).toContain('budget ran out')
  expect(budget!.querySelectorAll('.bb-mono')).toHaveLength(1)
  expect(budget!.textContent).not.toContain('not read')
  expect(link!.textContent).toContain('a link with nothing at the other end')
  expect(link!.textContent).toContain('/missing/index')
  expect(unknown!.textContent).toContain('not read: unknown-fixture-reason')
})

it('shows a legacy single memory index without inventing reach or a redirected path', async () => {
  const legacy = {
    kind: 'agent-memory',
    path: '/home/test/memory/MEMORY.md',
    text: 'A fact that was kept.',
    bytes: 21,
    truncated: false,
  }
  const m = launch({ agentMemory: [legacy] as SessionInstructions['agentMemory'] })
  ;(m.q('input-launch-evidence') as HTMLDetailsElement).open = true
  const row = m.q('input-launch-memory-file')
  row.querySelector('summary')!.click()
  await nextTick()
  expect(m.all('input-launch-memory-file')).toHaveLength(1)
  expect(row.textContent).toContain('A fact that was kept.')
  expect(row.querySelector('summary')?.textContent?.trim()).toBe('MEMORY.md')
  expect(row.querySelectorAll('.bb-mono')).toHaveLength(1)
  expect(row.querySelector('.bb-mono')?.textContent).toBe(legacy.path)
})

const DEV_HOME = '/homes/default/developer/claude'
const DEFAULT_HOME = '/homes/default/default/claude'

const onDeveloper: SessionInstructions = {
  agentMemory: [
    {
      kind: 'agent-memory',
      path: `${DEV_HOME}/memory/MEMORY.md`,
      text: '# What I remember\n\nBROBOT-172-DEVELOPER',
      bytes: 38,
      truncated: false,
      reach: 'prompt',
    },
  ],
  injected: [
    {
      kind: 'profile-memory',
      path: `${DEV_HOME}/CLAUDE.md`,
      text: '# Who I am\n\nBROBOT-172-DEVELOPER-CLAUDE-MD',
      bytes: 41,
      truncated: false,
    },
  ],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: false,
  composed: null,
}

const developerSession = {
  profileId: 'developer',
  providerHome: DEV_HOME,
  config: {
    home: DEV_HOME,
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'claude-opus-5',
    authNote: null,
    files: [],
  },
}

function profilePane(meta: Partial<CreatedSession>) {
  const held = record([])
  held.meta = { ...META, ...meta }
  return mount(
    ConversationPane,
    paneProps({
      record: held,
      drawerOpen: true,
      drawerTab: 'info',
    }),
    { width: 1200, height: 800 },
  )
}

it('keeps the home, profile and disclosed files on the selected agent', async () => {
  const m = profilePane({ ...developerSession, instructions: onDeveloper })
  expect(m.q('session-profile').textContent).toContain('agent: developer')
  expect(m.q('session-home').textContent).toBe(DEV_HOME)
  m.q('told-index').click()
  await nextTick()
  const reader = m.q('input-popup')
  ;(m.q('input-launch-evidence') as HTMLDetailsElement).open = true
  for (const disclosure of reader.querySelectorAll<HTMLDetailsElement>('details')) {
    disclosure.open = true
  }
  await nextTick()
  expect(m.q('input-launch-memory-file').textContent).toContain(`${DEV_HOME}/memory/MEMORY.md`)
  expect(m.q('input-launch-source').textContent).toContain(`${DEV_HOME}/CLAUDE.md`)
  expect(reader.textContent).toContain('BROBOT-172-DEVELOPER')
  expect(reader.textContent).not.toContain(DEFAULT_HOME)
})

it('names the default profile as BroBot in Info', () => {
  const m = profilePane({})
  expect(m.q('session-profile').textContent).toContain('BroBot')
  expect(m.q('session-profile').textContent).not.toContain('agent: developer')
})
