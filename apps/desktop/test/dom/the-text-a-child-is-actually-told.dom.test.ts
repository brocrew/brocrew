import type { SessionInstructions } from '../../src/shared/instruction-contracts'
import { afterEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import { META, launchRecordProps, mount, unmountAll, visible } from './harness'

afterEach(unmountAll)

const PROFILE_TEXT = '# Your instructions\n\n- Put the files you create in your working directory.'

function openReader(over: Partial<SessionInstructions>) {
  return mount(AgentInputPopup, launchRecordProps({ ...META.instructions, ...over }), {
    width: 760,
    height: 900,
  })
}

function source(host: HTMLElement, kind: string): HTMLDetailsElement {
  const rows = host.querySelectorAll<HTMLDetailsElement>(`details[data-kind="${kind}"]`)
  expect(rows).toHaveLength(1)
  rows[0]!.open = true
  return rows[0]!
}

it('distinguishes instructions BroCrew wrote from profile memory the agent wrote', async () => {
  const reader = openReader({
    injected: [
      {
        kind: 'profile-instructions',
        path: '/homes/claude/brobot-instructions.md',
        text: PROFILE_TEXT,
        bytes: PROFILE_TEXT.length,
        truncated: false,
        sections: [{ whose: 'factory', heading: null, start: 0, end: PROFILE_TEXT.length }],
      },
      {
        kind: 'profile-memory',
        path: '/homes/claude/CLAUDE.md',
        text: '# What I have learned',
        bytes: 21,
        truncated: false,
      },
    ],
  })
  ;(reader.q('input-launch-evidence') as HTMLDetailsElement).open = true
  const app = source(reader.host, 'profile-instructions')
  const memory = source(reader.host, 'profile-memory')
  await nextTick()

  const appOwner = app.querySelector('.bb-muted')!
  const memoryOwner = memory.querySelector('.bb-muted')!
  expect(app.dataset.whose).toBe('factory')
  expect(memory.dataset.whose).toBe('learned')
  expect(visible(appOwner)).toBe(true)
  expect(visible(memoryOwner)).toBe(true)
  expect(appOwner.textContent).toBe('Written by BroCrew')
  expect(memoryOwner.textContent).toBe('Profile memory written by the agent')
  expect(app.textContent).toContain('/homes/claude/brobot-instructions.md')
  expect(memory.textContent).toContain('/homes/claude/CLAUDE.md')
})

it('explains how to recover when an unmanaged override blocked publication', async () => {
  const reader = openReader({
    refused: [{ path: '/homes/codex/AGENTS.override.md', reason: 'unmanaged-override' }],
  })
  ;(reader.q('input-launch-evidence') as HTMLDetailsElement).open = true
  const row = reader.q('refused-instruction')
  row.closest('details')!.open = true
  await nextTick()

  expect(visible(row)).toBe(true)
  expect(row.querySelector('.bb-mono')?.textContent).toBe('/homes/codex/AGENTS.override.md')
  const reason = [...row.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join(' ')
  expect(reason).toContain('was not written by BroCrew')
  expect(reason).toContain('the agent did not get them')
  expect(reason).toContain('Move or rename it')
  expect(reason).not.toMatch(/\bclaude\b|\bcodex\b/i)
})

it('draws no refusal for a launch that published cleanly', () => {
  const reader = openReader({ refused: [] })
  expect(reader.q('input-launch-evidence').textContent).not.toContain('Files left out')
  expect(reader.all('refused-instruction')).toHaveLength(0)
})

it('shows a repository conventions file as working-folder guidance', async () => {
  const reader = openReader({
    injected: [
      {
        kind: 'repository-conventions',
        path: '/work/sample-api/AGENTS.md',
        text: 'Keep local examples small.',
        bytes: 26,
        truncated: false,
      },
    ],
  })
  ;(reader.q('input-launch-evidence') as HTMLDetailsElement).open = true
  const conventions = source(reader.host, 'repository-conventions')
  await nextTick()
  expect(conventions.dataset.whose).toBe('the-place')
  expect(conventions.querySelector('.bb-muted')?.textContent).toBe(
    'Shared repository conventions, read by BroCrew',
  )
  expect(conventions.textContent).toContain('/work/sample-api/AGENTS.md')
  expect(conventions.textContent).toContain('Keep local examples small.')
})
