import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { AgentIdentities } from '../../../shared/runtime-ipc'

/**
 * 🔴 **The window's ONE emergency stop for new spawns — the state, its words, and its gesture**
 * (390, from `388` §3).
 *
 * ## ⛔ Why this is a module and not two components that happen to agree
 *
 * `385 §3` anchored the kill switch so a long rail could not carry it off the bottom of the screen,
 * and that fix is real. ⚠️ **It is not the whole invariant.** `388` measured `529649c` and found the
 * half nothing was watching: every `OverlayHost` is a fixed `inset: 0` `aria-modal` layer with a
 * focus trap, **it deliberately covers the rail**, and `rail-spawning` sits underneath it — so the
 * one control that stops agents creating conversations could not be clicked or tabbed to while any
 * modal was open. ⛔ **A person reaches for an emergency stop at the worst moment, not at a
 * convenient one**, and a control that is only available when nothing else is happening is not an
 * emergency control.
 *
 * ⚑ **So the same action is drawn twice — in the rail, and in the overlay layer — and this file is
 * what makes "twice" safe.** Both surfaces read {@link SpawnSafety.view}: one state, one confirm
 * flag, one derivation of every word. ⛔ **There is no state a person can reach where the rail says
 * one thing and the overlay says another**, because there is only one thing to say.
 *
 * ⚠️ **The alternative shape — a copy of the control pasted into each sheet's own header, which is
 * where `v2.5`'s standalone puts it — was rejected for the reason this project already writes down**
 * (HO-013 §3, at the head of the standing rules): *"a rule that must be remembered each time is a
 * rule that will eventually be forgotten."* `OverlayHost` is mounted across the renderer with
 * multiple panels behind it; the next independently wired panel would ship without the stop and
 * nothing would notice. Hosted once,
 * an overlay added tomorrow carries the safety lane because it was hosted, not because somebody
 * remembered. ⚑ **The mock reaches the same place by the same route** — its one `<dialog>` renders
 * `stopControls(true)` into `#sheet-safety` for every sheet, under the comment *"the safety control
 * is pinned in every sheet."*
 *
 * ## ⚠️ It is SUPPLIED, and never read from the bridge here
 *
 * ⛔ **`RuntimeScreen` supplies it** from the one `useAgentStore()` this window has, and it is the
 * same value it hands the rail's identities section — so this is a conduit for a fact, not a second
 * reader of it. A module that called `useAgentStore()` itself would put `window.api.runtime` on the
 * import graph of `OverlayHost`, which is mounted throughout the renderer and directly by tests that
 * have no bridge at all.
 *
 * ⚑ **Nothing is supplied until a screen supplies it**, which is why {@link spawnSafetyView} answers
 * `null` rather than *off*: `086`'s rule, on the one control where the wrong default is dangerous in
 * both directions. A stop drawn *on* before the read lands claims agents may spawn when nobody
 * knows; drawn *off* it claims a stop that is not in force.
 */

/**
 * What both surfaces draw. ⛔ **Every string a person reads about the switch is on this object** —
 * a surface that composed its own sentence would be the second derivation this file exists to
 * prevent.
 */
export interface SpawnSafetyView {
  /** Whether spawning is on RIGHT NOW, as the database last reported it. */
  readonly on: boolean
  /** Whether a press has armed the confirm that turning it back ON requires. */
  readonly confirming: boolean
  /** The strong line: what the switch is, or what the next press would do. */
  readonly heading: string
  /** The quiet line under it, including what the switch does NOT do. */
  readonly line: string
}

/**
 * 🔴 **The one derivation of the switch's words** — pure, so both surfaces and a test can ask it the
 * same question without a component around it.
 *
 * ⚠️ **`null` is *nobody has answered yet*, and it is not `off`.** `355` put a `v-if` on the rail's
 * row for this and `385 §3` kept it through the move to the anchored end; the overlay lane inherits
 * it here rather than restating it.
 */
export function spawnSafetyView(
  identities: AgentIdentities | null,
  confirming: boolean,
): SpawnSafetyView | null {
  if (identities === null) return null
  const on = identities.spawningEnabled
  return {
    on,
    confirming,
    heading: confirming
      ? 'Allow agents to start new conversations?'
      : on
        ? 'Agents can start new conversations'
        : 'Agents cannot start new conversations',
    // ⚑ **D-016 · ruling 12** — the switch refuses only a give that would START a conversation; work
    // still goes to a conversation an agent already has, so the words name the start and nothing else.
    line: confirming
      ? 'Click again to allow.'
      : on
        ? 'Click to prevent new conversations. Current work will continue.'
        : 'Current work can continue. Click to allow new conversations.',
  }
}

export interface SpawnSafety {
  /** What to draw, or `null` while nobody has answered. */
  readonly view: ComputedRef<SpawnSafetyView | null>
  /**
   * ⚑ **The one asymmetry in the kill switch** (355, and `340`'s ruling applied to a gesture) — off
   * is a press, on is a press and a press.
   *
   * ⛔ **A widening must be opt-in at the call site.** Switching spawning ON is the widening, and
   * the direction that STOPS agents creating conversations must never be the slower of the two: a
   * kill switch you have to confirm is one you confirm after the thing you were trying to stop.
   */
  press(): void
  /**
   * Hand over what the database now says, and how to write to it.
   *
   * ⚠️ **An armed confirm is disarmed whenever the switch itself moves**, so a confirm cannot be
   * left standing across a change made from somewhere else — another window, or a save this surface
   * did not make. ⛔ One press from a widening is the state that must not survive.
   */
  supply(identities: AgentIdentities | null, commit: (enabled: boolean) => void): void
  /** Put it back to *nobody has answered* — the screen's unmount, and a test's `afterEach`. */
  forget(): void
}

export function createSpawnSafety(): SpawnSafety {
  const identities: Ref<AgentIdentities | null> = ref(null)
  const confirming = ref(false)
  let commit: ((enabled: boolean) => void) | null = null

  const view = computed(() => spawnSafetyView(identities.value, confirming.value))

  return {
    view,

    press() {
      const now = view.value
      // ⛔ Nothing has answered, so there is no switch to throw — and a press that guessed would
      // write the state it was guessing.
      if (now === null) return
      if (now.on) {
        confirming.value = false
        commit?.(false)
        return
      }
      if (!confirming.value) {
        confirming.value = true
        return
      }
      confirming.value = false
      commit?.(true)
    },

    supply(next, onSet) {
      // ⚠️ **Compared BEFORE the write**, and on the switch itself rather than on the object: the
      // store replaces the whole record on every read, so an identity-list change that left the
      // switch alone would otherwise disarm a confirm a person had just armed.
      const before = identities.value?.spawningEnabled ?? null
      const after = next?.spawningEnabled ?? null
      if (after !== before) confirming.value = false
      identities.value = next
      commit = onSet
    },

    forget() {
      identities.value = null
      confirming.value = false
      commit = null
    },
  }
}

/** The window's one stop. */
const shared = createSpawnSafety()

export function useSpawnSafety(): SpawnSafety {
  return shared
}
