import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import TranscriptView from '../../src/renderer/src/components/TranscriptView.vue'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

it('shows unknown provider events and their JSON only with Settings Debug mode on', async () => {
  const state = createTranscript()
  for (const provider of ['claude', 'codex']) {
    applyEvent(state, {
      type: 'unknown', provider, category: 'unrecognized', label: 'future_event',
      raw: { type: 'future_event', detail: `${provider} fictional payload` },
    })
  }
  for (const debug of [false, true, false]) {
    const getLogging = vi.fn().mockResolvedValue({ debug, path: '/fictional/log', servicePath: null })
    vi.stubGlobal('api', { ...window.api, logging: { getLogging } })
    const view = mount(TranscriptView, { items: state.items })
    await vi.waitFor(() => expect(view.all('unknown-entry')).toHaveLength(debug ? 2 : 0))
    expect(getLogging).toHaveBeenCalledOnce()
    expect(view.host.querySelectorAll('.entry[data-item]')).toHaveLength(debug ? 2 : 0)
    if (debug) {
      for (const [index, provider] of ['claude', 'codex'].entries()) {
        const card = view.all('unknown-entry')[index]!
        card.querySelector<HTMLButtonElement>('button')!.click()
        await nextTick()
        const body = card.querySelector<HTMLElement>('pre')!
        expect(getComputedStyle(body).display).not.toBe('none')
        expect(body.textContent).toContain(`${provider} fictional payload`)
      }
    }
    view.unmount()
  }
})
