/**
 * ⚑ **How often the agents' processes may be measured, at most** — the Providers screen asks while
 * it is open, and an ask inside this is answered with the last measurement
 * ({@link RuntimeHost.providerResources}). ⚑ One process listing each time, and none while nobody
 * asks.
 */
const RESOURCE_SAMPLE_MS = 5_000

/**
 * 🔴 **How long an AGENT's interrupt waits for the provider before answering** (395) — **and, since
 * `709`, how long interrupt-and-send waits on its own** (`704` H-8).
 *
 * ⛔ **Two seconds, and it is the number both adapters already chose for this exact wait.** Claude
 * bounds its own ack at `INTERRUPT_ACK_TIMEOUT_MS = 2000` and forces the terminal itself; Codex
 * bounds nothing on this path — it awaits the ANSWER to its `turn/interrupt` request, which a wedged
 * app-server may never send (709, correcting *"a `turn/completed` that may never arrive"*). ⚑ So this
 * bound is a no-op on Claude — the call has already resolved — and is the whole of the guarantee on
 * Codex, which is why it exists at all.
 *
 * ⚠️ **It releases the WAITER, not the work** (185). The interrupt stays in flight; what is bounded
 * is how long a parent's turn is held open by a child's provider — how long a person's
 * interrupt-and-send, with the queue it holds, is held by the provider of the conversation it is in
 * — and, since `720` (`709` F-6), how long a person's Stop, and the window's `record.busy` with it, is.
 *
 * 🔴 **742 · and how long a person's answer to a provider's card waits before the door answers
 * `unacknowledged`** (`739` F-6) — {@link RuntimeHost.answerTheProvider}. ⚠️ Not the number either
 * adapter chose for it: both take an answer synchronously, so on `main`'s providers this bound never
 * passes; it is the whole of the guarantee for an adapter whose answer does not settle.
 */
/**
 * ⛔ **616 + 612 · `positiveWindow` stood here and has NO window left to guard.**
 *
 * ⚑ **`398` §6 wrote it, and the rule it enforced is worth keeping in words**: zero and negative
 * are not short windows, they are windows that have always elapsed — a guard widened for a test's
 * convenience, failing OPEN while reading like a tightening. ⚠️ **And it threw rather than
 * clamping**, because a clamp would let a call site pass `0` and get the default back, so the
 * number in force would stop being the number anybody wrote.
 *
 * 🔴 **Its own note argued for its survival and that argument has expired.** It read *"one caller
 * since `400`, and it stays a function… a guard inlined at its last call site is a guard the next
 * deadline will be written without."* ⛔ **There is no last call site now**: the constructor
 * resolves no window at all — see the list where it used to. ⚠️ A guard with no caller is not a
 * guard, and a lint error is the honest form of that fact.
 *
 * ⚑ **What a future deadline owes**: this rule, re-written at the moment it has something to
 * guard — never restored as a function nothing calls.
 */

const DEFAULT_INTERRUPT_WAIT_MS = 2_000
const DEFAULT_CLOSE_DRAIN_TIMEOUT_MS = 5_000

/**
 * How long a reopen waits, once its provider has answered, for the read of what its Codex thread
 * already holds. The read runs alongside the resume and only decides how much of this
 * conversation's text is owed, so a late one costs tokens, never the reopen.
 */
const DEFAULT_REOPEN_LEADS_GRACE_MS = 1_000

/**
 * 🔴 **657 · the bound on waiting for work already on its way** (standing rule 13).
 *
 * ⛔ **What is waited for is somebody else's handover**: a work message handed to the provider and
 * not yet written down as a task, or a held message being flushed. Both are bounded underneath —
 * the Keychain read, the settings acknowledgement, the path check — and none of those bounds was
 * written for THIS wait, so this one is its own. ⚠️ **On expiry the message decides anyway**, and
 * the worst it can do is what every message could do before `657`: be held beside a task that
 * nobody had recorded yet. The same number as a launch, because it is the same order of patience.
 */
const DEFAULT_DELIVERY_WAIT_MS = 15_000

/**
 * 🔴 **708 · the bound on asking a provider which commands it has** (`R42`, standing rule 13).
 *
 * ⚑ **What is waited on is usually the CLI handshake**: the host asks only when this life holds no
 * list — a child that has not finished starting, or one whose own list read failed — and `279`
 * measured the handshake's list at **1 918 ms**, and `supportedCommands()` at **0 ms** once it has
 * answered.
 * ⚠️ **A person is waiting on this, pressing Send**, so it is bounded here although the adapter's own
 * read of the handshake list waits for its answer or the CLI's exit (nothing waits on that one): five
 * seconds is ~2.6× the measured handshake. ⛔ **On expiry the message decides without a list**, which `R42` rules: a message
 * shaped like a command goes out as typed.
 */
const DEFAULT_COMMAND_LIST_WAIT_MS = 5_000

export {
  DEFAULT_CLOSE_DRAIN_TIMEOUT_MS,
  DEFAULT_COMMAND_LIST_WAIT_MS,
  DEFAULT_DELIVERY_WAIT_MS,
  DEFAULT_INTERRUPT_WAIT_MS,
  DEFAULT_REOPEN_LEADS_GRACE_MS,
  RESOURCE_SAMPLE_MS,
}
