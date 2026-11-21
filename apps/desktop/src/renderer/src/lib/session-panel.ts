import {
  NEEDING_NOUN,
  NEEDINGS,
  subAgentFacets,
  summonsAttention,
  workflowRunFacets,
  type AgentFacets,
  type Needing,
} from './agent-state'
import { BACKGROUND_WORD } from './background-work'
import { scheduleHeld, somethingRunning } from '../../../shared/agent-state'
import { pathTail } from '../../../shared/path-tail'
import { cardHomes, isAwaitingAnswer, type PlanItem, type TranscriptState } from './transcript'

/** Project the open panel from the transcript so both views settle a card from the same event. */

/**
 * Match panel priority: a permission outranks a question and ends the scan. For hot paths, use
 * TranscriptState.pending, which the fold maintains without rescanning the items.
 */
export function pendingKind(state: TranscriptState): 'permission' | 'question' | null {
  let question = false
  for (let index = state.items.length - 1; index >= 0; index--) {
    const item = state.items[index]!
    if (!isAwaitingAnswer(item)) continue
    if (item.kind === 'permission') return 'permission'
    if (item.kind === 'userInput') question = true
  }
  return question ? 'question' : null
}

/** One thing in the panel, and where in the conversation it lives. */
export interface PanelEntry {
  /** Distinct within its section — the list renders on this. */
  key: string
  /**
   * The transcript item to scroll to. The panel is a way INTO the conversation and nothing else:
   * you answer a card where the card is, under the disclosure rules 031/034 established for it.
   */
  itemId: string
  title: string
  /** The second line. Empty when there is nothing more to say — never filled with a guess. */
  detail: string
  /** Use the source card’s facets. Checklist and image rows have no agent plate. */
  facets?: AgentFacets
}

/** Index only images with a path confirmed by the runtime. Missing files still appear in the transcript. */
export interface PanelAsset {
  key: string
  /** The transcript item, so the conversation can be scrolled to it as well as the file opened. */
  itemId: string
  /** Absolute path — what the viewer is opened with. */
  path: string
  /** The file's own name. The row's label. */
  name: string
  /** What it was generated from, when the provider said. The second line. */
  prompt?: string
}

/** The checklist, while it still has something left to do. */
interface PanelTodo {
  itemId: string
  steps: PlanItem['steps']
  /** How many are finished — the header line, so the panel says progress without a second walk. */
  done: number
  note?: string
}

export interface SessionPanel {
  questions: PanelEntry[]
  permissions: PanelEntry[]
  agents: PanelEntry[]
  /** Read assets from the same items as the transcript. They accumulate after other cards settle. */
  assets: PanelAsset[]
  /**
   * Show one row for each running workflow. Its agents live in the tool-call tree. Only their open
   * request cards count toward waiting.
   */
  workflows: PanelEntry[]
  todo: PanelTodo | null
  /**
   * How many things are blocked on YOU.
   *
   * Deliberately not the total. A running agent and an unfinished checklist are things that are
   * HAPPENING; counting them here would put a number on the badge that never reaches zero while the
   * agent works, and a badge that is always lit is a badge nobody reads.
   */
  waiting: number
  /**
   * True when there are no waiting cards, running sub-agents or workflows, or open checklist.
   * Assets, detached work and schedules do not affect this value.
   */
  empty: boolean
  /**
   * Background work belongs above the composer. It blocks nothing here and changes the empty
   * panel’s body without erasing the panel or adding a second row.
   */
  stillRunning: boolean
  /** Providers can report running work without an ID. Point to the background list only when it draws. */
  runningNamed: boolean
  /**
   * Scheduled work belongs in its own bar and does not block the panel. Use the same predicate as
   * the bar so the panel can report schedules the provider counted without listing them.
   */
  scheduled: boolean
}

/**
 * `a`, `a or b`, `a, b or c` — the same Oxford-free shape `provider-config.ts`' `humanList` writes
 * for *and*. ⛔ Local rather than shared: that one lives in the MAIN process, and a renderer import
 * of a `shared` value costs this bundle 135 kB.
 */
function orList(words: readonly string[]): string {
  const last = words[words.length - 1]
  // ⚠️ Unreachable while {@link summonsAttention} admits anybody, and the heading test's vacuity
  // floor is what keeps it unreachable. It returns a word rather than an empty string so a fold
  // that did empty this set could never render a heading with a hole where its subject was.
  if (last === undefined) return 'nothing'
  if (words.length === 1) return last
  return `${words.slice(0, -1).join(', ')} or ${last}`
}

/** Derive the heading’s categories from the same predicate as the panel’s waiting count. */
export const WHAT_THIS_COLUMN_COUNTS: readonly Needing[] = NEEDINGS.filter(summonsAttention)

/**
 * Scope the heading to open cards in this panel. Routed requests and questions in prose can exist
 * without a local card, so this view cannot report whether other questions were raised.
 */
export const NOTHING_OPEN_HEAD = `No ${orList(
  WHAT_THIS_COLUMN_COUNTS.map((needing) => NEEDING_NOUN[needing]),
)} are on a card here`

/**
 * Share one heading across the open-panel states. The body points to other work where it is shown.
 * The background list may exist even when the adapter offers no Stop action.
 */
export const PANEL_EMPTY_WORDS = {
  quiet: {
    head: NOTHING_OPEN_HEAD,
    // This panel lists provider sub-agents. Work given to another app conversation is recorded elsewhere.
    body: 'Running sub-agents, workflows and the checklist appear here too, while they are open.',
  },
  running: {
    head: NOTHING_OPEN_HEAD,
    body: `Work this conversation started is ${BACKGROUND_WORD.running} — it is listed above the composer.`,
  },
  /** Report work without pointing to a list when the provider supplied no listable rows. */
  unnamed: {
    head: NOTHING_OPEN_HEAD,
    body: `Work this conversation started is ${BACKGROUND_WORD.running} — this conversation cannot say what it is.`,
  },
  /** The schedule bar can draw with only a dropped count, so report its presence without promising rows. */
  scheduled: {
    head: NOTHING_OPEN_HEAD,
    body: 'This conversation has work scheduled — the schedule is above the composer.',
  },
  /** The Work tab includes finished pieces, so report that work was given whenever it has rows. */
  gaveWork: {
    head: NOTHING_OPEN_HEAD,
    body: 'This conversation has given out work — it is on the Work tab.',
  },
} as const

/**
 * Prefer running work, then scheduled work, then work handed elsewhere. Given-out work is supplied
 * separately because the transcript projection cannot derive it from this conversation’s items.
 */
export function panelEmptyWords(
  panel: Pick<SessionPanel, 'stillRunning' | 'runningNamed' | 'scheduled'>,
  /**
   * ⛔ **Whether this conversation has given out any work AT ALL** — rows, not open rows, and not
   * a count. ⚠️ `false` is *nothing read yet* as well as *nothing given out*, and both draw the
   * same paragraph: neither is a claim, and the tab is one click away either way.
   */
  gaveWork = false,
): {
  head: string
  body: string
} {
  if (panel.stillRunning) {
    return panel.runningNamed ? PANEL_EMPTY_WORDS.running : PANEL_EMPTY_WORDS.unnamed
  }
  if (panel.scheduled) return PANEL_EMPTY_WORDS.scheduled
  return gaveWork ? PANEL_EMPTY_WORDS.gaveWork : PANEL_EMPTY_WORDS.quiet
}

/**
 * The panel for `state`.
 *
 * One pass for the cards and the checklist, plus one walk of the sub-agent tree. Called on every
 * render of a live conversation, so it allocates only what it returns.
 */
export function sessionPanel(state: TranscriptState): SessionPanel {
  const questions: PanelEntry[] = []
  const permissions: PanelEntry[] = []
  /**
   * The LAST checklist, not the one the current turn is updating. `state.planId` is nulled when a
   * turn ends (028) so that the next turn opens its own block — but the plan it was working from is
   * still the plan, and the reader who scrolled away from it is exactly who this panel is for.
   */
  let plan: PlanItem | null = null
  const assets: PanelAsset[] = []

  for (const item of state.items) {
    if (item.kind === 'plan') plan = item
    // A file the session produced. `item.path` is the existence test AND the thing the viewer is
    // opened with — see {@link PanelAsset} on why a pathless image is shown in the conversation but
    // not indexed here.
    if (item.kind === 'image' && item.path) {
      assets.push({
        key: item.id,
        itemId: item.id,
        path: item.path,
        name: pathTail(item.path),
        ...(item.prompt ? { prompt: item.prompt } : {}),
      })
    }
    if (!isAwaitingAnswer(item)) continue
    if (item.kind === 'permission') {
      permissions.push({
        key: item.id,
        itemId: item.id,
        title: item.request.action,
        detail: item.request.detail,
        facets: { needing: 'permission' },
      })
    } else if (item.kind === 'userInput') {
      // The first question is the heading and the request's own prompt is the context under it. A
      // request with no structured questions is a permission GRANT, and then the prompt is all
      // there is — so it becomes the heading and the second line stays empty rather than repeating
      // it back.
      const heading = item.request.questions[0]?.prompt
      questions.push({
        key: item.id,
        itemId: item.id,
        title: heading ?? item.request.prompt,
        detail: heading === undefined || heading === item.request.prompt ? '' : item.request.prompt,
        facets: { needing: 'question' },
      })
    }
  }

  const agents = cardHomes(state)
    .filter(({ card }) => card.running)
    .map(({ card, itemId }) => ({
      // Keyed on the agent, not on its home: several cards can hang off one tool row.
      key: `agent:${card.agentId}`,
      itemId,
      title: card.title ?? card.kind ?? 'sub-agent',
      detail: card.lastTool ?? '',
      // The same card the transcript's own entry is drawn from, through the same function — the
      // panel and the conversation are one fact read twice, never recorded twice.
      facets: subAgentFacets(card),
    }))

  /** Use the tool items so every workflow row has a navigation target. The registry can precede its tool item. */
  const workflows: PanelEntry[] = []
  for (const item of state.items) {
    if (item.kind !== 'tool') continue
    const run = item.workflow
    if (!run || !run.running) continue
    workflows.push({
      key: `workflow:${run.taskId}`,
      itemId: item.id,
      title: run.name ?? 'workflow',
      // The second line is what the run is FOR, not what it is doing this second — the head of the
      // tree already says that, and a drawer row that rewrites itself on every heartbeat is the
      // thing 078 exists to prevent.
      detail: run.description ?? '',
      facets: workflowRunFacets(run),
    })
  }

  const todo = openTodo(plan)
  // ⛔ {@link SessionPanel.waiting}'s own definition: *how many things are blocked on YOU*.
  const waiting = questions.length + permissions.length

  return {
    questions,
    permissions,
    agents,
    assets,
    workflows,
    todo,
    // ⚠️ **`workflows` is deliberately absent from this sum, and it is 080's line rather than an
    // omission** (107 §6). A running workflow is something that is HAPPENING; `waiting` counts what
    // is blocked on YOU, and it is what badges the drawer toggle, dots the Open tab and raises the
    // attention bar. A 22-agent run that is merely busy may raise none of them. The one case that
    // does count is a workflow AGENT hitting a permission — and that arrives as a real
    // `permission_request` card, counted above like any other, by the same code, with no special
    // case here at all.
    waiting,
    // Assets and detached work leave the empty state alone. A running workflow makes the panel
    // nonempty. Its open request cards count toward waiting separately.
    empty: waiting === 0 && agents.length === 0 && workflows.length === 0 && todo === null,
    // ⛔ **The fact this panel does not list and was claiming the absence of** (250). See
    // {@link SessionPanel.stillRunning} for why it joins neither sum, and {@link panelEmptyWords}
    // for the sentence it changes. Read through the one predicate every surface asks (`223`), so the
    // paragraph, the pill and the rail row cannot come to different conclusions about one registry.
    stillRunning: somethingRunning(state.background),
    // ⚑ Deliberately the BAR's own condition, so the sentence and the widget cannot disagree about
    // whether there is a list to look at (`223`: one predicate, every consumer asks it).
    runningNamed: state.background.running.length > 0,
    // ⛔ **The other fact this panel does not list and was claiming the absence of** (258). Read
    // through the one predicate every surface asks (`223`), so the paragraph, the pill and the rail
    // row cannot come to different conclusions about one schedule.
    scheduled: scheduleHeld(state.schedule),
  }
}

/**
 * The checklist while it is still open — and `null` the moment it is not.
 *
 * "Open" for a checklist means it has a step left. A plan whose every step is `done` has ENDED, in
 * the same sense an answered permission has, and 037's rule is that ended things leave the panel.
 * A plan block carrying only a document and no steps is not a checklist at all and never enters.
 */
function openTodo(plan: PlanItem | null): PanelTodo | null {
  if (!plan) return null
  const done = plan.steps.filter((step) => step.status === 'done').length
  if (plan.steps.length === 0 || done === plan.steps.length) return null
  return {
    itemId: plan.id,
    steps: plan.steps,
    done,
    ...(plan.note !== undefined ? { note: plan.note } : {}),
  }
}
