/**
 * 🔴 **Questions an agent asked WITHOUT waiting for the answer** (provider follow-ups 1, W4's ruling)
 * — Codex's `request_user_input_async`, which `gpt-6.1-sol` offers: the agent writes its questions
 * into a message and its turn goes on. Nothing is waiting on the answer, so a choice picked here is
 * **an ordinary message to the conversation** — sent now if it is idle, held until its turn ends if
 * it is busy (`store.send`'s own rule) — and the card says so in those words, so nobody reads a
 * press as unblocking anything.
 *
 * ⛔ This is not the question CARD (`UserInputCard`), which answers a request the provider is
 * holding open; see `RuntimeEvent`'s `assistant_message.questions`.
 */

/** One question as the message carries it — `AssistantItem.questions`. */
export interface AskedWithoutWaiting {
  readonly title: string
  readonly options?: readonly string[]
}

/** The sentence beside the choices: what a press does, and what it does not. */
export const SENT_AS_A_MESSAGE =
  'Picking one sends it as a message — nothing is waiting on the answer.'

/**
 * What a choice says once pressed, until the message itself appears below: an ACT, never an outcome
 * (`077`) — the message may yet be held behind the running turn, or refused.
 */
export function goesAsAMessage(text: string): string {
  return `Your answer goes as a message: ${text}`
}

/**
 * ⚑ **The words a choice sends.** One question: the option alone, which is what a person would type.
 * Several: the question's title before it, so the agent can tell which one was answered.
 */
export function answerFor(
  asked: readonly AskedWithoutWaiting[],
  question: AskedWithoutWaiting,
  option: string,
): string {
  const answer = asked.length > 1 ? `${question.title} — ${option}` : option
  // ⛔ A leading `/` would go out as a COMMAND (`/compact`, a skill) rather than as the person's
  // answer; said as an answer, it is one.
  return answer.startsWith('/') ? `Answer: ${answer}` : answer
}

/** The questions that offer choices at all; a free-text one is answered in the composer. */
export function questionsWithChoices(
  asked: readonly AskedWithoutWaiting[] | undefined,
): readonly AskedWithoutWaiting[] {
  return (asked ?? []).filter((question) => (question.options?.length ?? 0) > 0)
}

/** A transcript row, as far as {@link repliedAfter} reads one. */
interface Row {
  readonly kind: string
  readonly id: string
}

/**
 * ⚑ **The assistant messages a person has replied after** — every assistant row followed, anywhere
 * later, by a message of theirs (`user`) or one held for the turn's end (`queued`). Their choices are
 * spent: the conversation has moved on, and whatever was sent is on the record below.
 */
export function repliedAfter(items: readonly Row[]): ReadonlySet<string> {
  const replied = new Set<string>()
  let seenAReply = false
  for (let at = items.length - 1; at >= 0; at -= 1) {
    const item = items[at]!
    if (item.kind === 'user' || item.kind === 'queued') seenAReply = true
    else if (item.kind === 'assistant' && seenAReply) replied.add(item.id)
  }
  return replied
}
