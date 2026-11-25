import { afterEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import type { InjectedInstruction } from '../../src/shared/instruction-contracts'
import type { WhoseText } from '../../src/shared/whose-text'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import { META, launchRecordProps, mount, unmountAll, visible } from './harness'

afterEach(unmountAll)

const BUNDLE_PATH = '/tmp/home/brobot-instructions.md'

/**
 * ⚑ **A compiled bundle with a section for each of the three layers it really has** — built the
 * way main builds it, as offsets that tile the text, so the split under test is the real one.
 */
function bundle(): InjectedInstruction {
  const parts: { whose: WhoseText; heading: string | null; body: string }[] = [
    {
      whose: 'factory',
      heading: null,
      body: '<!-- brobot2:profile-instructions v1 -->\n\n# Your instructions',
    },
    { whose: 'factory', heading: 'Rules', body: '- never merge without asking' },
    {
      whose: 'configured',
      heading: 'Your own instructions',
      body: 'Run the gate before you say done.',
    },
    { whose: 'dynamic', heading: 'This conversation', body: '- You are running as `brobot`.' },
  ]
  let text = ''
  const sections = parts.map((part, index) => {
    const start = text.length
    const rendered = part.heading === null ? part.body : `## ${part.heading}\n\n${part.body}`
    text += index === parts.length - 1 ? `${rendered}\n` : `${rendered}\n\n`
    return { whose: part.whose, heading: part.heading, start, end: text.length }
  })
  return {
    kind: 'profile-instructions',
    path: BUNDLE_PATH,
    text,
    bytes: text.length,
    truncated: false,
    sections,
  }
}

const BUNDLE = bundle()

it('shows each mapped section under its own provenance, with the full path behind its row', async () => {
  const m = mount(
    AgentInputPopup,
    launchRecordProps({
      ...META.instructions,
      injected: [BUNDLE],
    }),
    { width: 880 },
  )
  const launch = m.q('input-launch-evidence') as HTMLDetailsElement
  launch.querySelector('summary')!.click()
  await nextTick()
  const sections = m.all('input-launch-source')
  expect(sections.map((row) => row.dataset.whose)).toEqual([
    'factory',
    'factory',
    'configured',
    'dynamic',
  ])
  for (const section of sections) {
    const summary = section.querySelector('summary')!
    const path = section.querySelector('.bb-mono')!
    expect(visible(summary)).toBe(true)
    expect(visible(path)).toBe(false)
    summary.click()
    await nextTick()
    expect(visible(path)).toBe(true)
    expect(path.textContent?.trim()).toBe(BUNDLE_PATH)
  }
  const yours = sections.find((row) => row.dataset.whose === 'configured')!
  expect(yours.textContent).toContain('Standing rules')
  expect(yours.textContent).toContain('Run the gate before you say done.')
  expect(yours.textContent).not.toContain('never merge without asking')
})

it('shows an older bundle whole instead of inventing ownership', async () => {
  const bundle = { ...BUNDLE }
  delete bundle.sections
  const m = mount(
    AgentInputPopup,
    launchRecordProps({
      ...META.instructions,
      injected: [bundle],
    }),
    { width: 880 },
  )
  const launch = m.q('input-launch-evidence') as HTMLDetailsElement
  launch.querySelector('summary')!.click()
  await nextTick()
  const summary = [...launch.querySelectorAll('summary')].find((one) =>
    one.textContent?.includes('Instructions without a source breakdown'),
  )!
  expect(visible(summary)).toBe(true)
  summary.click()
  await nextTick()
  const unsplit = summary.closest('details')!
  expect(unsplit.textContent).toContain(BUNDLE_PATH)
  expect(unsplit.textContent).toContain('Run the gate before you say done.')
  expect(unsplit.textContent).toContain('never merge without asking')
  expect(m.all('input-launch-source')).toHaveLength(0)
})
