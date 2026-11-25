import { computed, onMounted, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { AppInfo } from '@brobot2/shared'
import type { KeptFile, Provider } from '../../../shared/runtime-ipc'
import { DEFAULT_PROFILE_ID, HELD_ELSEWHERE } from '../../../shared/runtime-ipc'
import { type AgentStore } from '../lib/agent-store'
import type { ClientScreenApi } from '../../../shared/client-screen-api'
import { oneReadAtATime } from '../lib/one-read-at-a-time'
import { leftTheListsFromElsewhere } from '../lib/archive-and-delete'
import { whenTheWorldMoves } from '../lib/the-world-moved'
import { appClosing } from '../lib/app-closing'
import { readableError } from '../lib/session-record'
import { LOOK_EVERY_MS, type PersonsQueue } from '../lib/persons-queue'
import { pickInAConversation } from '../lib/model-lists'
import type { WhatIsBeingDone } from '../../../shared/what-is-being-done'
import type { ForestWindow } from '../../../shared/the-whole-forest'
import { readForestPages, type ForestSnapshot } from '../lib/forest-reading'
import { foldGraphReading } from '../lib/forest-graph-reading'
import { ROSTER_EVERY_MS } from '../lib/team-roster'
import type { WorkGivenOutReading } from '../lib/work-given-out'
import type {
  ConversationIdentity,
  ConversationRenameInput,
} from '../../../shared/conversation-title'
import { filesReadFor } from '../lib/files-kept'
import { screenFacts, useWhoCalledWhom } from './useWhoCalledWhom'
import { MAX_DIGEST_SPAN_MS } from '../../../shared/digest'
import type { RecentActivityReading } from '../../../shared/recent-activity'
import {
  ACTIVITY_READ_EVERY_MS,
  DEFAULT_ACTIVITY_WINDOW_MS,
  sinceView,
} from '../lib/recent-activity'
import { useLastSeen } from './useLastSeen'
import type { TitleHistorySource } from '../components/ConversationTitleHistory.vue'
import type { TaskPageSource } from './useConversationTaskPage'
import { firstHumanMessageOf } from '../../../shared/human-turn-answer'
import { listenProviderStates } from '../lib/provider-limit-facts'
import type { ModelLists } from '../lib/model-lists'
import type { SessionStore } from '../lib/session-store'
import type SessionLibrary from '../components/SessionLibrary.vue'
import type SideRail from '../components/SideRail.vue'
import type { FilesLibraryController } from './useFilesLibrary'
import type { MainTab } from './useMainTab'
import type { Surface } from './useSurface'
import type { TeamProfileGraphController } from './useTeamProfileGraph'
import type { useRuntimeAttention } from './useRuntimeAttention'

export function useRuntimeScreenReadings({
  attention,
  screen,
  info,
  mainTab,
  onScreenNow,
  rail,
  library,
  teamProfileGraph,
  filesLibrary,
  modelLists,
  agentStore,
  persons,
  runtime,
  archivedHere,
  refreshAgents,
  authChangedFor,
  invalidatePrograms,
  readPrograms,
  goToTheWork,
  store,
}: {
  attention: ReturnType<typeof useRuntimeAttention>
  screen: Pick<Surface, 'active' | 'activeId' | 'surface'>
  info: Ref<AppInfo | null>
  mainTab: Ref<MainTab>
  onScreenNow: ComputedRef<string | null>
  rail: Ref<InstanceType<typeof SideRail> | null>
  library: Ref<InstanceType<typeof SessionLibrary> | null>
  teamProfileGraph: TeamProfileGraphController
  filesLibrary: FilesLibraryController
  modelLists: ModelLists
  agentStore: AgentStore
  persons: PersonsQueue
  runtime: () => ClientScreenApi
  archivedHere: (conversations: readonly string[]) => void
  refreshAgents: () => void
  authChangedFor: (profileId: string, changedProvider?: Provider) => void
  invalidatePrograms: () => void
  readPrograms: () => Promise<void>
  goToTheWork: (sessionId: string) => Promise<void>
  store: SessionStore
}) {
  const { active, activeId, surface } = screen
  const {
    conversationWaits,
    limitsLane,
    lookAfterAQueueNotice,
    lookForWhatIsYours,
    readTheWorkspace,
    readWhatIsWaiting,
    refreshLimitsDisplay,
    closeActionableReads,
  } = attention
  let stopHearingLimits: (() => void) | null = null
  let looking: ReturnType<typeof setInterval> | null = null

  /** The time window Recent activity reads, as the person chose it. */
  const activityWindowMs = ref<number>(DEFAULT_ACTIVITY_WINDOW_MS)

  function chooseActivityWindow(ms: number): void {
    activityWindowMs.value = ms
    void readActivity()
  }

  /**
   * Recent activity for the chosen window, and, for Waiting on you, what finished or failed since the
   * person was last here. Each reading is kept with the window or visit it was read for and shown
   * only for that one, so a reply for another span never speaks for the one chosen; only the newest
   * ask may write. A read that fails leaves `null`, which the page says is not read yet.
   */
  const activityHeld = ref<{ span: number; reading: RecentActivityReading | null } | null>(null)
  const activityReading = computed(() =>
    activityHeld.value?.span === activityWindowMs.value ? activityHeld.value.reading : null,
  )
  const sinceReading = ref<{
    since: number
    from: number
    reading: RecentActivityReading
  } | null>(null)
  let activityAsked = 0
  let sinceAsked = 0
  let readingActivity: ReturnType<typeof setInterval> | null = null
  const lastSeen = useLastSeen(() => info.value?.workspace.path ?? null)

  /** One read per call, for the page on screen: the page's window, or the box's visit. */
  async function readActivity(): Promise<void> {
    if (surface.value === 'away') return readPage()
    if (surface.value === 'waiting') return readSince()
  }

  async function readPage(): Promise<void> {
    const to = Date.now()
    const asked = activityWindowMs.value
    const mine = ++activityAsked
    const reading = await store.recentActivity(to - asked, to)
    if (mine === activityAsked && asked === activityWindowMs.value)
      activityHeld.value = { span: asked, reading }
  }

  async function readSince(): Promise<void> {
    const since = lastSeen.since.value
    if (since === null) return
    const to = Date.now()
    // No further back than one read may reach; the box then says the time it starts from.
    const from = Math.max(since, to - MAX_DIGEST_SPAN_MS)
    const mine = ++sinceAsked
    const reading = await store.recentActivity(from, to)
    if (mine !== sinceAsked || since !== lastSeen.since.value) return
    sinceReading.value = reading === null ? null : { since, from, reading }
  }

  const sinceLastHere = computed(() => {
    const held = sinceReading.value
    if (held === null || held.since !== lastSeen.since.value) return null
    const seen = sinceView(held.reading, held.from)
    return seen === null ? null : { view: seen, since: held.from }
  })
  watch(lastSeen.since, () => void readActivity())

  /** Live activity refines graph rows; paged graph facts keep their own read time. */
  const forestFacts = () => ({
    waits: conversationWaits.value,
    identities: agentStore.identities.value?.identities ?? null,
    held: new Set(store.live.value.map((record) => record.sessionId)),
    said: cast.railSays.value,
  })
  const beingDone = ref<WhatIsBeingDone | null>(null)
  const forestWindow = ref<ForestWindow>('day')
  const theForest = ref<ForestSnapshot | null>(null)
  const forestPending = ref(false)
  const forestError = ref<string | null>(null)
  let forestEpoch = 0
  const theForestView = computed(() =>
    foldGraphReading(theForest.value, beingDone.value, forestFacts()),
  )
  const ownForest = ref<ForestSnapshot | null>(null)
  const ownForestFor = ref<string | null>(null)
  const ownForestPending = ref(false)
  const ownForestError = ref<string | null>(null)
  let ownForestEpoch = 0
  const conversationForestView = computed(() =>
    ownForestFor.value === activeId.value
      ? foldGraphReading(ownForest.value, cast.reading.value?.atWork ?? null, forestFacts())
      : null,
  )
  const readConversationForest = () => conversationForestView.value

  /** Read membership, counts and pages together; a moved screen cannot accept an older answer. */
  async function readWhoIsWorkingOnce(): Promise<void> {
    if (surface.value !== 'team') return
    const window = forestWindow.value
    const epoch = forestEpoch
    const current = () =>
      surface.value === 'team' && epoch === forestEpoch && window === forestWindow.value
    forestPending.value = true
    forestError.value = null
    let received = false
    const doing = store.whatIsBeingDone()
    const complete = await readForestPages(
      store,
      { is: 'the-workspace', window },
      current,
      (snapshot) => {
        received = true
        theForest.value = snapshot
      },
    )
    const atWork = await doing
    if (!current()) return
    beingDone.value = atWork
    forestPending.value = false
    if (!complete) {
      forestError.value = 'Could not finish reading the graph.'
      if (!received) theForest.value = null
    }
  }
  const readWhoIsWorking = oneReadAtATime(readWhoIsWorkingOnce)
  function chooseForestWindow(window: ForestWindow): void {
    forestEpoch += 1
    forestWindow.value = window
    void readWhoIsWorking()
  }
  watch(surface, (now) => {
    forestEpoch += 1
    if (now === 'team') void readWhoIsWorking()
  })

  const readOwnForest = oneReadAtATime(async () => {
    const asked =
      surface.value === 'conversation' && mainTab.value === 'graph' ? activeId.value : null
    if (asked === null) return
    const epoch = ownForestEpoch
    const current = () =>
      epoch === ownForestEpoch &&
      surface.value === 'conversation' &&
      mainTab.value === 'graph' &&
      activeId.value === asked
    if (ownForestFor.value !== asked) ownForest.value = null
    ownForestFor.value = asked
    ownForestPending.value = true
    ownForestError.value = null
    let received = false
    const complete = await readForestPages(
      store,
      { is: 'the-tree-of', conversation: asked },
      current,
      (snapshot) => {
        received = true
        ownForest.value = snapshot
        castFacts.update({ forest: snapshot.forest })
      },
    )
    if (!current()) return
    ownForestPending.value = false
    if (!complete) {
      ownForestError.value = 'Could not finish reading the graph.'
      if (!received) ownForest.value = null
    }
  })
  watch([mainTab, activeId, surface], () => {
    ownForestEpoch += 1
    if (surface.value === 'conversation' && mainTab.value === 'graph') void readOwnForest()
  })

  /* ---------------------------------------------------------------------------
     508 · the work the ACTIVE conversation gave out — the drawer's Work tab
     --------------------------------------------------------------------------- */

  /**
   * 🔴 **The work this conversation handed to other agents** (508) — the Work tab's reading.
   *
   * ⛔ **Owned here for the reason every other poll on this screen is**: this component owns every
   * poll that feeds a surface it mounts — the queue, the digest, the roster and now this — keeps the
   * last good answer on a refusal, and hands the result down. ⚠️ A poller inside the drawer would
   * re-ask on every tab click, because the drawer mounts one body at a time and a person switching
   * tabs remounts the one that owns it.
   *
   * 🔴 **W4.74 · no poll any more.** A child's `work_given` and `work_replied` are written into the
   * CHILD's ledger, so the giver's own ledger never told it the work moved; ⚑ `638` announced every
   * verb's move as `work`, and D-033 a turn's too — so this list is read again on that push, on
   * arriving, and (after a read that did not answer) on the glance.
   */
  const work = ref<WorkGivenOutReading | null>(null)
  let workRead = 0
  let workReading = false
  let workClosed = false

  async function readTheWork(): Promise<void> {
    workRead += 1
    if (workReading) return

    workReading = true
    try {
      while (!workClosed && surface.value === 'conversation' && activeId.value !== null) {
        const asked = activeId.value
        const mine = workRead
        const at = Date.now()
        const answer = await store.workGivenBy(asked)
        // Wait for the actual call to settle before asking again for the latest demand.
        if (mine !== workRead) continue
        if (workClosed || surface.value !== 'conversation' || asked !== activeId.value) return
        work.value =
          answer !== null
            ? { conversation: asked, walk: answer, answered: true, at }
            : work.value?.conversation === asked
              ? { ...work.value, answered: false }
              : null
        return
      }
    } finally {
      workReading = false
    }
  }

  watch([activeId, surface], () => void readTheWork())

  /* ---------------------------------------------------------------------------
     547 · who called whom — the conversations around the one on screen
     --------------------------------------------------------------------------- */

  /**
   * 🔴 **The band on the first drawer tab** (547, over `543`'s aggregate read).
   *
   * ⛔ **Owned here for the reason every other poll on this screen is**: this component owns every
   * poll that feeds a surface it mounts, keeps the last good answer on a refusal, and hands the
   * result on. ⚠️ **What is different is only how it travels.** `ConversationPane.vue` is the one hop
   * between here and `SessionDrawer`, and `547` §1.1 puts that file out of bounds while `545` is in
   * flight on it — so the answer goes into a window-level ref instead of down three props. ⚑ **547
   * F5**: the poll did not move, the wire did.
   *
   * 🔴 **W4.74 · pushed whole, polled no more.** `534`'s `runtime:changed` announces the session-row
   * write that creates a child, and the `conversations` arm re-reads on it; ⚑ the WORK half is
   * announced as `work` — every verb since `638`, and a turn's move since D-033 — and re-read on it.
   * What no push carries (what each agent is doing at this moment, and its process's memory) is the
   * glance's ({@link glance}).
   */
  const cast = useWhoCalledWhom()
  const castFacts = screenFacts()
  /** ⛔ **Which read is the newest, because the conversation id alone cannot say** — `workRead`'s. */
  let castRead = 0

  /**
   * ⚠️ **Gated on a conversation being on screen**, exactly as {@link readTheWork} is: this read opens
   * one ledger per conversation the work went to, and a tick nothing paints is pure cost.
   */
  async function readTheCast(): Promise<void> {
    void readProcessMemory()
    const asked = surface.value === 'conversation' ? activeId.value : null
    if (asked === null) return
    castRead += 1
    const mine = castRead
    castFacts.update({ loadingFor: asked })
    const answerPending = store.whoCalledWhom(asked)
    const doingPending = store.whatIsBeingDone()
    const answer = await answerPending
    if (mine !== castRead || asked !== activeId.value) return
    castFacts.update({ loadingFor: null })
    if (answer !== null) {
      // ⛔ **No `at` of this window's own.** `543` stamps `readAt` LAST over one synchronous aggregate
      // — the completion point `540` MI-19 said a single timestamp depended on — so a second instant
      // taken here would be a clock the band would have to choose between. ⚑ It also means a kept
      // last-good answer keeps its OWN timestamp, which is `547` §3.3's requirement for free.
      castFacts.update({
        reading: { conversation: asked, read: answer, answered: true, atWork: null },
      })
    } else {
      // A failed refresh keeps this conversation's last cards, without old activity words.
      castFacts.update({
        reading:
          cast.reading.value?.conversation === asked
            ? { ...cast.reading.value, answered: false, atWork: null }
            : null,
      })
    }
    const doing = await doingPending
    if (mine !== castRead || asked !== activeId.value) return
    const reading = cast.reading.value
    if (reading?.conversation === asked && reading.answered) {
      castFacts.update({ reading: { ...reading, atWork: doing } })
    }
  }
  /**
   * A burst of pushes reads the band once more after the read in flight, not once per push. Opening
   * a conversation calls {@link readTheCast} itself, so a switch never waits behind a slow read.
   */
  const rereadTheCast = oneReadAtATime(readTheCast)

  // ⚑ **Opening a conversation re-reads immediately** — a band just opened is read, never one left
  // from before; every move after that is pushed (W4.74).
  watch(activeId, () => void readTheCast())
  watch(surface, () => void readTheCast())

  /**
   * 🔴 **D-018 · the memory each running conversation's process holds, for the agent cards** —
   * asked with the band ({@link readTheCast}), so it moves when the band does: opening a
   * conversation, its tick, a start or a stop (`conversations`), and the work moving. ⚑ Main shares
   * one read between askers, so a later ask never gets an older answer; the counter is for this
   * screen going, which retires every ask still out.
   *
   * ⛔ **A read that did not answer draws no figure**: a figure is a live process's, and a kept one
   * could belong to a process that has since stopped. ⚠️ **Not in the band's `Promise.all`**: the
   * figure is no part of the band's one moment, and awaiting it would hold the cards for a `ps`.
   */
  let memoryRead = 0
  async function readProcessMemory(): Promise<void> {
    const mine = ++memoryRead
    const held = await store.processMemory()
    // A read that lands after this screen has gone belongs to no screen.
    if (mine !== memoryRead) return
    castFacts.update({
      processMemory: new Map(
        (held?.conversations ?? []).map((one) => [one.conversation, one.bytes]),
      ),
      memoryUnmeasured: held?.unmeasured ?? null,
    })
  }

  /**
   * 🔴 **W4.74 · the one glance left on a clock — at what no push carries.** ⚑ Every move of a piece
   * is pushed (`work`, D-033), so nothing here re-reads the work. Two facts move with no push at all:
   * what each agent is doing at this moment (its tool, its phase — `whatIsBeingDone`, which reads no
   * store) and the memory each conversation's process holds (`processMemory`, one shared listing).
   *
   * Memory is visible in the title bar on every page. The existing visible-window glance refreshes
   * it there too; graph and conversation activity remain scoped to the page drawing them.
   *
   * ⚑ **And a read that did not answer is asked again here** — the clock was the only retry the
   * work's readers had, and a quiet workspace may push nothing for a long time.
   */
  let glancing: ReturnType<typeof setInterval> | null = null
  /** ⛔ Which glance is the newest — a read that lands after a newer one is history (`workRead`'s). */
  let glanceRead = 0
  async function glance(): Promise<void> {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    glanceRead += 1
    const mine = glanceRead
    void readProcessMemory()
    if (surface.value === 'team') {
      // Rolling windows and their counts advance together on the existing visible-page glance.
      void readWhoIsWorking()
      return
    }
    const asked = surface.value === 'conversation' ? activeId.value : null
    if (asked === null) return
    // ⚑ Rows kept after a read that did not answer are asked again, whole.
    if (work.value?.conversation === asked && !work.value.answered) void readTheWork()
    if (cast.reading.value?.conversation === asked && !cast.reading.value.answered) {
      void readTheCast()
      return
    }
    const doing = await store.whatIsBeingDone()
    // ⚑ The doing words refine the band's last reading, of this conversation only; ⛔ a refusal drops
    // them rather than keep a tool name from a minute ago (`632`, {@link readTheCast}).
    const reading = cast.reading.value
    if (mine !== glanceRead || asked !== activeId.value) return
    if (reading === null || reading.conversation !== asked) return
    castFacts.update({ reading: { ...reading, atWork: reading.answered ? doing : null } })
  }

  /** ⚑ This window coming back to the front glances at once, rather than at the next tick. */
  function glanceOnReturn(): void {
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      void glance()
      // ⚑ And the programs, so one updated in a terminal is what the new-conversation form says.
      void readPrograms()
    }
  }

  /**
   * 🔴 **UI-002 · the files kept, for the Files tab and the agent card** — D-026's one door, asked in
   * two scopes in one worker snapshot: the tree of the conversation on screen, and what it added itself —
   * the selected agent's, whose card the right panel shows (UI-006).
   *
   * ⚑ **Asked when the conversation or the surface moves, the moment the states channel
   * says a file was kept (D-026 R3), and when the work moves** — a retitle changes the title each row
   * stands under and keeps no file. ⚑ Once on mount too, for a screen that remounts on a
   * conversation (HMR with a surviving store), whose watches then have nothing to fire on. ⛔ No
   * poll: every kept file is told — ⚑ and a re-read is the whole union the channel's note asks for,
   * with no guess about which scope a new row belongs to.
   *
   * ⚑ **One read in flight per window** ({@link oneReadAtATime}): a push while one is out is answered
   * by one more read when it settles, so pushes never queue reads.
   */
  let filesClosed = false
  async function readTheFilesOnce(): Promise<void> {
    const asked = surface.value === 'conversation' ? activeId.value : null
    if (asked === null || filesClosed) return
    let tree: readonly KeptFile[] | null = null
    let added: readonly KeptFile[] | null = null
    try {
      const answer = await runtime().filesKept({
        scope: 'tree',
        conversation: asked,
        withAdded: true,
      })
      if (answer.ok) {
        tree = answer.files
        added = answer.added ?? null
      }
    } catch {
      // A failed read keeps the previous lists and allows the next refresh to retry.
    }
    if (filesClosed || surface.value !== 'conversation' || asked !== activeId.value) return
    castFacts.update({
      treeFiles: filesReadFor(asked, tree, cast.treeFiles.value),
      cardFiles: filesReadFor(asked, added, cast.cardFiles.value),
    })
  }
  const readTheFiles = oneReadAtATime(readTheFilesOnce)

  watch([activeId, surface], () => void readTheFiles())

  /**
   * ⚑ **D-017b · a recorded conversation is held only while it is on screen** — the list names every
   * conversation, and the store keeps a page of one only for the view drawing it. ⚑ So a person
   * leaving one lets it go ({@link SessionStore.forget}), and a live one that stops while it is not on
   * screen is let go too. ⛔ `forget` keeps anything live; one being handed over, or with a command
   * out, is let go once that settles, unless it is on screen again by then ({@link SessionStore.keep}).
   */
  watch(onScreenNow, (now, was) => {
    if (was !== null) store.forget(was)
    if (now !== null) store.keep(now)
  })
  watch(
    () => store.live.value.map((record) => record.sessionId),
    (now, before) => {
      for (const sessionId of before ?? []) {
        if (!now.includes(sessionId) && sessionId !== onScreenNow.value) store.forget(sessionId)
      }
    },
  )

  /**
   * ⚑ **D-017b · the recorded conversation on screen moved** — its row's last activity is not the one
   * its view was drawn at, or another window took it or let it go — so it is looked at again: a fresh
   * page, and the host's word on whether a message from here continues it. ⛔ **Asked of THIS
   * conversation's row only** (a start or a stop of any other moves the same announcement), and never
   * a take: a look that is not a press takes nothing.
   *
   * ⚠️ **A claim and a release write no row** — the host moves only the owner — so the last activity
   * alone would leave a view drawn while another window held it saying so after that window let go
   * (or claiming it free after another window took it). ⚑ The row's own *open in another window* is
   * compared with what the view was told, and a difference is a move.
   */
  /** The conversations the host's list named at its last answer, `null` before it first answered. */
  let listedLastTime: ReadonlySet<string> | null = null

  function lookAgainIfItMoved(): void {
    const sessionId = onScreenNow.value
    const listedNow = rail.value?.theOneList?.map((row) => row.sessionId) ?? null
    const before = listedLastTime
    if (listedNow !== null) listedLastTime = new Set(listedNow)
    // Archived or deleted from another window, or by an agent: the view reacts as to its own press,
    // and the words typed here wait for it, since an archive keeps them.
    const left = leftTheListsFromElsewhere(
      sessionId,
      before,
      listedNow,
      store.live.value.map((record) => record.sessionId),
    )
    if (left !== null) {
      archivedHere([left])
      return
    }
    if (sessionId === null) return
    const record = store.get(sessionId)
    if (record?.phase !== 'recorded' || record.meta === null) return
    const listed = rail.value?.listedOf(sessionId) ?? null
    if (listed === null) return
    const toldItWasElsewhere = record.meta.cannotTakeAMessage === HELD_ELSEWHERE
    if (
      listed.updatedAt === record.meta.liveness.since &&
      listed.inAnotherWindow === toldItWasElsewhere
    ) {
      return
    }
    void store.look(sessionId, 'again')
  }

  /**
   * ⚑ **D-017b · the one state the host says of the conversation on screen** — its row in the one
   * list — which a view drawn from its ledger draws on its plate, so the view and its row say one
   * thing (the row draws the same state). ⚑ `null` while the list has not named it.
   */
  const listedStateOfActive = computed(() =>
    active.value === null ? null : (rail.value?.listedOf(active.value.sessionId)?.state ?? null),
  )
  const listedNamedOfActive = computed(() =>
    active.value === null ? null : (rail.value?.listedOf(active.value.sessionId)?.named ?? null),
  )

  const selectedForIdentity = computed(() =>
    surface.value === 'conversation' && active.value?.meta ? active.value : null,
  )
  const conversationIdentity = ref<ConversationIdentity | null>(null)
  const workRevision = ref(0)
  const agentIdentityRevision = ref(0)
  const personIdentityRevision = ref(0)
  const readTitleHistory: TitleHistorySource['read'] = (input) =>
    appClosing.value ? Promise.resolve(null) : runtime().readConversationTitleHistory(input)
  const readTaskPage: TaskPageSource['read'] = (input) =>
    appClosing.value
      ? Promise.resolve({ ok: false, reason: 'unknown-conversation' })
      : runtime().readConversationTasks(input)
  const readAllTasks: NonNullable<TaskPageSource['readAll']> = (input) =>
    appClosing.value
      ? Promise.resolve({ ok: false, reason: 'unknown-conversation' })
      : runtime().readAllConversationTasks(input)
  const setRules: NonNullable<TaskPageSource['setRules']> = (input) =>
    appClosing.value
      ? Promise.resolve({ ok: false, reason: 'The app is closing.' })
      : runtime().setCurrentRules(input)
  let identityRead = 0
  let identitySelection = 0

  async function readSelectedIdentity(): Promise<void> {
    const selected = selectedForIdentity.value
    const reading = ++identityRead
    if (selected === null || appClosing.value) return
    const sessionId = selected.sessionId
    try {
      const identity = await runtime().readConversationIdentity({ sessionId })
      if (reading !== identityRead || selected !== selectedForIdentity.value) return
      if (identity === null || identity.conversation === sessionId)
        conversationIdentity.value = identity
    } catch {
      // Keep the last reading for this selection when the host cannot answer.
    }
  }
  /**
   * Every retitle is announced only as `work`, so pushes keep reading the title, one read in flight
   * and one owed. A new selection and a rename read it directly.
   */
  const rereadSelectedIdentity = oneReadAtATime(readSelectedIdentity)

  watch(
    selectedForIdentity,
    () => {
      identitySelection += 1
      conversationIdentity.value = null
      void readSelectedIdentity()
    },
    { immediate: true, flush: 'sync' },
  )

  async function renameConversation(input: ConversationRenameInput) {
    const selection = identitySelection
    const renamed = await runtime().renameConversation(input)
    if (renamed.ok && selectedForIdentity.value?.sessionId === renamed.conversation) {
      if (selection === identitySelection) conversationIdentity.value = renamed
      // Re-read after the reply so a concurrent work notice cannot leave an older title visible.
      void readSelectedIdentity()
    }
    return renamed
  }

  // Arriving at Recent activity or Waiting on you reads again at once, so neither shows a reading up
  // to a tick old.
  watch(surface, (now) => {
    if (now === 'away' || now === 'waiting') void readActivity()
  })

  /**
   * 🔴 **534 · what the host says MOVED, told rather than asked** — one of the two things on this
   * screen that are, with {@link stopHearingStates}.
   *
   * ⛔ **Every other reader below is a poll or a re-read after a gesture this window made**, which is
   * why a conversation an agent spawned reached no list at all. `whenTheWorldMoves` holds the rules —
   * drop a subject we do not know, ask nothing during a quit, and a reader per subject by TYPE — and
   * this is the wiring, kept here because this component owns the two surfaces that draw the answers.
   *
   * The rail and Library refresh the conversation data each displays.
   */
  let stopListening: (() => void) | null = null
  let stopProviderFacts: (() => void) | null = null
  /**
   * 🔴 **D-019 · what each agent is doing, told the moment it moves** — `runtime:states`, which
   * carries the answer where `runtime:changed` carries none: handed to the rail
   * (`SideRail.hearStates`), whose one list every surface draws the host's state from — its rows,
   * the cards under the strip (`cast.railSays`), the palette, the Team shelf and the plate of a view
   * drawn from its ledger. ⛔ So nothing re-reads the list to learn a state: not the waits reading,
   * not the band's tick. ⚑ Wired here beside {@link stopListening}, because this component owns what
   * main tells the window. ⚑ **D-026 · the channel carries the files kept too**: the rail folds only
   * the states, and a message that kept a file reads the files again ({@link readTheFiles}, UI-002).
   */
  let stopHearingStates: (() => void) | null = null
  let stopHearingIdentityEvents: (() => void) | null = null
  onMounted(() => {
    const hearProviders = runtime().onProvidersChanged
    if (typeof hearProviders === 'function')
      stopProviderFacts = hearProviders((message) => {
        if (message.what === 'login' || message.what === 'key')
          authChangedFor(DEFAULT_PROFILE_ID, message.provider)
      })
    stopHearingIdentityEvents = runtime().onEvent((message) => {
      if (message.event.type !== 'user_turn' || firstHumanMessageOf(message.event) === null) return
      if (selectedForIdentity.value?.sessionId === message.sessionId) void rereadSelectedIdentity()
      personIdentityRevision.value += 1
    })
    stopHearingStates = listenProviderStates(runtime(), store, (message) => {
      rail.value?.hearStates(message)
      teamProfileGraph.markStale()
      void readWhoIsWorking()
      // ⚑ **UI-002 · a file kept anywhere is read again at once** — see {@link readTheFiles}.
      if (message.kept.length > 0) {
        filesLibrary.markStale()
        void readTheFiles()
      }
    })
    // ⚑ **UI-002 · the files' first read** — they have no tick, so a screen that remounts on a
    // conversation already open reads them itself ({@link readTheFiles}); on the launcher it asks nothing.
    void readTheFiles()
    stopListening = whenTheWorldMoves((listener) => runtime().onChanged(listener), {
      conversations: () => {
        teamProfileGraph.markStale()
        filesLibrary.markStale()
        void rail.value?.refreshResumable().then(lookAgainIfItMoved)
        void library.value?.reread()
        // 🔴 **547 · and the band on the drawer's first tab**, which draws the SPAWN half of that
        // same announcement. ⛔ **`543` §5.3 measured that this is the half a push can carry**: a
        // child appears when a `provider_session` row is written, and `attachHeldSession` announces
        // inside the block that writes it. ⚑ **638 · and the WORK half
        // announces now too** — see the `work` arm below. ⛔ This sentence said *the WORK half
        // announces nothing and keeps the tick, which is why no third subject was added (`534`'s own
        // rule: do not add a subject nothing reads)*, and `631`'s two task lists are the reader that
        // rule was waiting for.
        void rereadTheCast()
        void readOwnForest()
        // Refresh the Team forest when a conversation opens, ends or is spawned, rather than waiting for arrival or its periodic tick. `readWhoIsWorking` runs only while the page is visible.
        void readWhoIsWorking()
        // 🔴 **571 · and the rail's live signal**, whose `open` half is a count of conversations that
        // are not over — which is the exact fact this subject announces. ⛔ **The `needsYou` half
        // announces nothing and keeps the tick.** ⚠️ **638 · the REASON changed and the fact did
        // not**: a third subject exists now, and `needsYou` is not it — that half is a person's
        // queue, whose writers `638` did not survey, so giving it this arm would be a subject
        // claiming a population nobody measured (`534`'s own rule, and `567` §5's reading of it).
        void readTheWorkspace()
        // ⚑ **And the person's queue**, which reads who holds each conversation and what is archived:
        // on the tick's terms, so a notice leaves the limits walk on its own cadence.
        lookAfterAQueueNotice()
      },
      // 🔴 **638 · the work moved somewhere in this app** — see {@link RUNTIME_CHANGE_SUBJECTS}.
      // ⛔ **The SAME reader the `conversations` arm calls**, deliberately: `631`'s two task lists and
      // `632`'s child rows are one `Promise.all` inside {@link readTheCast}, so one arm serves both
      // and there is no second cadence to disagree with the first (`631` §2.1).
      // ⚠️ **No conversation id is carried and none could be**: a task's state is composed from other
      // conversations' ledgers, so the reader asks the question it already asks and gets the whole
      // answer — which is this channel's contract rather than an economy.
      work: () => {
        void rereadSelectedIdentity()
        workRevision.value += 1
        teamProfileGraph.markStale()
        filesLibrary.markStale()
        void rereadTheCast()
        void readOwnForest()
        // ⚑ **D-016 · commit 7 · R2 — and the rail's list, for the work that names each
        // conversation**, which a give, a reply, a take-back, a close or a retitle moves and nothing
        // pushes. ⛔ Not for what each agent is doing, which arrives on its own
        // ({@link stopHearingStates}).
        void rail.value?.refreshResumable()
        // 🔴 **668 · the forest draws every task too** — the same reason as the `conversations` arm.
        void readWhoIsWorking()
        // 🔴 **638 · and the drawer's Work tab, which is the OTHER surface in this file drawing a
        // task's state** — `508`'s list, fed by {@link readTheWork}. ⛔ Its own docblock said *"a
        // poll, because nothing pushes… the conversation that gave the work is told nothing at all
        // when the work moves"*, and after this dispatch that is false. ⚠️ **Without this line the
        // band would update instantly while the tab beside it kept the old word for 30 s** — two
        // surfaces, one screen, two answers, which is the `631` §2.1 defect this arm exists to
        // prevent, arriving one tab over.
        void readTheWork()
        // ⚑ **UI-002 · and the files**, whose rows say the title each piece stands under NOW — a
        // retitle moves it and keeps no file, so no kept push carries it.
        void readTheFiles()
      },
      // ⚑ **`agentStore.load()` through {@link refreshAgents}**, so the launch path's retired call
      // and this one are the same function rather than two readers of one store.
      // ⚑ **UI-012 · and the model lists** — a last pick, a default or a hand-added model moved.
      agents: () => {
        void rereadSelectedIdentity()
        agentIdentityRevision.value += 1
        teamProfileGraph.markStale()
        filesLibrary.markStale()
        refreshAgents()
        void modelLists.reread()
        // ⚑ **And the person's queue**, which names whoever asks and whoever is asked: on the tick's
        // terms, like the arm above.
        lookAfterAQueueNotice()
      },
      // ⚑ **What a person must answer may have moved**: the queue and the rail's needs-you count are
      // read again, each through its one-at-a-time read, so a burst costs at most one more look. The
      // queue is asked on the tick's terms, and the five-second look stays until this arm is proven.
      persons: () => {
        lookAfterAQueueNotice()
        void readTheWorkspace()
      },
    })
    stopHearingLimits = runtime().onLimitsDisplayChanged((message) => {
      limitsLane.changed(message)
      if (message.why === 'scope') void refreshLimitsDisplay()
    })
    void lookForWhatIsYours()
    // ⚑ **571 · the rail's live signal reads on the SAME first pass and the SAME tick** — see
    // {@link readTheWorkspace} for why it rides this cadence rather than getting one of its own.
    void readTheWorkspace()
    // ⚑ **636 · and the three waits, on the same first pass and the same tick**, for the reason one
    // line up — see {@link readWhatIsWaiting}.
    void readWhatIsWaiting()
    looking = setInterval(() => {
      void lookForWhatIsYours(true)
      void readTheWorkspace()
      void readWhatIsWaiting()
    }, LOOK_EVERY_MS)
    void readProcessMemory()
    void readActivity()
    readingActivity = setInterval(() => void readActivity(), ACTIVITY_READ_EVERY_MS)
    // 🔴 **W4.74 · D-033 · no re-read of the work on a clock.** The Team page's forest, the band and
    // the Work tab used to re-read every half minute (`593`, `547`, `508`); every move of a piece now
    // arrives as `work` (a turn's too, since D-033), and each is read again on it, on `conversations`,
    // and on arriving. ⚑ What no push carries — what each agent is doing at this moment, and the
    // memory its process holds — is glanced at instead, and only while a person can see it.
    glancing = setInterval(() => void glance(), ROSTER_EVERY_MS)
    window.addEventListener('focus', glanceOnReturn)
    document.addEventListener('visibilitychange', glanceOnReturn)
    // 🔴 **The press, supplied rather than re-implemented** — `goToTheWork` is `506`'s door, which
    // claims the conversation when this window does not hold it and selects only after the claim has
    // landed (rule 18). ⛔ While this is null the band draws no press at all, which is what a drawer
    // mounted with no screen above it gets.
    castFacts.update({
      goTo: (conversation) => void goToTheWork(conversation),
      compact: (conversation) => store.compact(conversation),
      pickModel: async (conversation, pick) => {
        try {
          await pickInAConversation(store, conversation, pick, 'throw')
          return null
        } catch (cause) {
          return readableError(cause)
        }
      },
    })
  })
  onUnmounted(() => {
    // ⛔ **534 · unsubscribed like every interval below.** The preload holds the listener on
    // `ipcRenderer`, which outlives this component under HMR, so a screen that did not let go would
    // leave a second listener re-reading through a store the new one has replaced.
    stopListening?.()
    stopProviderFacts?.()
    stopProviderFacts = null
    invalidatePrograms()
    closeActionableReads()
    limitsLane.close()
    stopHearingLimits?.()
    stopHearingLimits = null
    stopListening = null
    stopHearingStates?.()
    stopHearingStates = null
    stopHearingIdentityEvents?.()
    stopHearingIdentityEvents = null
    if (looking !== null) clearInterval(looking)
    if (readingActivity !== null) clearInterval(readingActivity)
    if (glancing !== null) clearInterval(glancing)
    window.removeEventListener('focus', glanceOnReturn)
    document.removeEventListener('visibilitychange', glanceOnReturn)
    // Every read still out belongs to this screen, so none of them may write once it has gone.
    castRead++
    forestEpoch++
    ownForestEpoch++
    memoryRead++
    filesClosed = true
    glanceRead++
    workClosed = true
    // ⛔ **Handed back, because the refs outlive this component under HMR**: the press, the rail's
    // rows, the process figures and the files, so no band draws a replaced screen's read or presses
    // into it.
    castFacts.release()
    // ⚠️ **Back to *nobody has answered*, not to *nothing is waiting*.** The module is a singleton
    // that outlives this component under HMR, and a stale list of rows pointing at conversations a
    // new store has never heard of is worse than no list.
    persons.forget()
  })

  return {
    activityWindowMs,
    chooseActivityWindow,
    activityReading,
    sinceLastHere,
    beingDone,
    forestWindow,
    theForest,
    forestPending,
    forestError,
    theForestView,
    ownForestPending,
    ownForestError,
    readConversationForest,
    chooseForestWindow,
    readOwnForest,
    work,
    castFacts,
    readTheCast,
    listedStateOfActive,
    listedNamedOfActive,
    conversationIdentity,
    workRevision,
    agentIdentityRevision,
    personIdentityRevision,
    readTitleHistory,
    readTaskPage,
    readAllTasks,
    setRules,
    renameConversation,
  }
}
