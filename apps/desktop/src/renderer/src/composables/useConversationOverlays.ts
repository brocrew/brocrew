import { computed, ref, watch, type ComputedRef } from 'vue'
import type { RunTarget } from '../lib/panel-runs'
import type {
  ChildWorkInput,
  ChildWorkResult,
  ToolAnswer,
  WorkflowOutputResult,
} from '../../../shared/runtime-ipc'
import type { SessionRecord } from '../lib/session-record'
import { receiptOf } from '../lib/transcript'

/** What `ConversationPane` reads to open its overlays. */
export interface OverlayProps {
  readonly record: SessionRecord
  readonly onReadWorkflowOutput?: (taskId: string) => Promise<WorkflowOutputResult>
  readonly onReadChildWork?: (what: ChildWorkInput) => Promise<ChildWorkResult>
  readonly onReadToolAnswer?: (toolCallId: string) => Promise<ToolAnswer | null>
}

/**
 * Which overlay `ConversationPane` has open, each bound to the conversation that opened it, and the
 * reads that open them (S01, moved out of `ConversationPane.vue` unchanged).
 */
export function useConversationOverlays(
  props: OverlayProps,
  transcript: ComputedRef<SessionRecord['transcript']>,
) {
  /**
   * The image being looked at, or null (067).
   *
   * ⚠️ **One piece of state for two entrances, and that is the point.** The transcript entry and the
   * panel's Assets index both open images; if each owned its own overlay there would be two viewers
   * that could be open at once, stacked, with two Escape handlers. This pane is the lowest surface
   * both of them are inside, so it is where the one viewer lives.
   *
   * It is view state — which picture you are looking at — and therefore does NOT belong to the
   * session record.
   *
   * ⚠️ **Cleared when the record changes, and it took a review to notice that mattered.** An earlier
   * version of this comment claimed the overlay could not outlive a conversation switch because "the
   * props are replaced" — which is not a mechanism. Vue resets nothing on a prop change, and this
   * component is deliberately NOT keyed by session, so without the watcher below an image opened in
   * one conversation kept floating over the next one, showing another session's file. The path in it
   * would still be real; it would simply belong to a conversation you are no longer looking at.
   *
   * Watched on `sessionId` rather than on the record object: the record is replaced on every event
   * for the same conversation, and closing the viewer under the user because a delta arrived would
   * be a different bug.
   *
   * ⚠️ **And the state carries the session it belongs to, so the watcher is a tidy-up rather than the
   * guarantee.** A reset is an ordering promise — it holds only as long as nothing ever renders
   * between the prop changing and the effect running, which is a thing to be true rather than a thing
   * that cannot be false. With the id in the value, {@link openFor} simply cannot match a
   * conversation that is not on screen, and the bug is unreachable rather than corrected.
   */
  const viewing = ref<{ sessionId: string; path: string; prompt?: string } | null>(null)

  /** The image to show, and only if it belongs to the conversation being rendered right now. */
  const openFor = computed(() =>
    viewing.value?.sessionId === props.record.sessionId ? viewing.value : null,
  )

  /**
   * 🔴 **Whether the tools sheet is open, and for WHICH conversation** (358).
   *
   * ⚠️ **The session id rides the value, exactly as `viewing` above carries one and for the same
   * reason.** Switching conversation while a sheet is open must not leave one conversation's
   * inventory floating over another's transcript — and with the id in the value that is unreachable
   * rather than corrected by a watcher.
   */
  const toolsFor = ref<string | null>(null)
  /**
   * 🔴 **Whether the agent's side is open wide, and for WHICH conversation** (`527`, `HO-050` §1.1).
   *
   * ⚠️ **The session id rides the value**, exactly as `viewing` and `toolsFor` do and for the same
   * reason `067` found: switching conversation while a sheet is open must not leave one
   * conversation's composed instructions floating over another's transcript. ⛔ With the id in the
   * value that is unreachable rather than corrected by a watcher.
   */
  const instructionsFor = ref<string | null>(null)
  /**
   * The sheet's own precondition, as ONE computed: this conversation, and a session to be about.
   *
   * ⚑ **It needs nothing else.** The sheet is not told which provider it is drawing — how a tool
   * name is spelled rides the registry as data (039) — so this is the whole precondition.
   */
  const toolsOpen = computed(() => toolsFor.value === props.record.sessionId)

  /**
   * The sheet's precondition: this conversation, and a session described well enough to have any.
   *
   * ⛔ **`meta` and not merely the id.** `record.meta` is null until the host answers the create, and
   * `SessionInstructions` takes `instructions` as a REQUIRED prop — a sheet opened in that window
   * would be a sheet about nothing. ⚑ The index entry that opens it lives inside the drawer, which
   * is itself behind `props.record.meta`, so today nothing can press it that early; the guard is
   * here because the press is two components away and this is where the answer is.
   */
  const instructionsOpen = computed(() =>
    instructionsFor.value === props.record.sessionId ? props.record.meta : null,
  )

  /**
   * 🔴 **F093 · "What this agent receives"**, opened from the Open tab's door — scoped to the
   * conversation that opened it, exactly as {@link instructionsFor} is, and for the same reason.
   */
  const inputsFor = ref<string | null>(null)
  const inputsOpen = computed(() =>
    inputsFor.value === props.record.sessionId ? props.record.meta : null,
  )

  // Keep workflow output bound to the conversation that opened it.
  const readingOutput = ref<{
    sessionId: string
    workflow: string
    result: WorkflowOutputResult
  } | null>(null)

  const outputFor = computed(() =>
    readingOutput.value?.sessionId === props.record.sessionId ? readingOutput.value : null,
  )

  /** What a sub-agent did (112). Same shape, same `sessionId` guard, for the same 067 reason. */
  const readingChild = ref<{
    sessionId: string
    label: string
    /** The child to refresh; null for task-owned journals or scripts. */
    agentId: string | null
    result: ChildWorkResult
  } | null>(null)

  const childFor = computed(() =>
    readingChild.value?.sessionId === props.record.sessionId ? readingChild.value : null,
  )

  /**
   * 🔴 **The tool answer a person opened** (462) — `null` until they press one.
   *
   * ⚠️ **Same shape as `readingChild` above, and the `sessionId` guard is the same fix** for the same
   * reason: this pane is reused across conversations without a `key`, and a panel opened in one must
   * not float over the next. ⛔ **`answer` may legitimately be `null` inside a non-null value** — that
   * is the whole point of the panel: the person asked, this app is holding nothing, and the panel says
   * which silence it is. A `null` here means nobody has asked.
   */
  const readingAnswer = ref<{
    sessionId: string
    name: string
    answer: ToolAnswer | null
    /** ⚑ **685 · the row's own short form** — see `ToolAnswerViewer`'s `shortForm`. */
    shortForm: string | null
  } | null>(null)
  const answerFor = computed(() =>
    readingAnswer.value?.sessionId === props.record.sessionId ? readingAnswer.value : null,
  )

  watch(
    () => props.record.sessionId,
    () => {
      viewing.value = null
      readingOutput.value = null
      readingChild.value = null
      readingAnswer.value = null
    },
  )

  async function openWorkflowOutput(
    taskId: string,
    workflow: string,
    shortMiss = false,
  ): Promise<boolean> {
    const read = props.onReadWorkflowOutput
    if (!read) return false
    // Keep the result with the conversation that requested it.
    const sessionId = props.record.sessionId
    const result = await read(taskId)
    if (!shortMiss || result.ok) readingOutput.value = { sessionId, workflow, result }
    return result.ok
  }

  async function openChildWork(
    what: ChildWorkInput,
    label: string,
    shortMiss = false,
  ): Promise<boolean> {
    const read = props.onReadChildWork
    if (!read) return false
    // Captured before the await, exactly as above.
    const sessionId = props.record.sessionId
    const agentId = what.part === 'transcript' ? what.agentId : null
    const result = await read(what)
    if (!shortMiss || result.ok) readingChild.value = { sessionId, label, agentId, result }
    return result.ok
  }

  async function openPanelRun(run: RunTarget): Promise<boolean> {
    if (run.kind === 'agent' && props.onReadChildWork) {
      return openChildWork({ part: 'transcript', agentId: run.id }, run.label, true)
    }
    if (run.kind === 'workflow' && props.onReadWorkflowOutput) {
      return openWorkflowOutput(run.id, run.label, true)
    }
    return false
  }

  /**
   * ⛔ **Read the whole answer, once, and put it on screen** (462).
   *
   * ⚠️ **The session id is captured BEFORE the await**, exactly as `openWorkflowOutput` and
   * `openChildWork` do: the reader can switch conversation while the read is in flight, and stamping
   * the id afterwards would attribute one conversation's answer to whatever is on screen when it
   * lands. The `answerFor` guard is the second half of that same two-part answer.
   *
   * ⛔ **It opens even when the read answers `null`**, and that is the decision rather than an
   * oversight: `null` is a fact — this app is not holding it — and a button that silently did nothing
   * would be `106`'s control that cannot act wearing the costume of one that can.
   */
  async function openToolAnswer(toolCallId: string, name: string): Promise<void> {
    const read = props.onReadToolAnswer
    if (!read) return
    const sessionId = props.record.sessionId
    // ⚑ **685 · the short form the row kept, taken BEFORE the await** with the session id, for its
    // reason — a top-level row's or a sub-agent card's (`receiptOf` walks both).
    const shortForm = receiptOf(transcript.value, toolCallId)
    readingAnswer.value = { sessionId, name, answer: await read(toolCallId), shortForm }
  }

  function openImage(item: { path?: string; prompt?: string }): void {
    // No path, nothing to view. The entry already renders the "file is gone" line and its frame is
    // not a button, so this is a guard against a future caller rather than a case that fires today.
    if (!item.path) return
    viewing.value = {
      sessionId: props.record.sessionId,
      path: item.path,
      ...(item.prompt ? { prompt: item.prompt } : {}),
    }
  }

  return {
    viewing,
    openFor,
    toolsFor,
    instructionsFor,
    toolsOpen,
    instructionsOpen,
    inputsFor,
    inputsOpen,
    readingOutput,
    outputFor,
    readingChild,
    childFor,
    readingAnswer,
    answerFor,
    openWorkflowOutput,
    openChildWork,
    openPanelRun,
    openToolAnswer,
    openImage,
  }
}
