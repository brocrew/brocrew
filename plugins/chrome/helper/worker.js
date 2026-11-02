// BroCrew helper: small jobs the BroCrew Chrome plugin asks of this profile's Chrome.
// The plugin calls run() by evaluating in this worker over its own debugging pipe; no page,
// site or other extension can reach it. A job that answers created: false made nothing.
const MARKER = /^about:blank#new-tab-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const jobs = {
  // Opens a background tab in the given window. Chrome never shows or activates the window.
  'place-tab': async (input) => {
    if (!Number.isSafeInteger(input?.windowId) || !MARKER.test(input?.url ?? ''))
      return { ok: false, created: false, error: 'invalid input' }
    const tab = await chrome.tabs.create({
      windowId: input.windowId,
      url: input.url,
      active: false,
    })
    return { ok: true, windowId: tab.windowId }
  },
}

globalThis.brocrewHelper = Object.freeze({
  protocol: 1,
  jobs: Object.freeze(Object.keys(jobs)),
  async run(name, input) {
    if (!Object.hasOwn(jobs, name)) return { ok: false, created: false, error: 'unknown job' }
    try {
      return await jobs[name](input)
    } catch (error) {
      // Chrome rejects tabs.create without creating a tab.
      return { ok: false, created: false, error: String(error?.message ?? error).slice(0, 200) }
    }
  },
})
