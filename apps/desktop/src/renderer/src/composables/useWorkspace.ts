import { inject, provide, shallowRef, type App, type InjectionKey } from 'vue'
import type { RuntimeBridge, RuntimeStatesMessage } from '../../../shared/runtime-ipc'
import { readableError } from '../lib/session-record'
import type { ProviderBlockStore } from '../lib/provider-limit-facts'
import {
  createWorkspaceProjection,
  type WorkspaceInputs,
  type WorkspaceProjection,
} from '../lib/workspace-projection'

/**
 * The window's one workspace projection: the listed conversations and their states, the waits, the
 * forest and the process figures, read from the bridge here and nowhere else.
 */
export interface Workspace extends WorkspaceProjection {
  /**
   * Reads the host's list again and takes it in. `providerBlocks` is the store the provider facts
   * of each row are kept in; `closing` says the app is quitting, when nothing is asked.
   */
  readList(providerBlocks: ProviderBlockStore, closing: boolean): Promise<void>
  /** What main pushed on `runtime:states`: the states, into the list. */
  hearStates(message: RuntimeStatesMessage): void
  /**
   * Names what the projection reads but does not own: the roster, the provider facts and the
   * rail's words. Returns what undoes it, so a surface that goes takes its inputs with it.
   */
  wire(inputs: Partial<WorkspaceInputs>): () => void
}

const WORKSPACE: InjectionKey<Workspace> = Symbol('workspace')

/** A window's workspace projection, with the list read that feeds it. */
export function createWorkspace(): Workspace {
  const wired = shallowRef<Partial<WorkspaceInputs>>({})
  const projection = createWorkspaceProjection({
    identities: () => wired.value.identities?.() ?? null,
    providerSaid: () => wired.value.providerSaid?.(),
    railSays: () => wired.value.railSays?.() ?? null,
  })
  return {
    ...projection,
    async readList(providerBlocks, closing) {
      const ticket = projection.listAsked()
      const providerReadAt = providerBlocks.beginRead()
      // Not while the app is closing: the quit ends every conversation, and a read would land on a
      // database the quit has already shut. The list stays exactly as it was.
      if (closing) return
      try {
        const bridge = (
          globalThis as {
            api?: { runtime: Pick<RuntimeBridge, 'listResumable' | 'listUnresumable'> }
          }
        ).api!.runtime
        const [resumable, unresumable] = await Promise.all([
          bridge.listResumable(),
          bridge.listUnresumable(),
        ])
        if (projection.listAnswered(ticket, resumable, unresumable))
          providerBlocks.acceptListed([...resumable, ...unresumable], providerReadAt)
      } catch (cause) {
        projection.listRefused(ticket, readableError(cause))
      }
    },
    hearStates(message) {
      projection.statesMoved(message.moved)
    },
    wire(inputs) {
      wired.value = { ...wired.value, ...inputs }
      return () => {
        const left = { ...wired.value }
        for (const key of Object.keys(inputs) as (keyof WorkspaceInputs)[]) {
          if (left[key] === inputs[key]) delete left[key]
        }
        wired.value = left
      }
    },
  }
}

/**
 * The screen that owns the window's reads provides its projection to everything it mounts. One
 * provided above it (a test's) is used instead, so the screen and the test read the same one.
 */
export function provideWorkspace(): Workspace {
  const workspace = inject(WORKSPACE, null) ?? createWorkspace()
  provide(WORKSPACE, workspace)
  return workspace
}

/** Gives a whole app one projection; for an app that mounts surfaces without the screen. */
export function provideWorkspaceTo(app: App, workspace: Workspace): void {
  app.provide(WORKSPACE, workspace)
}

/**
 * The projection the owning screen provides. A surface mounted with no screen above it (a render of
 * that surface alone) reads one of its own, in which nothing has been read.
 */
export function useWorkspace(): Workspace {
  return inject(WORKSPACE, null) ?? createWorkspace()
}
