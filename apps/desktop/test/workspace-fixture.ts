import { shallowRef, type App } from 'vue'
import {
  createWorkspace,
  provideWorkspaceTo,
  type Workspace,
} from '../src/renderer/src/composables/useWorkspace'
import { provideConversationDoorTo } from '../src/renderer/src/composables/useConversationDoor'
import type { FilesRead } from '../src/renderer/src/lib/files-kept'
import type { CastReading } from '../src/renderer/src/lib/working-together'
import type { RailSays } from '../src/renderer/src/lib/agent-state'
import type { AgentState } from '../src/shared/agent-state'
import type { Provider } from '@brobot2/shared'
import type {
  AgentIdentity,
  ProcessMemory,
  ResumableSessionInfo,
  UnresumableSessionInfo,
} from '../src/shared/runtime-ipc'
import type { WhatEachConversationIsWaitingOn } from '../src/shared/tasks'
import type { TheWholeForest } from '../src/shared/the-whole-forest'

/**
 * The window's workspace projection as a test hands it what the bridge would have said: each
 * setter goes through the projection's own ingestion, so a surface under test reads exactly what
 * it reads in the app. Every app a test mounts is given this one projection (and the screen, when
 * mounted, adopts it), so a test sets what a surface reads before or after mounting it.
 */

let instance: Workspace | null = null

/** The projection every test app is given, reading the test's rail words and roster. */
export function testWorkspace(): Workspace {
  if (instance === null) {
    instance = createWorkspace()
    wireTheTest(instance)
  }
  return instance
}

/** The door a test's surfaces press through; `null` draws no press. */
const door = shallowRef<((conversation: string) => void) | null>(null)

/** Gives a test app the test projection, and the test's door. */
export function withTestWorkspace(app: App): void {
  provideWorkspaceTo(app, testWorkspace())
  provideConversationDoorTo(app, door)
}

const railSays = shallowRef<ReadonlyMap<string, RailSays> | null>(null)
const identities = shallowRef<readonly AgentIdentity[] | null>(null)
let unwire: (() => void) | null = null

/** Lends the projection the test's rail words and roster, as a rail on screen would. */
function wireTheTest(workspace: Workspace): void {
  unwire?.()
  unwire = workspace.wire({
    railSays: () => railSays.value,
    identities: () => identities.value,
  })
}

const wired = testWorkspace

export const heldWorkspace = {
  /** What the rail says of each conversation, as a rail on screen would. */
  railSays,
  /** The roster the list names each conversation by. */
  identities,
  /** The screen's door into a conversation, as a test supplies it. */
  door,
  /** The band's reading, as the screen's read would hand it. */
  cast(reading: CastReading | null): void {
    wired().castRead(reading)
  },
  /** A band read in flight for `conversation`, or none. */
  castLoading(conversation: string | null): void {
    wired().castAsked(conversation)
  },
  /** The files kept in the tree, and those the card's agent added. */
  files(tree: FilesRead | null, card: FilesRead | null = testWorkspace().cardFiles()): void {
    wired().filesRead(tree, card)
  },
  /** The files the card's agent added. */
  cardFiles(card: FilesRead | null): void {
    wired().filesRead(testWorkspace().treeFiles(), card)
  },
  /** One list read that answered with these rows. */
  list(
    resumable: readonly ResumableSessionInfo[],
    unresumable: readonly UnresumableSessionInfo[] = [],
  ): void {
    const workspace = wired()
    workspace.listAnswered(workspace.listAsked(), resumable, unresumable)
  },
  /** A list read naming exactly these running conversations, each in its state. */
  running(rows: readonly { sessionId: string; provider: Provider; state: AgentState }[]): void {
    heldWorkspace.list(
      rows.map(
        ({ sessionId, provider, state }, index) =>
          ({
            sessionId,
            provider,
            state,
            running: 'unwatched',
            cwd: '/fictional',
            status: 'idle',
            named: null,
            approvalMode: 'ask',
            profileId: null,
            reasoningEffort: null,
            model: null,
            planMode: null,
            adoptedAt: null,
            hasTranscript: true,
            child: null,
            lastEnding: 'completed',
            ref: { provider, sessionId: `thread-${sessionId}`, cwd: '/fictional', rotation: 0 },
            resumeRefusal: null,
            updatedAt: 1_800_000_000_000 - index,
          }) as ResumableSessionInfo,
      ),
    )
  },
  forest(forest: TheWholeForest): void {
    wired().forestRead(forest)
  },
  waits(reading: WhatEachConversationIsWaitingOn): void {
    wired().waitsRead(reading)
  },
  /** Process figures by conversation, or the sentence of a read that could measure none. */
  memory(bytes: ReadonlyMap<string, number>, unmeasured?: string): void {
    const held: ProcessMemory = {
      conversations: [...bytes].map(([conversation, figure]) => ({ conversation, bytes: figure })),
      ...(unmeasured === undefined ? {} : { unmeasured }),
    }
    wired().memoryRead(held)
  },
  /** Back to nobody has looked, with the test's inputs lent again. */
  reset(): void {
    testWorkspace().reset()
    door.value = null
    railSays.value = null
    identities.value = null
    // A rail mounted in the test took these back when it went; lend them again.
    wireTheTest(testWorkspace())
  },
}
