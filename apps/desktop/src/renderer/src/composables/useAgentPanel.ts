import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { AgentState as OneState } from '../../../shared/agent-state'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
import type {
  AgentIdentity,
  CreatedSession,
  KeptFile,
  RevealResult,
  SessionPathTarget,
} from '../../../shared/runtime-ipc'
import type { AgentFacets } from '../lib/agent-state'
import { agentPanel, type AgentPanel } from '../lib/agent-panel'
import type { TranscriptState } from '../lib/transcript'
import type { CastReading } from '../lib/working-together'
import { useMinuteClock } from './useMinuteClock'
import { useWhoCalledWhom } from './useWhoCalledWhom'

/**
 * 🔴 **The agent panel's facts and acts** — see {@link agentPanel} for the facts and their contract.
 *
 * ⚑ It reads only what the right panel is already handed, plus the window's own cast channel (the
 * forest, the rail's rows, the memory listing). ⛔ It adds no read and no timer of its own (F071).
 */
export interface AgentPanelSources {
  readonly conversation: () => string | null
  readonly session: () => CreatedSession | null
  readonly state: () => TranscriptState
  readonly who: () => string
  readonly profile: () => string | null
  readonly facets: () => AgentFacets
  readonly agentState: () => OneState | null
  readonly named: () => WorkThatNamesIt | null
  readonly cast: () => CastReading | null
  readonly identities: () => readonly AgentIdentity[] | null
  readonly files: () => readonly KeptFile[] | null
  /** The screen's door to show a path in Finder — absent, Open folder is not offered. */
  readonly revealPath?: (target: SessionPathTarget) => Promise<RevealResult>
  /** Select another agent (a sub agent's card) — the right panel's own `openConversation`. */
  readonly openConversation?: (conversation: string) => void
  /** Open a kept file — the right panel's own `openDocument`. */
  readonly openDocument?: (resourceId: string) => void
  /** Go to a transcript item — the latest-words bubble. */
  readonly navigate?: (itemId: string) => void
}

export interface AgentPanelActs {
  /** The panel's facts, folded again whenever a source moves. */
  readonly panel: ComputedRef<AgentPanel>
  /** The files filter's text. */
  readonly fileFilter: Ref<string>
  /** Whether the current task's brief is shown whole ("Show more"). */
  readonly briefOpen: Ref<boolean>
  readonly tasksDialogOpen: Ref<boolean>
  readonly filesDialogOpen: Ref<boolean>
  /** ⚑ W4.208 · the Context popup, opened from the context figure. */
  readonly contextDialogOpen: Ref<boolean>
  /** What the last folder act said — a refusal or a copy that failed — or null. */
  readonly folderSaid: Ref<string | null>
  /** Copy the folder's path to the clipboard. Resolves `true` when it was copied. */
  copyPath(): Promise<boolean>
  /** Whether Open folder can be offered: there is a folder and a door to show it. */
  readonly mayOpenFolder: ComputedRef<boolean>
  /** Show the folder in Finder. */
  openFolder(): Promise<void>
  openConversation(conversation: string): void
  openFile(resourceId: string): void
  /** Open one of the panel's popups. The card calls these rather than writing its prop's refs. */
  openTasks(): void
  openFiles(): void
  openContext(): void
  /** Set the files filter's text. */
  filterFiles(text: string): void
  showLatest(): void
}

const FILE_TILES = 4

const REVEAL_SAYS: Readonly<Record<string, string>> = {
  'no-path': 'This conversation has not said where it works yet.',
  gone: 'That folder is no longer there.',
}

export function useAgentPanel(sources: AgentPanelSources): AgentPanelActs {
  const cast = useWhoCalledWhom()
  const minute = useMinuteClock()
  const fileFilter = ref('')
  const briefOpen = ref(false)
  const tasksDialogOpen = ref(false)
  const filesDialogOpen = ref(false)
  const contextDialogOpen = ref(false)
  const folderSaid = ref<string | null>(null)

  const panel = computed(() =>
    agentPanel({
      conversation: sources.conversation(),
      session: sources.session(),
      state: sources.state(),
      who: sources.who(),
      profile: sources.profile(),
      facets: sources.facets(),
      agentState: sources.agentState(),
      named: sources.named(),
      cast: sources.cast(),
      identities: sources.identities(),
      forest: cast.forest.value,
      railSays: cast.railSays.value,
      processMemory: cast.processMemory.value,
      memoryUnmeasured: cast.memoryUnmeasured.value,
      files: sources.files(),
      fileFilter: fileFilter.value,
      fileTiles: FILE_TILES,
      now: minute.value,
    }),
  )

  const mayOpenFolder = computed(
    () => sources.revealPath !== undefined && panel.value.workspace.path.value !== null,
  )

  async function copyPath(): Promise<boolean> {
    const path = panel.value.workspace.path.value
    folderSaid.value = null
    if (path === null) return false
    try {
      await navigator.clipboard.writeText(path)
      return true
    } catch {
      folderSaid.value = `Couldn’t copy it. The folder is ${path}`
      return false
    }
  }

  async function openFolder(): Promise<void> {
    folderSaid.value = null
    if (!mayOpenFolder.value || sources.revealPath === undefined) return
    try {
      const said = await sources.revealPath({ of: 'cwd' })
      if (!said.ok) folderSaid.value = REVEAL_SAYS[said.reason] ?? 'That folder could not be shown.'
    } catch {
      folderSaid.value = 'That folder could not be shown.'
    }
  }

  return {
    panel,
    fileFilter,
    briefOpen,
    tasksDialogOpen,
    filesDialogOpen,
    contextDialogOpen,
    folderSaid,
    copyPath,
    mayOpenFolder,
    openFolder,
    openConversation: (conversation) => sources.openConversation?.(conversation),
    openFile: (resourceId) => sources.openDocument?.(resourceId),
    openTasks: () => {
      tasksDialogOpen.value = true
    },
    openFiles: () => {
      filesDialogOpen.value = true
    },
    openContext: () => {
      contextDialogOpen.value = true
    },
    filterFiles: (text) => {
      fileFilter.value = text
    },
    showLatest: () => {
      const latest = panel.value.latest
      if (latest !== null) sources.navigate?.(latest.itemId)
    },
  }
}
