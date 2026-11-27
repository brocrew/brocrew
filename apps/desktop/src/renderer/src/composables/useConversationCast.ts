import { computed } from 'vue'
import { useWhoCalledWhom } from './useWhoCalledWhom'
import { aGiverWaitsOnPurposeSays, ownWaitSaid } from '../lib/conversation-list'
import type { ConversationPaneProps } from '../lib/conversation-pane-props'

/**
 * What the screen's who-called-whom read says of one conversation (moved out of
 * `ConversationPane.vue` unchanged).
 */
export function useConversationCast(props: Pick<ConversationPaneProps, 'record'>) {
  /**
   * 🔴 **The one channel that is not a prop** — the screen's who-called-whom read (`547`).
   *
   * ## ⛔ Why this reaches a singleton when everything else here arrives as a prop
   *
   * ⚠️ **`547` wrote the reason down before this file could act on it.** Its brief §1.1 put
   * `ConversationPane.vue` out of bounds while `545` was inside it, and this file is the only hop
   * between `RuntimeScreen` — which owns every poll that feeds a surface it mounts — and the drawer
   * that draws the band. ⚑ So the poll stayed where the convention puts it and only the TRANSPORT
   * moved, into `useWhoCalledWhom`. **That is `547` F5, and it is still open**: the repair is a prop
   * on this component and one binding on `<SessionDrawer>`, and it needs `RuntimeScreen.vue`, which
   * `550` is in. ⛔ **Not taken here** (551 §5), and this pane and the drawer move together the day
   * it is.
   */
  const cast = useWhoCalledWhom()

  /**
   * ⚑ **UI-002 · the files on this conversation's tree**, for the Files tab — the screen's read
   * (`TheCast.treeFiles`). ⛔ `null` while the read is about another conversation, as {@link gaveOut}
   * guards: a person can open two conversations inside one round trip.
   */
  const treeFiles = computed(() => {
    const read = cast.treeFiles.value
    return read !== null && read.conversation === props.record.sessionId ? read : null
  })

  /**
   * ⚑ **The work this conversation gave out, as the cast last read it** — where a give's card in the
   * transcript finds the conversation its piece went to (`outgoing-card.ts`), since the receipt names
   * no id (D-016 · commit 7 · R1). ⛔ **`null` while the reading is about another conversation** —
   * `parentCardOf`'s guard: a person can open two conversations inside one round trip, and that
   * reading's gives are not this one's.
   */
  const gaveOut = computed(() => {
    const reading = cast.reading.value
    return reading?.conversation === props.record.sessionId ? reading.read.workGivenOut.rows : null
  })

  /** Whom this conversation waits on while a piece it gave waits on purpose, and why. */
  const waitsOnPurpose = computed(() =>
    aGiverWaitsOnPurposeSays(gaveOut.value ?? [], cast.listedConversations.value),
  )

  /** What this conversation says of its own typed wait, in the words its giver's page uses. */
  const ownWait = computed(() =>
    ownWaitSaid(
      cast.listedConversations.value?.find((row) => row.sessionId === props.record.sessionId),
    ),
  )

  /** ⚑ **UI-002 · the work this conversation was given**, by {@link gaveOut}'s guard — see `RelayedEntry`. */
  const takenIn = computed(() => {
    const reading = cast.reading.value
    return reading?.conversation === props.record.sessionId ? reading.read.workTakenIn.rows : null
  })

  /**
   * 🔴 **Take a person to a conversation** — `506`'s door, through the same ref `547`'s band presses.
   *
   * ⛔ **Nothing is reported as done here** (rule 18): `goToTheWork` claims the conversation when
   * this window does not hold it, says what the host refused in the host's own words, and selects
   * only after the claim has landed. ⚑ **UI-006 · a press on the Graph selects through it.**
   */
  function goToConversation(conversation: string): void {
    cast.goTo.value?.(conversation)
  }

  return {
    cast,
    treeFiles,
    gaveOut,
    waitsOnPurpose,
    ownWait,
    takenIn,
    goToConversation,
  }
}
