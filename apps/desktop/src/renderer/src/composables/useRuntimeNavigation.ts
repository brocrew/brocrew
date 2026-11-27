import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { LibraryEntry } from '../../../shared/runtime-ipc'
import type { ClientScreenApi } from '../../../shared/client-screen-api'
import { readableError } from '../lib/session-record'
import { refusedToOpen } from '../lib/taking-over'
import { useWhoCalledWhom } from './useWhoCalledWhom'
import { createWindow, openAt, prependPage, type WindowState } from '../lib/transcript-window'
import { linkFailureReason, type ResolvedMessageLink } from '../lib/message-links'
import type { createMessageLinkResolver } from '../lib/runtime-message-links'
import { createPlaceHistory, type HistoryEntry, type Place } from '../lib/place-history'
import { aDialogIsOpen } from '../lib/a-dialog-is-open'
import { conversationTitle } from '../lib/conversation-list'
import { platformHere } from '../lib/this-computer'
import { provideMainTab, type MainTab } from './useMainTab'
import { providePlaceNavigator } from './usePlaceNavigator'
import type { AgentStore } from '../lib/agent-store'
import type { SessionStore } from '../lib/session-store'
import type { SettingsTab } from '../components/SettingsScreen.vue'
import type { Surface } from './useSurface'

export function useRuntimeNavigation({
  store,
  agentStore,
  place,
  activeId,
  view,
  showConversation,
  settingsTab,
  openSettings,
  onScreenNow,
  runtime,
  resolveMessageLink,
  say,
}: {
  store: SessionStore
  agentStore: AgentStore
  place: Surface['place']
  activeId: Surface['activeId']
  view: Surface['view']
  showConversation: Surface['showConversation']
  settingsTab: Ref<SettingsTab>
  openSettings: (tab?: SettingsTab) => void
  onScreenNow: ComputedRef<string | null>
  runtime: () => ClientScreenApi
  resolveMessageLink: ReturnType<typeof createMessageLinkResolver>
  say: (message: string) => void
}) {
  /**
   * A library entry this app holds no ledger for, being READ (047) — a conversation found in a
   * provider's folder and never imported, so there is no conversation to open: its view says so.
   *
   * Held here beside `place` rather than fetched inside the reading pane, for the same reason the
   * selected conversation is: the surface renders what it is handed, and the screen owns which one
   * that is.
   */
  const reading = ref<{ entry: LibraryEntry; history: WindowState } | null>(null)

  /**
   * An archived Library row uses the same read-only history route as conversation search.
   * Other recorded rows open in their full view. Provider-only rows keep the Library reader.
   */
  function readFromTheLibrary(entry: LibraryEntry): void {
    if (entry.recordId) {
      if (entry.archivedAt === undefined) void openConversation(entry.recordId)
      else void openFoundConversation(entry.recordId)
      return
    }
    reading.value = { entry, history: createWindow() }
    place.value = 'reading'
  }

  /** Back to the list. The transcript is dropped with it — nothing here is worth keeping warm. */
  function closeReading(): void {
    reading.value = null
    place.value = 'sessions'
  }

  /**
   * ⚑ **D-017b · open one conversation in its one full view** — every press that opens a conversation:
   * the rail's and the palette's rows, the room's and the Team page's, the forest's, a work report's
   * link, a queue row's travel and the library's rows.
   *
   * ⚑ One this window is fed is shown at once. Any other is looked at first ({@link SessionStore.look}):
   * the host hands it over — attached, taken when it runs with no window, or drawn from its ledger —
   * and it is shown only if the person has not moved meanwhile (`095`, `useSurface`'s rule).
   * ⛔ **Nothing is started**: a message sent from its view is what continues it.
   *
   * Resolves to whether it is on screen; a refusal is said in the host's own words.
   */
  async function openConversation(
    sessionId: string,
    stillHere: () => boolean = () => true,
  ): Promise<boolean> {
    const from = view()
    const opened = store.isLive(sessionId) ? sessionId : await store.look(sessionId)
    if (opened === null) {
      say(refusedToOpen(store.lookError.value))
      return false
    }
    if (!stillHere()) return false
    showConversation(opened, from)
    return place.value === null && activeId.value === opened
  }

  type LinkedHistoryReading = { sessionId: string; title: string; history: WindowState }
  interface MessageLinkPlace {
    view: ReturnType<typeof view>
    history: LinkedHistoryReading | null
    identity: string | null
  }
  const appElement = ref<HTMLElement | null>(null)
  /** The main area, where each place draws its page. */
  const mainArea = (): HTMLElement | null =>
    appElement.value?.querySelector<HTMLElement>('main.main') ?? null
  const linkedIdentity = ref<string | null>(null)
  const linkedHistory = ref<LinkedHistoryReading | null>(null)

  function messageLinkPlace(): MessageLinkPlace {
    return { view: view(), history: linkedHistory.value, identity: linkedIdentity.value }
  }

  function stillAtLinkPlace(from: MessageLinkPlace): boolean {
    const now = view()
    return (
      now.place === from.view.place &&
      now.activeId === from.view.activeId &&
      linkedHistory.value === from.history &&
      linkedIdentity.value === from.identity
    )
  }

  /** After a link opened a place, the window's Back takes the focus, so a key press goes back. */
  async function focusBack(): Promise<void> {
    await nextTick()
    appElement.value?.querySelector<HTMLButtonElement>('[data-cy="nav-back"]')?.focus()
  }

  /** Opening a link reads or selects; it never starts a conversation or answers its cards. */
  async function openMessageDestination(answer: ResolvedMessageLink): Promise<boolean> {
    const from = messageLinkPlace()
    const destination = answer.opens
    if (destination === null || answer.state === 'unavailable') return false
    if ('identityId' in destination) {
      await agentStore.load()
      if (agentStore.loadError.value !== null) return false
      if (!agentStore.identities.value?.identities.some((one) => one.id === destination.identityId))
        return false
      if (!stillAtLinkPlace(from)) return false
      linkedHistory.value = null
      linkedIdentity.value = destination.identityId
      place.value = 'team'
      await focusBack()
      return true
    }
    if (answer.state === 'archived') {
      const page = await runtime().latestHistory({ sessionId: destination.sessionId })
      if (!stillAtLinkPlace(from)) return false
      const history = createWindow()
      openAt(history, page, destination.sessionId)
      linkedHistory.value = { sessionId: destination.sessionId, title: answer.title ?? '', history }
      return true
    }
    if (!(await openConversation(destination.sessionId, () => stillAtLinkPlace(from)))) return false
    linkedHistory.value = null
    linkedIdentity.value = null
    await focusBack()
    return true
  }

  async function openFoundConversation(id: string): Promise<void> {
    const from = messageLinkPlace()
    try {
      const result = await resolveMessageLink(`brocrew://conversation/${encodeURIComponent(id)}`)
      if (!stillAtLinkPlace(from)) return
      if (!(await openMessageDestination(result)) && stillAtLinkPlace(from))
        say(linkFailureReason(result))
    } catch (cause) {
      if (stillAtLinkPlace(from)) say(readableError(cause))
    }
  }

  /**
   * Back and Forward: the places this window has shown, as `place-history.ts` keeps them. A place is a
   * screen, a conversation (with its tab), a Team profile, a library entry being read, or an archived
   * conversation's read-only history. It is recorded by watching what the screen shows, so every way
   * of getting somewhere counts the same. Going there again only reads: a conversation is opened as
   * the sidebar opens it, and nothing is sent, started or answered.
   */
  const mainTab = ref<MainTab>('conversation')
  provideMainTab(mainTab)
  const places = createPlaceHistory()
  /** Set while Back or Forward puts a place on screen, so nothing reads that as a move of its own. */
  let showingFromHistory = false
  /** Moves whenever the history does, so what reads it draws again. */
  const historyMoved = ref(0)
  /**
   * Counts the places a person went to, so a step that finishes after they went on is dropped. A
   * different place or another tab of it is a move; the same place drawn again with a new name is not.
   */
  let arrivals = 0

  const SCREEN_NAME: Readonly<Record<string, string>> = {
    waiting: 'Waiting on you',
    away: 'Recent activity',
    new: 'New conversation',
    sessions: 'All conversations',
    team: 'Team',
    settings: 'Settings',
  }

  function conversationName(sessionId: string): string {
    // Read here rather than through `cast`: the watch below first runs before `cast` is declared.
    const row = useWhoCalledWhom().listedConversations.value?.find(
      (one) => one.sessionId === sessionId,
    )
    return row === undefined ? 'a conversation' : conversationTitle(row.label, row.named)
  }

  /** The place on screen now, or `null` while it shows nothing a person chose. */
  function placeHere(): Place | null {
    const archive = linkedHistory.value
    if (archive !== null) {
      return {
        key: `archive:${archive.sessionId}`,
        name: archive.title === '' ? 'an archived conversation' : archive.title,
        conversation: archive.sessionId,
        identity: null,
        tab: null,
        payload: archive,
      }
    }
    const where = place.value
    if (where === 'team' && linkedIdentity.value !== null) {
      const id = linkedIdentity.value
      const one = agentStore.identities.value?.identities.find((each) => each.id === id)
      return {
        key: `profile:${id}`,
        name: one === undefined ? 'an agent' : (one.displayName ?? one.slug),
        conversation: null,
        identity: id,
        tab: null,
      }
    }
    if (where === 'reading') {
      const read = reading.value
      if (read === null) return null
      return {
        key: `reading:${read.entry.id}`,
        name: read.entry.title,
        conversation: null,
        identity: null,
        tab: null,
        payload: read.entry,
      }
    }
    if (where !== null) {
      return {
        key: `screen:${where === 'tools' || where === 'providers' ? 'settings' : where}`,
        name:
          SCREEN_NAME[where] ?? (where === 'tools' || where === 'providers' ? 'Settings' : where),
        conversation: null,
        identity: null,
        tab: where === 'settings' ? settingsTab.value : null,
      }
    }
    const id = activeId.value
    if (id === null) return null
    return {
      key: `conversation:${id}`,
      name: conversationName(id),
      conversation: id,
      identity: null,
      tab: mainTab.value,
    }
  }

  /** The page's scroller: the tallest box in the main area that scrolls. */
  function mainScroller(): HTMLElement | null {
    const main = mainArea()
    if (main === null) return null
    let best: HTMLElement | null = null
    for (const one of main.querySelectorAll<HTMLElement>('*')) {
      if (one.scrollHeight <= one.clientHeight + 1) continue
      const overflow = getComputedStyle(one).overflowY
      if (overflow !== 'auto' && overflow !== 'scroll') continue
      if (best === null || one.clientHeight > best.clientHeight) best = one
    }
    return best
  }

  const scrollNow = (): number | null => mainScroller()?.scrollTop ?? null

  // Whatever moved the screen, the place it shows now is recorded, before it is drawn, so the page
  // being left still says where it was scrolled to.
  watch(
    placeHere,
    (now) => {
      if (now === null) return
      const was = places.current()?.place
      if (!showingFromHistory && (was?.key !== now.key || was.tab !== now.tab)) arrivals += 1
      places.arrive(now, scrollNow)
      historyMoved.value += 1
    },
    // The first place too: a window that opens on the launcher can come back to it.
    { flush: 'pre', immediate: true },
  )

  // An archived history is read over the place it was opened from; moving to another place ends it.
  watch(
    [place, activeId],
    () => {
      if (!showingFromHistory) linkedHistory.value = null
    },
    { flush: 'sync' },
  )

  const backTo = computed(() => {
    void historyMoved.value
    return places.next(-1)?.place.name ?? null
  })
  const forwardTo = computed(() => {
    void historyMoved.value
    return places.next(1)?.place.name ?? null
  })

  /** Read an archived conversation's newest page, for its read-only history. */
  async function archiveReading(sessionId: string, title: string): Promise<LinkedHistoryReading> {
    const page = await runtime().latestHistory({ sessionId })
    const history = createWindow()
    openAt(history, page, sessionId)
    return { sessionId, title, history }
  }

  /**
   * What showing `entry` again needs, read before anything moves: `ready` with the archived page it
   * shows, if any; `gone` when its profile was removed; or `refused` with the host's words.
   */
  type Readiness =
    | { kind: 'ready'; archive: LinkedHistoryReading | null }
    | { kind: 'gone' }
    | { kind: 'refused'; words: string }

  async function readyToShow(entry: HistoryEntry): Promise<Readiness> {
    const target = entry.place
    if (target.identity !== null) {
      await agentStore.load()
      const known = agentStore.identities.value?.identities.some(
        (one) => one.id === target.identity,
      )
      return known === false ? { kind: 'gone' } : { kind: 'ready', archive: null }
    }
    const id = target.conversation
    if (id === null) return { kind: 'ready', archive: null }
    const archived = target.key.startsWith('archive:')
    if (!archived && store.get(id) !== null) return { kind: 'ready', archive: null }
    // The host is asked first, every time: deleted since, it is gone past; archived since, from here
    // or elsewhere, it comes back as its read-only history.
    const now = await resolveMessageLink(`brocrew://conversation/${encodeURIComponent(id)}`).catch(
      () => null,
    )
    if (now?.state === 'deleted') return { kind: 'gone' }
    if (!archived && now?.state === 'archived') {
      places.markArchived([id], archiveKey)
      historyMoved.value += 1
    } else if (!archived) {
      if ((await store.look(id, 'again')) !== null) return { kind: 'ready', archive: null }
      return { kind: 'refused', words: refusedToOpen(store.lookError.value) }
    }
    // A page already read is shown again only once the host has said the conversation is there.
    const kept = target.payload as LinkedHistoryReading | undefined
    const there = now?.state === 'archived' || now?.state === 'available'
    if (archived && there && kept !== undefined) return { kind: 'ready', archive: kept }
    try {
      return { kind: 'ready', archive: await archiveReading(id, entry.place.name) }
    } catch (cause) {
      return { kind: 'refused', words: refusedToOpen(readableError(cause)) }
    }
  }

  const archiveKey = (conversation: string): string => `archive:${conversation}`

  async function show(target: Place, archive: LinkedHistoryReading | null): Promise<void> {
    showingFromHistory = true
    try {
      if (archive !== null) {
        linkedIdentity.value = null
        linkedHistory.value = archive
        return
      }
      linkedHistory.value = null
      if (target.key.startsWith('conversation:') && target.conversation !== null) {
        linkedIdentity.value = null
        activeId.value = target.conversation
        place.value = null
        mainTab.value = (target.tab as MainTab | null) ?? 'conversation'
        return
      }
      if (target.key.startsWith('profile:')) {
        linkedIdentity.value = target.identity
        place.value = 'team'
        return
      }
      if (target.key.startsWith('reading:')) {
        reading.value = { entry: target.payload as LibraryEntry, history: createWindow() }
        place.value = 'reading'
        return
      }
      linkedIdentity.value = null
      const screen = target.key.slice('screen:'.length)
      if (screen === 'settings') openSettings((target.tab as SettingsTab | null) ?? 'providers')
      else place.value = screen
    } finally {
      await nextTick()
      showingFromHistory = false
    }
  }

  /**
   * Where a step is: `reading` until the place it goes to is on screen, then `drawing` while that
   * page settles (its scroll and focus are put back).
   */
  let travelling: 'reading' | 'drawing' | null = null
  /** A press made while a step was drawing, and the arrivals count it was made at. */
  let pressedWhileDrawing: { step: -1 | 1; at: number } | null = null

  /**
   * Whether a step read so far may now be taken: refused when the person went somewhere meanwhile,
   * or a dialog opened while it was read. Asked right before anything moves, after every wait.
   */
  const mayMoveNow = (startedAt: number): boolean => arrivals === startedAt && !aDialogIsOpen()

  /** A place's name at the start of a sentence: a name we have as it is, the fallbacks capitalised. */
  const UNNAMED = new Set(['a conversation', 'an agent', 'an archived conversation'])
  const sentenceStart = (name: string): string =>
    UNNAMED.has(name) ? name.charAt(0).toUpperCase() + name.slice(1) : name

  /**
   * One step back (-1) or forward (1). Each place on the way is checked before anything moves: a
   * removed one is gone past and named, and one that can't be shown leaves the window and its place
   * in the history where they were. A person who goes somewhere meanwhile keeps their move.
   */
  async function go(step: -1 | 1): Promise<void> {
    if (aDialogIsOpen()) return
    // Once the reached place is on screen, a press is the next step, taken when this one is done.
    if (travelling === 'drawing') {
      // The first press since the person's last move is kept; one from before that move is replaced.
      if (pressedWhileDrawing === null || pressedWhileDrawing.at !== arrivals)
        pressedWhileDrawing = { step, at: arrivals }
      return
    }
    // A press while a step is still reading is that step's, and does nothing more.
    if (travelling !== null) return
    travelling = 'reading'
    const startedAt = arrivals
    const looked: string[] = []
    try {
      for (;;) {
        const target = places.next(step)
        if (target === undefined) return
        const conversation = target.place.conversation
        const held = conversation !== null && store.get(conversation) !== null
        const ready = await readyToShow(target)
        if (conversation !== null && !held && store.get(conversation) !== null)
          looked.push(conversation)
        // The one wait before anything moves is over: from here to the step, nothing awaits.
        if (!mayMoveNow(startedAt)) return
        if (ready.kind === 'refused') {
          say(ready.words)
          return
        }
        if (ready.kind === 'gone') {
          const removed = target.place.identity ?? target.place.conversation
          if (removed === null) return
          places.markGone([removed])
          historyMoved.value += 1
          continue
        }
        const { reached, passed } = places.go(step, scrollNow)
        historyMoved.value += 1
        const way = step === -1 ? 'Back' : 'Forward'
        for (const one of passed)
          say(`${sentenceStart(one.place.name)} was deleted, so ${way} went past it.`)
        if (reached === undefined) return
        await show(reached.place, ready.archive)
        travelling = 'drawing'
        await nextTick()
        await new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        )
        const scroller = mainScroller()
        if (scroller !== null && reached.scroll !== null) scroller.scrollTop = reached.scroll
        // Focus left with the page it was on goes to the new page's heading, never to the body.
        const focused = document.activeElement
        if (focused === null || focused === document.body || !focused.isConnected) {
          const heading = mainArea()?.querySelector<HTMLElement>('h1, h2')
          if (heading) {
            if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
            heading.focus({ preventScroll: true })
          }
        }
        return
      }
    } finally {
      travelling = null
      // A conversation opened for a step that didn't happen is let go again.
      for (const id of looked) if (id !== onScreenNow.value) store.forget(id)
      const next = pressedWhileDrawing
      pressedWhileDrawing = null
      // A person who went somewhere after the press keeps that move instead.
      if (next !== null && next.at === arrivals) void go(next.step)
    }
  }

  providePlaceNavigator({
    backTo,
    forwardTo,
    back: () => void go(-1),
    forward: () => void go(1),
  })

  const onAMac = /mac/i.test(platformHere())

  /** The step a key press asks for: ⌘[ and ⌘] on a Mac, Alt+← and Alt+→ elsewhere; else `null`. */
  function historyKey(event: KeyboardEvent): -1 | 1 | null {
    if (onAMac) {
      if (!event.metaKey || event.ctrlKey || event.altKey) return null
      if (event.key === '[' || event.code === 'BracketLeft') return -1
      if (event.key === ']' || event.code === 'BracketRight') return 1
      return null
    }
    if (!event.altKey || event.ctrlKey || event.metaKey) return null
    if (event.key === 'ArrowLeft') return -1
    if (event.key === 'ArrowRight') return 1
    return null
  }

  /**
   * A mouse's side button can reach the window twice, as its own press and as main's push, in either
   * order. The other channel's event for the same step within this long is the same press: it is
   * paired with the press it belongs to and does nothing, and a press already paired takes no more.
   */
  const SAME_PRESS_MS = 300
  let lastPress: { step: -1 | 1; at: number; from: 'mouse' | 'main'; paired: boolean } | null = null

  function pressed(step: -1 | 1, from: 'mouse' | 'main'): void {
    const now = Date.now()
    const before = lastPress
    if (
      before !== null &&
      !before.paired &&
      before.from !== from &&
      before.step === step &&
      now - before.at < SAME_PRESS_MS
    ) {
      before.paired = true
      return
    }
    lastPress = { step, at: now, from, paired: false }
    void go(step)
  }

  function onSideButton(event: MouseEvent): void {
    if (event.button !== 3 && event.button !== 4) return
    event.preventDefault()
    if (event.type !== 'mouseup') return
    pressed(event.button === 3 ? -1 : 1, 'mouse')
  }

  async function olderLinkedHistory(): Promise<void> {
    const reading = linkedHistory.value
    if (reading === null) return
    const page = await runtime().earlierHistory({
      sessionId: reading.sessionId,
      before: reading.history.from,
    })
    if (linkedHistory.value === reading) prependPage(reading.history, page, reading.sessionId)
  }

  return {
    appElement,
    archiveKey,
    closeReading,
    conversationName,
    go,
    historyKey,
    historyMoved,
    linkedHistory,
    linkedIdentity,
    mainTab,
    olderLinkedHistory,
    onSideButton,
    openConversation,
    openFoundConversation,
    openMessageDestination,
    places,
    pressed,
    readFromTheLibrary,
    reading,
  }
}
