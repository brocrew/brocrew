import { browserIdentity } from './authorization.js'
import {
  DEFAULT_TIMEOUT_MS,
  cacheTabTitle,
  checkUrl,
  describeError,
  generationOf,
  openDialogNote,
  profileName,
  tabId,
  titleAfterLoad,
  url,
  usableProfile,
} from './common.js'
import type { ToolDef, ToolOutput } from './common.js'
import { ToolError } from './schema.js'

export const openTab: ToolDef = {
  downloadRouting: false,
  spec: {
    name: 'open_tab',
    description:
      'Open a background tab at a URL or absolute local path. Returns tabId, windowId and the requested URL once placed. The initial title is empty while the page loads. Use wait_for for the URL or content you need. windowOf selects an existing tab’s window and fails clearly if the helper cannot place it there; it never opens elsewhere as a fallback. Otherwise use Chrome’s most recently active available window. Chrome is never brought forward. newWindow:true opens a separate window.',
    props: {
      profile: profileName,
      url,
      windowOf: {
        ...tabId,
        description:
          'Open in this live tab’s window, in the same profile. Fails if the helper cannot place it there. Cannot accompany newWindow:true.',
      },
      newWindow: {
        type: 'boolean',
        description: 'Open in a new window.',
      },
    },
    required: ['profile', 'url'],
  },
  async run(a, deps) {
    const name = a.profile as string
    const target = checkUrl(a.url as string)
    if (a.windowOf !== undefined && a.newWindow === true)
      throw new ToolError('give either newWindow:true or windowOf, not both')
    const selectedAnchor = () => {
      if (a.windowOf === undefined) return undefined
      const tab = deps.tabs.resolve(a.windowOf as string, generationOf(deps))
      if (tab.profile !== name)
        throw new ToolError('windowOf must name a tab in the requested profile')
      return tab
    }
    selectedAnchor()
    usableProfile(deps, name)
    const browser = browserIdentity(deps.browser)
    deps.tabs.watch(name, browser)
    let confirmPlacement!: (receipt: ToolOutput) => void
    const placed = new Promise<ToolOutput>((resolve) => {
      confirmPlacement = resolve
    })
    const open = async () => {
      const { navigation } = await deps.browser.exclusive(name, async () => {
        deps.signal?.throwIfAborted()
        usableProfile(deps, name)
        selectedAnchor()
        const { generation } = await deps.browser.ensure(name, deps.signal)
        deps.activity?.('browser-ready')
        usableProfile(deps, name)
        let openingNote: string | undefined
        const page = await deps.browser.newPage(name, {
          newWindow: a.newWindow === true,
          windowOf: selectedAnchor()?.page,
          signal: deps.signal,
          onNote: (note) => {
            openingNote = note
          },
        })
        const tab = deps.tabs.add(name, generation, page)
        try {
          const windowId =
            deps.browser.knownWindowId?.(name, page) ??
            (await deps.browser.windowId(name, page, deps.signal))
          deps.signal?.throwIfAborted()
          deps.activity?.('page-ready')
          usableProfile(deps, name)
          confirmPlacement({
            json: {
              tabId: tab.id,
              windowId,
              url: target,
              title: '',
              ...(openingNote ? { note: openingNote } : {}),
            },
          })
          const navigation = async () => {
            try {
              await page.goto(target, {
                waitUntil: 'domcontentloaded',
                timeout: DEFAULT_TIMEOUT_MS,
              })
              await cacheTabTitle(tab, titleAfterLoad)
            } catch (error) {
              if (!tab.closed && !openDialogNote(tab)) tab.notes.push(describeError(error))
            }
          }
          return { navigation: navigation() }
        } catch (error) {
          throw new ToolError(`TAB_CREATED ${tab.id}: ${describeError(error)}`)
        }
      })
      // The profile serializer has released. Keep private routing through the navigation.
      await navigation
      return placed
    }
    const running = browser.agentCall?.([name], open, deps.signal) ?? open()
    return Promise.race([placed, running])
  },
}
