import type {
  InjectedInstruction,
  SessionInstructions,
} from '../../src/shared/instruction-contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import AgentInputPopup from '../../src/renderer/src/components/AgentInputPopup.vue'
import SessionInfo from '../../src/renderer/src/components/SessionInfo.vue'
import { assertDrawn, drawnReady } from './drawn'
import { META, launchRecordProps, mount, unmountAll, type Mounted } from './harness'

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const FRESH = META.instructions

const INDEX: InjectedInstruction = {
  kind: 'agent-memory',
  path: '/homes/default/memory/MEMORY.md',
  text: '- [Reviewer handle](user_reviewer_handle.md) — who reviews this work',
  bytes: 205,
  truncated: false,
  reach: 'prompt',
}

function openSheet(instructions: SessionInstructions, width = 1200): Mounted {
  return mount(AgentInputPopup, launchRecordProps(instructions), { width, height: 900 })
}

async function revealRecord(m: Mounted): Promise<void> {
  const record = m.q('input-launch-evidence') as HTMLDetailsElement
  expect(record.open).toBe(false)
  record.querySelector('summary')!.click()
  await nextTick()
  expect(record.open).toBe(true)
}

it('explains an empty memory store at both app widths', async () => {
  const floor = Number.parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--app-min-w'),
    10,
  )
  expect(floor).toBeGreaterThan(0)
  for (const width of [1200, floor]) {
    await page.viewport(width, 900)
    const m = openSheet(FRESH, width)
    await revealRecord(m)
    await drawnReady()
    const absence = m.q('told-remembers-nothing')
    expect(absence.textContent?.trim()).toBe('No provider memory files recorded.')
    assertDrawn(absence, `the launch memory absence at ${width}px`)
    expect(m.all('input-launch-memory-file')).toHaveLength(0)
    expect(m.all('memory-store-not-a-reading')).toHaveLength(0)
    expect(m.all('input-launch-source')).toHaveLength(0)
    m.unmount()
  }
})

it('shows the same absence for older conversations with no memory field', async () => {
  const older = { ...FRESH } as Record<string, unknown>
  delete older['agentMemory']
  const m = openSheet(older as unknown as SessionInstructions)
  await revealRecord(m)
  expect(m.q('told-remembers-nothing').textContent?.trim()).toBe(
    'No provider memory files recorded.',
  )
  expect(m.all('input-launch-memory-file')).toHaveLength(0)
})

it('lists the recorded memory file and distinguishes it from a recall', async () => {
  const m = openSheet({ ...FRESH, agentMemory: [INDEX] })
  await revealRecord(m)
  expect(m.all('input-launch-memory-file')).toHaveLength(1)
  expect(m.q('input-launch-memory-file').querySelector('summary')?.textContent).toContain(
    'In the prompt',
  )
  expect(m.q('memory-store-not-a-reading').textContent).toContain(
    'Stored files don’t show which ones the agent opened.',
  )
  expect(m.all('told-remembers-nothing')).toHaveLength(0)
})

it('reports missing composed text independently of missing memory', async () => {
  const m = openSheet(FRESH)
  await revealRecord(m)
  m.q('told-composition').querySelector('summary')!.click()
  await nextTick()
  expect(m.q('told-appended-nothing').textContent?.trim()).toBe('BroCrew sent no composed text.')
  expect(m.q('told-remembers-nothing').textContent?.trim()).toBe(
    'No provider memory files recorded.',
  )
  expect(m.q('told-composition').querySelector('[data-cy="document-body"]')).toBeNull()
})

it('distinguishes an older conversation with no composed field from a recorded empty contribution', async () => {
  const older = { ...FRESH } as Record<string, unknown>
  delete older['composed']
  const m = openSheet(older as unknown as SessionInstructions)
  await revealRecord(m)
  m.q('told-composition').querySelector('summary')!.click()
  await nextTick()
  expect(m.q('told-composition-unavailable').textContent?.trim()).toBe('No composed text recorded.')
  expect(m.all('told-appended-nothing')).toHaveLength(0)
  expect(m.q('told-composition').querySelector('[data-cy="document-body"]')).toBeNull()
})

describe('the Info entry at both drawer widths', () => {
  const openIndex = (width: number): Mounted =>
    mount(
      SessionInfo as never,
      { session: META, sessionRef: null, ended: false },
      { width, height: 900 },
    )

  /** The drawer's floor and ceiling, read from `tokens.css` (W4.183: fluid between the two). */
  function drawerWidths(): number[] {
    const style = getComputedStyle(document.documentElement)
    return ['--drawer-w-min', '--drawer-w-max'].map((name) => {
      const px = Number.parseInt(style.getPropertyValue(name).trim(), 10)
      expect(px, `${name} is gone from tokens.css`).toBeGreaterThan(0)
      return px
    })
  }

  it('🔴 the entry that opens the sheet NAMES memory, and draws it whole at both drawer widths', async () => {
    for (const width of drawerWidths()) {
      await page.viewport(Math.max(width + 200, 1200), 900)
      const m = openIndex(width)
      await drawnReady()
      const says = m.q('told-index-says')
      expect((says.textContent ?? '').replace(/\s+/g, ' ').trim()).toContain('its own memory')
      assertDrawn(says, `the index entry’s sentence at ${String(width)}px`)
      m.unmount()
    }
  })
})
