import { afterEach, expect, it, vi } from 'vitest'
import type { TranscriptEvent } from '../../src/shared/conversation-events'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

it('shows one quiet common line per summary in normal mode while unknowns remain Debug-only', async () => {
  const state = createTranscript()
  for (const event of [
    { type: 'command_summary', description: 'Checking a fictional change' },
    {
      type: 'turn_summary',
      status: 'completed',
      detail: 'The fictional change is checked',
      needsAction: 'Review the fictional change',
    },
    {
      type: 'turn_summary',
      detail: 'No decision is needed',
      needsAction: 'Do not interpret an unknown status',
    },
  ])
    applyEvent(state, event as TranscriptEvent)
  applyEvent(state, {
    type: 'unknown',
    provider: 'fictional-provider',
    category: 'unrecognized',
    label: 'new_event',
    raw: { detail: 'Fictional raw payload' },
  })
  let debug = false
  const getLogging = vi.fn(async () => ({ debug, path: '/fictional/log', servicePath: null }))
  vi.stubGlobal('api', { ...window.api, logging: { getLogging } })
  const view = mount(TranscriptView, { items: state.items })
  await vi.waitFor(() => expect(getLogging).toHaveBeenCalledOnce())
  expect(view.all('command-summary')).toHaveLength(1)
  expect(view.all('turn-summary')).toHaveLength(2)
  expect(view.all('command-summary')[0]!.textContent?.trim()).toBe('Checking a fictional change')
  expect(view.all('turn-summary')[0]!.textContent).toContain('completed')
  expect(view.all('turn-summary')[0]!.textContent).toContain('The fictional change is checked')
  expect(view.all('turn-summary')[0]!.textContent).toContain('Review the fictional change')
  expect(view.all('turn-summary')[1]!.textContent).not.toContain('Review the fictional change')
  expect(view.all('unknown-entry')).toHaveLength(0)
  expect(view.host.querySelectorAll('pre')).toHaveLength(0)
  debug = true
  window.dispatchEvent(new Event('focus'))
  await vi.waitFor(() => expect(view.all('unknown-entry')).toHaveLength(1))
  expect(view.all('command-summary')).toHaveLength(1)
  expect(view.all('turn-summary')).toHaveLength(2)
})
