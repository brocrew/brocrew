import type { SessionInstructions } from '../../src/shared/instruction-contracts'
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import { launchRecordProps, mount, unmountAll, visible } from './harness'
import { givenAnswer } from './what-this-agent-was-given.fixture'

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  vi.unstubAllGlobals()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const COMPOSED =
  'You are Lena (writer), an agent in BroBot, the app you run inside. Below are your instructions, ' +
  "your workspace notes and this conversation's details. Follow them; they take precedence over earlier general guidance." +
  '\n\nContents of /Users/somebody/provider-homes/default/default/claude/CLAUDE.md ' +
  "(this profile's private instructions for all projects):\n\nBROBOT-CANARY-ONE\n\n" +
  'Contents of /Users/somebody/work/repo/CLAUDE.md (project instructions, checked into the ' +
  'codebase):\n\nBROBOT-CANARY-TWO\n'

const TOLD: SessionInstructions = {
  injected: [
    {
      kind: 'profile-memory',
      path: '/Users/somebody/provider-homes/default/default/claude/CLAUDE.md',
      text: 'BROBOT-CANARY-ONE',
      bytes: 17,
      truncated: false,
    },
    {
      kind: 'project-memory',
      path: '/Users/somebody/work/repo/CLAUDE.md',
      text: 'BROBOT-CANARY-TWO',
      bytes: 17,
      truncated: false,
    },
  ],
  agentMemory: [
    {
      kind: 'agent-memory',
      path: '/Users/somebody/provider-homes/default/default/claude/memory/MEMORY.md',
      text: 'what the agent keeps',
      bytes: 20,
      truncated: false,
      reach: 'prompt',
    },
  ],
  provider: [],
  refused: [],
  note: 'The walk stopped at the home boundary.',
  recallsReported: false,
  writesReported: true,
  composed: COMPOSED,
}

const BODY = '[data-cy="document-body"]'

it('fits the launch evidence and the exact as-sent text at both app widths', async () => {
  const floor = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--app-min-w'),
    10,
  )
  expect(floor).toBeGreaterThan(0)
  for (const width of [1200, floor]) {
    await page.viewport(width, 900)
    const m = mount(AgentInputPopup, launchRecordProps(TOLD), { width, height: 900 })
    const evidence = m.q('input-launch-evidence') as HTMLDetailsElement
    const composition = m.q('told-composition') as HTMLDetailsElement
    expect(evidence.open).toBe(false)
    evidence.querySelector('summary')!.click()
    await nextTick()
    expect(composition.open).toBe(false)
    composition.querySelector('summary')!.click()
    await nextTick()

    const paper = composition.querySelector(BODY)!
    expect(visible(paper)).toBe(true)
    composition.querySelector<HTMLButtonElement>('[data-cy="doc-view-raw"]')!.click()
    await nextTick()
    expect(composition.querySelector('pre')?.textContent).toBe(COMPOSED)
    const body = m.q('input-popup-body')
    const outer = body.getBoundingClientRect()
    const inner = paper.getBoundingClientRect()
    expect(inner.left).toBeGreaterThanOrEqual(outer.left)
    expect(inner.right).toBeLessThanOrEqual(outer.right)
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1)
    m.unmount()
  }
})

it('states when the record cannot show the earlier launch', async () => {
  const original = mount(AgentInputPopup, launchRecordProps(TOLD), { width: 1000 })
  expect(original.q('told-composition').textContent).toContain('BroCrew’s text as sent')
  expect(original.all('told-earlier')).toHaveLength(0)
  original.unmount()

  const resumed = mount(
    AgentInputPopup,
    { ...launchRecordProps(TOLD), relaunched: true },
    { width: 1000 },
  )
  ;(resumed.q('input-launch-evidence') as HTMLDetailsElement).open = true
  await nextTick()
  expect(visible(resumed.q('told-earlier'))).toBe(true)
  expect(resumed.q('told-earlier').textContent).toContain('Earlier launch text unavailable')
})

it('keeps the last launch contribution distinct from a next-start preview', async () => {
  vi.stubGlobal('api', {
    runtime: {
      whatThisAgentWasGiven: async () =>
        givenAnswer({ launch: { recorded: false, why: 'before-this-build', running: false } }),
    },
  })
  const m = mount(AgentInputPopup, launchRecordProps(TOLD), { width: 1000 })
  await expect.poll(() => m.q('input-launch').textContent).toContain('next start')
  m.q('input-tab-1').click()
  await nextTick()
  m.q('input-launch-evidence').querySelector('summary')!.click()
  m.q('told-composition').querySelector('summary')!.click()
  await nextTick()
  expect(visible(m.q('told-composition-launch'))).toBe(true)
  expect(m.q('told-composition-launch').textContent).toBe('From the most recent launch.')
  expect(m.q('told-composition').textContent).toContain('BroCrew’s text as sent')
  expect(m.q('told-composition').textContent).toContain('BROBOT-CANARY-ONE')
})

it('explains that the provider copy is unavailable without showing a document for it', async () => {
  const given = givenAnswer()
  vi.stubGlobal('api', {
    runtime: {
      whatThisAgentWasGiven: async () => ({
        ...given,
        providerParts: {
          ...given.providerParts,
          snapshot: null,
          why: 'No stored copy for this mode.',
        },
      }),
    },
  })
  const m = mount(AgentInputPopup, launchRecordProps(TOLD), { width: 1000 })
  await expect.poll(() => m.all('input-provider-about')).toHaveLength(1)
  m.q('input-provider-about').querySelector('summary')!.click()
  await nextTick()
  expect(visible(m.q('input-provider-why'))).toBe(true)
  expect(m.q('input-provider-why').textContent).toContain('No stored copy for this mode.')
  expect(m.q('input-provider-about').querySelector(BODY)).toBeNull()
})
