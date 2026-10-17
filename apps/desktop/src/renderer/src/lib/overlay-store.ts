import { ref, type Ref } from 'vue'

/**
 * Which overlay is open, and what it is about.
 *
 * One at a time, on purpose: an overlay is a question the app is asking, and two questions at once
 * is how a person ends up answering the wrong one. Opening a second replaces the first.
 *
 * A tiny module rather than props threaded through three surfaces — the triggers are deep and every
 * one of them opens the same overlay with the same payload. It is plain state with no Vue component
 * around it, so it is driven directly in a test.
 */

export type Overlay =
  /**
   * 🔴 **An agent being brought into being** (423, HO-023 §3).
   *
   * ⛔ **It carries NOTHING, and the absence is the point** — there is no identity to name yet.
   * The sheet holds its own four boxes and hands them to `AgentStore.create`, which is the one
   * place a person's `agent_identity` row comes into being.
   *
   * ⚠️ **A separate member rather than a nullable `profileSlug` on `agentCapabilities`.** That
   * overlay is an editor over rows the spawn rails read at the moment a spawn is asked for; a null
   * slug on it would make every guard in `CapabilitiesSheet` conditional — and a creation form is
   * not an editor.
   */
  | { kind: 'newAgent' }
  /**
   * 🔴 **One agent identity's capabilities, opened to be read and changed** (355).
   *
   * ⛔ **Slugs, not a snapshot.** This is an editor over rows the spawn rails read at the moment a
   * spawn is asked for; a copy taken at open time is how an editor comes to save over a change it
   * never saw. The sheet reads its own list through `useAgentStore`, which is the one place that
   * answer comes from.
   */
  | { kind: 'agentCapabilities'; profileSlug: string }
  /**
   * 🔴 **What shapes one agent, read with no conversation open** (626, `EXT-015` §1).
   *
   * ⛔ **A SLUG, for {@link agentCapabilities}' reason** — the sheet reads its own answer through
   * `useAgentStore`, and a snapshot taken at open time is how a surface comes to show rules a
   * person has since rewritten in the other door.
   *
   * ⚠️ **A separate member rather than a flag on `agentCapabilities`.** That overlay is an EDITOR
   * over the rows the spawn rails read; this one is a READING organised by whose text it is, and
   * the only thing they share is that both name an identity. ⛔ Folding them would make every
   * guard in `CapabilitiesSheet` conditional on which of two questions it was opened for — the
   * split `newAgent` argues two members up.
   */
  | { kind: 'agentSections'; profileSlug: string }
  /**
   * 🔴 **A conversation opened as one identity** (423 relay 1, HO-023 §2).
   *
   * ⛔ **A SLUG, for `agentCapabilities`' reason** — this is about the row the spawn rails and the
   * launch both read at the moment they are asked, and a snapshot taken at open time is how a
   * surface comes to start a conversation on a provider the identity has since stopped naming.
   *
   * ⚠️ **The FOLDER is not on the member.** It is what this sheet exists to ask, and carrying a
   * default here would make the overlay layer the place that answers it.
   */
  | { kind: 'startAsAgent'; profileSlug: string }
  /**
   * 🔴 **The global external MCP registry, opened to be read and changed** (516, HO-040 §4.2).
   *
   * ⛔ **It carries NOTHING, and the absence is the point** — `newAgent`'s reason above. Every
   * member that names something names one row; this surface is about the WHOLE registry, which is
   * app-wide like the spawning switch rather than about any identity. ⚑ The grants are elsewhere by
   * ruling: *"Register the server once, globally. Grant it per identity"*, so the tick-boxes live on
   * {@link agentCapabilities}' sheet and nothing here grants anybody.
   */
  | { kind: 'externalMcpServers' }
  /**
   * The confirmation before a conversation is deleted. It carries the conversation's id alone: the
   * sheet asks main what a delete would remove each time it opens.
   */
  | { kind: 'deleteConversation'; sessionId: string }

export interface Toast {
  id: number
  text: string
}

export interface OverlayStore {
  overlay: Ref<Overlay | null>
  toasts: Ref<Toast[]>
  open(overlay: Overlay): void
  close(): void
  /**
   * Say what just happened — or, for everything Slice 2 cannot do yet, what did NOT. A confirm
   * that is not wired says so here rather than pretending; nothing in this app may report work it
   * did not do.
   */
  notify(text: string): number
  dismiss(id: number): void
}

/** How long a toast stays up. Long enough to read twice, short enough not to be dismissed. */
export const TOAST_MS = 3200

export function createOverlayStore(
  schedule: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms),
): OverlayStore {
  const overlay = ref<Overlay | null>(null)
  const toasts = ref<Toast[]>([])
  let nextId = 0

  return {
    overlay,
    toasts,
    open(next) {
      overlay.value = next
    },
    close() {
      overlay.value = null
    },
    notify(text) {
      const id = ++nextId
      toasts.value = [...toasts.value, { id, text }]
      schedule(() => {
        toasts.value = toasts.value.filter((toast) => toast.id !== id)
      }, TOAST_MS)
      return id
    },
    dismiss(id) {
      toasts.value = toasts.value.filter((toast) => toast.id !== id)
    },
  }
}

/** The window's one overlay layer. */
const store = createOverlayStore()

export function useOverlays(): OverlayStore {
  return store
}
