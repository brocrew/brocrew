/**
 * 🔴 **`HO-050` §1.1, as code rather than as a paragraph somebody has to remember.**
 *
 * > ⚑ **"Close the conversation. What goes with it was the session's; what remains was the
 * > agent's."**
 *
 * ⛔ **The PO's ruling is a TEST a person can apply**, and a ruling a surface can only obey by
 * being careful is a ruling the next surface breaks. `HO-025` §2.1 (*an identity is who an agent
 * is; a session is a conversation it is having*) and `HO-009` §5 (*cwd is a property of the
 * session*) said the same thing two handovers earlier, and we grew `SessionInfo` — one `<dl>` with
 * the conversation's working directory four rows above the agent's memory — straight through both.
 *
 * ## ⛔ The rail this module exists to make assertable
 *
 * > ⛔ **"The index may list both. The surfaces may not mix them."**
 * > ⛔ **"What must not happen is one sheet headed with a fact from each."**
 *
 * ⚑ **So every surface declares its subject** — `data-subject` on the element that HEADS it — and
 * every fact drawn inside one is in {@link WHOSE_FACT} under that same subject. ⚠️ **Both
 * directions, per element**: a fact nobody classified is named, and a classification nothing draws
 * is named. `a-file-level-contains-cannot-tell-sibling-declarations-apart` is why it is per
 * element and not a `toContain` over a file.
 *
 * ## ⚠️ Where the brief and the code disagreed, and the code won
 *
 * ⛔ **`527` §0's table reads *"working directory · provider · model · configuration"* as the
 * conversation's** — and `ProviderConfigInfo` is not that *configuration*. Its docblock says what
 * it is: *"What is actually in the provider home, read when the session was created"* — the home,
 * the variable that pins it, how that provider takes configuration, where the credential lives,
 * and the files in it. 🔴 **Apply the PO's own test and every one of those five survives closing
 * the conversation**, because the home does. ⚑ **The *configuration* the ruling means is the one
 * `HO-050` §1.2 sends to the rail** — model, effort, plan mode, approvals — which is the Controls
 * tab and not this one. `a-column-name-is-a-claim`, and `config` carried two.
 *
 * ## ⚑ And the sizes, because one roster answering two questions cannot disagree with itself
 *
 * ⛔ **`526` F9 left this tab named**: *"`SessionInfo`'s and `SessionInstructions`' `.why` triggers
 * and `.note` bodies are 8 px — the same class of defect on the Info tab, which is the tab under a
 * PO ruling. Whoever takes that ruling inherits it."* ⚠️ **Measured before this dispatch touched
 * anything: 65 of 65 text elements on the shut Info tab were below the 9 px floor**, and
 * `tokens.css` §9's own sentence is *"sizes < 9px are micro-labels/badges/table-heads only"*.
 *
 * 🔴 **Not one token VALUE moved** (`526`'s rule, and `527` §4 repeats it). The tokens are named
 * here as STRINGS and the pixels live in `tokens.css` and nowhere else, so a value change there
 * cannot leave a stale copy in this file — and the test resolves the name out of the live cascade
 * rather than comparing against a number typed twice.
 */

/** Which of the two lifetimes a fact belongs to. */
export type Subject = 'conversation' | 'agent'

/**
 * What KIND of text an element carries, which is what decides the size it may take.
 *
 * ⚑ **Five, and a thing has exactly one** — `526`'s shape, because a roster whose members can
 * overlap is an inventory rather than a census.
 */
export type FactRole = 'heading' | 'entry' | 'label' | 'value' | 'prose'

/**
 * The token each role takes, by name, never by number.
 *
 * - `heading`: the two uppercase group headings, at the caption size; uppercase tells them apart.
 * - `label` and `value`: the dense rows, at the caption size too. They are told apart by face and
 *   colour (a muted sans name beside a selectable mono path), not by size.
 * - `prose`: the sentences, one step above the rows, so a person reads them before the facts.
 * - `entry`: the one row that navigates, at the body size, so the door stands out from the facts.
 */
export const ROLE_SIZE: Record<FactRole, string> = {
  heading: '--text-6xs',
  entry: '--text-base',
  label: '--text-3xs',
  value: '--text-3xs',
  prose: '--text-sm',
}

export interface FactEntry {
  /** The `data-cy` the element carries. The address, because a class is scoped and a tag is not a name. */
  readonly cy: string
  readonly subject: Subject
  readonly role: FactRole
  /**
   * ⚠️ **Whether this fact is drawn only in some states.** The census requires every entry to be
   * MET by some mount it walks; one that is not is a line describing a thing the app no longer
   * draws. A `sometimes` entry is met by the populated fixture rather than by the empty one.
   */
  readonly sometimes?: true
}

/**
 * 🔴 **Every fact the Info tab and its sheet draw, and whose it is.**
 *
 * ⛔ **Controls are not here, and that is not an omission.** *Finder*, *re-read*, *Open* and the
 * *what this is* triggers are things you PRESS; the ruling is about facts a surface states. They
 * take the subject of the group they sit in by being inside it, which the walk checks anyway —
 * what they may not do is carry a fact of their own, and none of them does.
 *
 * ⚠️ **This is the INDEX's roster, and the wide surface is checked by EXCLUSION rather than by
 * being listed here.** ⛔ Re-listing forty instruction hooks under `agent` would make the roster a
 * copy of one component's template, and the first row somebody added to that component would make
 * it false silently. ⚑ **What the ruling forbids is a MIXTURE**, so the sheet is measured for the
 * thing that is forbidden: it is headed `data-subject="agent"`, and not one `conversation` entry
 * below appears anywhere inside it — asserted against the same hooks proven present on the index
 * at the same moment, so the absence is about the sheet rather than about a mount that drew
 * nothing (`193`).
 */
export const WHOSE_FACT: readonly FactEntry[] = [
  /* ------------------------------------------------------- this conversation, and it ends with it */
  // ⚑ What the provider reports it is RUNNING (081) — composed host-side, one row per fact. A
  // `v-for`, so the family is matched by prefix rather than by an exact name.
  { cy: 'session-agent-', subject: 'conversation', role: 'value', sometimes: true },
  // ⛔ `HO-009` §5, by name: *cwd is a property of the session*.
  { cy: 'session-cwd', subject: 'conversation', role: 'value' },
  { cy: 'info-note-cwd', subject: 'conversation', role: 'prose', sometimes: true },
  // ⛔ **529 · `HO-050` §1.2's two read-only facts, and both are the conversation's.** A blanket
  // grant is mostly the conversation's — its own sentence says *"one allowed for this conversation
  // may be asked about again later"* — and a commander is `SessionSlot.commandedBy`, fixed at
  // reservation and gone with the slot. ⚑ Apply the PO's test and neither survives it.
  // 🔴 **739 · `736` F-1 — what *Always allow* kept in this conversation is the AGENT's row**
  // (`info-kept`, below): it outlives the conversation. ⚠️ **Two kept tools stay on THIS row's
  // list, and the group's *"Closing it takes these with it"* is false of them** (`739` review): a
  // Codex tool kept by ANOTHER conversation (read back at launch), and one kept by this conversation
  // whose card the window no longer holds (a long conversation releases its oldest items; a reopen
  // loads its tail). `blanketGrants` carries no lifetime (`739` GAP), so the row's own sentence
  // says both lifetimes; the heading is true of every entry only once main says which is which.
  // ⚠️ **`sometimes` on all four**: an ordinary conversation has granted nothing and has no
  // caller, which is the state the shared fixture builds.
  { cy: 'info-grants', subject: 'conversation', role: 'value', sometimes: true },
  { cy: 'info-note-grants', subject: 'conversation', role: 'prose', sometimes: true },
  // ⚑ The line says a caller EXISTS; the note says what it may do. `529` argues the split in
  // `standing-grants.ts` — a summary that listed two of the three verbs would be `395`'s defect.
  { cy: 'info-has-a-commander', subject: 'conversation', role: 'prose', sometimes: true },
  { cy: 'info-note-commander', subject: 'conversation', role: 'prose', sometimes: true },

  // The provider's own id for this thread. There is no thread once it is closed.
  { cy: 'session-ref', subject: 'conversation', role: 'value' },

  /* --------------------------------------------------------------- this agent, and it stays after */
  // ⛔ The isolated per-profile home — the memory boundary (085), and the thing that is still on
  // disk tomorrow. `config.home`, whose own field docblock says *the isolated per-profile home*.
  { cy: 'session-home', subject: 'agent', role: 'value' },
  { cy: 'session-profile', subject: 'agent', role: 'label' },
  { cy: 'info-note-home', subject: 'agent', role: 'prose', sometimes: true },
  // The files IN that home, each with its real state. They outlive every conversation held in it.
  { cy: 'session-config', subject: 'agent', role: 'value' },
  { cy: 'info-note-config', subject: 'agent', role: 'prose', sometimes: true },
  // 🔴 739 · `736` F-1 — what *Always allow* kept here, in the file its card named. ⚑ `sometimes`:
  // an ordinary conversation kept nothing.
  { cy: 'info-kept', subject: 'agent', role: 'value', sometimes: true },
  { cy: 'info-note-kept', subject: 'agent', role: 'prose', sometimes: true },
  // ⚑ The index entry that opens wide — a NAVIGATION, and the one place the two sides meet, which
  // the ruling allows: *the index may list both*.
  { cy: 'told-index-title', subject: 'agent', role: 'entry' },
  { cy: 'told-index-says', subject: 'agent', role: 'prose' },
] as const

/**
 * ⚑ **The two group headings, and the second line is where the distinction is TAUGHT.**
 *
 * > ⚑ **"And the grouping IN THE INDEX is where the distinction gets taught"** — the PO's
 * > sentence, and it means the index is not just a list of links.
 *
 * ⛔ **The teaching line is the PO's test, in the second person**, rather than a word like
 * *session-scoped* that a person would have to be taught before it taught them anything.
 */
export const SUBJECT_WORDS: Record<Subject, { readonly title: string; readonly says: string }> = {
  conversation: {
    title: 'this conversation',
    says: 'Closing it takes these with it.',
  },
  agent: {
    title: 'this agent',
    says: 'These are still here after it closes.',
  },
}

/** Every subject, so a walk can be exhaustive rather than a list somebody typed. */
export const SUBJECTS: readonly Subject[] = ['conversation', 'agent'] as const

/**
 * Whether an element's `data-cy` is this entry — exact, or the family the prefix names.
 *
 * ⛔ **A trailing `-` is what makes an entry a FAMILY**, and it is read off the string rather than
 * declared beside it: `a-hook-family-must-be-built-from-a-template-literal` is the neighbouring
 * rule, and a second field saying *this one is a prefix* is a second place to get it wrong.
 */
export function factOf(cy: string): FactEntry | null {
  for (const entry of WHOSE_FACT) {
    if (entry.cy.endsWith('-') ? cy.startsWith(entry.cy) : cy === entry.cy) return entry
  }
  return null
}
