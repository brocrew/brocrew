import {
  AGENT_MESSAGE_KINDS,
  TASK_OUTCOMES,
  TASK_STATES as WORK_SEARCH_TASK_STATES,
} from '../../../shared/task-contracts'
import { MCP_SERVER_REQUEST_WHO } from '../../../shared/mcp-server-requests'
import {
  PASS_UP_RECIPIENTS,
  type PassUpRecipient,
  type QuestionRecipient,
} from '../../../shared/question-contracts'
import { type Provider, providerDescriptor, providerRecord, providerSchema } from '@brobot2/shared'
import { QUESTION_RECIPIENTS, RECIPIENT_MEANS } from '../../../shared/questions'
import { THEME_TOOL_NAMES } from '../../themes/tool-words'
import { type ToolsToldInText } from '../factory-text'
import { WORK_SEARCH_SCOPES } from '../../../shared/work-search'
import { WORK_STATE_WORD } from '../../../shared/work-state-words'
import { agentToolStringEnum } from '@brobot2/runtime'
import { z } from 'zod'

/**
 * **The MCP server name every one of this app's own tools is published under** (466).
 *
 * **It was a bare literal in the toolset's own `return` and nothing else could reach it.** * `466` gave the digest a reader that has to tell one of OUR tool calls from the agent's work:
 * `tool_call.name` arrives QUALIFIED and the two providers spell it differently —
 * `brobot__list_agents` on one, `mcp__brobot__list_agents` on the other — so the only honest
 * reading is `splitQualified` against each provider's own `ToolNaming` and a comparison with this
 * word. **A bare `startsWith('brobot__')` would match one provider and silently miss the
 * other**, which `tool-inventory.ts` already says in as many words about comparing bare names.
 */
export const AGENT_TOOL_SERVER = 'brobot'

export const AGENT_TOOL_INSTRUCTIONS =
  'These tools reach the app you are running inside. An agent is named by the piece of work it owns: W1.2 means the conversation that owns W1.2, and every tool that takes an agent takes that label as well as its id. create_agent brings an agent into existence, optionally with standing rules; give_work gives an agent a piece of work, and with new: true brings a new agent with none into existence as it gives; when the person asks for something to be done, take_on_work takes it on as a piece of your conversation’s own work, so the person can see it and what you give out for it hangs under it; update_work says where a piece stands and keeps files for it — any piece you hold, your own conversation’s work included, or one you gave — titles your own conversation’s work or a piece you gave, and changes the brief of a piece you gave or took on for the person; a root’s brief stays as recorded. Only the giver closes a piece. A refusal is a successful call whose answer names the rule that stopped it, whether that rule is permanent, and whether retrying could ever help — read it rather than retrying a permanent one.'

/**
 * **D-039 · the tools' instructions a launch says in its conversation's own text, or `undefined`**
 * — {@link AGENT_TOOL_INSTRUCTIONS} under {@link AGENT_TOOL_SERVER}'s name on Codex, whose catalogue
 * cannot hold them; nothing on Claude, which is handed them with its catalogue.
 *
 * **The one decision, for every composition of a launch's text**: `main/index.ts` hands it to
 * `thisConversationSpans`. A copy of that composition (a smoke's) hands it too, or it measures a
 * prompt the product does not send.
 */
export function toolsToldInTextFor(provider: Provider): ToolsToldInText | undefined {
  return providerDescriptor(provider).toolInstructionsInText
    ? { server: AGENT_TOOL_SERVER, instructions: AGENT_TOOL_INSTRUCTIONS }
    : undefined
}

/**
 * **The published inventory, as data** (347) — criterion 6's *"a negative needs a search shape"*.
 *
 * **A claim that this app publishes no dispatch tool is worth exactly as much as the enumeration
 * behind it**, and a `grep` for the word `dispatch` is not one: it could not have found a tool
 * called `assign_work`, `delegate`, `hand_off` or `enqueue_task`. This constant is the shape the
 * negative is measured against — the complete vocabulary, including role-restricted tools — so the assertion
 * is *"the inventory is exactly this list"* rather than *"we did not find a bad one"*. **Not
 * *"these five"*, which it said until `380` published a sixth**: a sentence that names a count is a
 * sentence that goes stale the next time the list moves, and the census reads the list.
 */
export const TOOL_NAMES = [
  'list_agents',
  'get_agent_status',
  /**
   * **D-016 · the GIVE — a piece of work, to an agent, by its profile** (plan ruling 1).
   *
   * **It took `spawn_agent`'s place in this list, and it is a new act rather than a rename.**
   * `spawn_agent` opened a conversation and sent it nothing; this one sends the work, and starts a
   * conversation only when the giver has none with that agent — so no tool offers a second one.
   * **It is the one verb here that hands anybody something to do**: §5's *"no published tool
   * queues work"* census is about every OTHER name on this list, and this one is its exception.
   */
  'give_work',
  'message_agent',
  /**
   * **The reader of what this app keeps for a piece** (380 as the document registry's; a
   * resource since D-016).
   *
   * **`the-five-tools.test.ts` keeps its name and its assertions are DERIVED**, so the one thing
   * that changed there is a count. Renaming that file would have cost every anchor that points into
   * it — the mutation table's rows, four dispatches' citations — to correct an arithmetic fact its
   * own `expect(offered).toEqual([...TOOL_NAMES])` already states better than its title does.
   *
   * **It is a READER, so §5's *"no published tool queues work"* census is untouched by it**: it
   * names exactly which resource it wants and returns its content. It hands nobody anything to do.
   */
  'read_document',
  /**
   * **The seventh — S2, and the one the PO held the worker text for** (393, HO-007 S2, HO-017 §3).
   *
   * **It takes no destination and there is no spelling of one it accepts.** HO-015 §1.3: *"the
   * runtime derives and validates the destination from the durable task edge. The model names which
   * task it is finishing, never who to send it to."* A piece's giver is on its row (D-016), and the
   * refusal for an addressing argument is a rail of its own shape — see the tool's own note on `371`.
   */
  'reply_to_parent',

  'list_tasks',

  'answer_question',
  /**
   * **The tenth — S5** (395, HO-007 S5).
   *
   * **It stops what a conversation below the caller is doing** — one it started, or one further
   * down that chain (D-014). No grant is asked: the chain is the whole entitlement.
   *
   * **It is NOT a READER**, so §5's *"no published tool queues work"* census applies to it. It
   * hands nobody anything to do: it takes away the thing that was being done.
   *
   * **And it answers `asked`, never `stopped`.** The two providers differ in kind here — Claude
   * forces the local terminal, Codex asks and awaits an answer the provider may never send — so a tool that
   * claimed the work had ended would be false on one of them. See {@link RuntimeHost.interruptAgent}.
   */
  'interrupt_agent',

  'list_questions',

  'create_agent',

  'withdraw_task',
  // **APPENDED and never inserted** (437) — five tests pin the index of a name in this list, so a
  // new member goes on the end whatever it is about.
  //
  // **611 · RENAMED IN PLACE, and a rename is not an insertion** (HO-088 §2). It was
  // `ask_parent` until the verb took a recipient; the name said which edge the question travelled,
  // and the verb now has two — so the name was a claim that had stopped being true
  // (`a-column-name-is-a-claim`, at a tool). **The POSITION is unchanged**, which is what the
  // rule above is about: every index a test pins still names the same verb.
  'ask_question',

  'list_profiles',

  'propose_agent_rules',

  'pass_question_up',
  // **D-009 · F012** — the asker takes back a question it asked (ruling 5). Appended: the
  // roster's order is pinned by index.
  'withdraw_question',
  // **D-012 · a giver reads a conversation below it** (proposal §6.5) — its last exchange and its
  // turns, a few back or by a search. **D-024 · R2 — and its own profile's other conversations.**
  // A READER, like `read_document`: it hands nobody anything.
  'read_transcript',
  /**
   * **D-016 · name a piece, say where it stands, give it a new brief, close it, or keep files for
   * it** (plan ruling 7; R1, R2).
   *
   * **APPENDED and never inserted**, on this list's standing rule. A title, a status line and
   * the files a piece's owner made for it are written down and sent to nobody; a new brief, a close
   * and the files its giver hands over are written down and reach the agent holding the piece — the
   * new brief as a message of its own, in the giver's words — and wake it, as `message_agent` and
   * `withdraw_task` wake one. **§5's census is untouched by it**: it names the piece, so the
   * agent anything reaches is the one holding it, and it gives no piece and starts no conversation.
   */
  'update_work',
  /**
   * **D-016 · commit 6 · a request the person makes, taken on as a piece that waits on them**
   * (plan ruling 6; R1).
   *
   * **APPENDED and never inserted**, on this list's standing rule. It opens a piece under the
   * caller's own root, given by the person, and hands nobody anything: **§5's *"no published tool
   * queues work"* census is untouched by it** — it names no agent and no piece, sends nothing and
   * queues nothing; its only subject is the caller's own work.
   */
  'take_on_work',
  'search_work',
  /**
   * **D-037 · find the files this app keeps — on the caller's tree or everywhere** (F048).
   *
   * **APPENDED, on this list's standing rule, and a READER** like `read_document`: it hands nobody
   * anything to do, so §5's census is untouched by it. Kept files are the work's shared
   * documentation, so an agent asked to look into something can first find what another already
   * wrote.
   */
  'find_files',
  /**
   * Brings an archived conversation back to the lists, as a person's Restore does. It sends
   * nothing of its own, so it hands nobody anything to do: a conversation that held messages or a
   * schedule when it was archived carries on with them.
   */
  'restore_agent',
  /**
   * Asks the person to register an external MCP server. It writes a request and contacts nothing;
   * only the person's press registers anything. It hands nobody work.
   */
  'request_mcp_server',
  /**
   * Asks the person to do something, as a to-do in their queue, with files. It writes a request
   * and hands nobody work: the person answers Done or Can't do it, and the agent that asked is told.
   */
  'request_action',
  ...THEME_TOOL_NAMES,
  'search_past_work',
  'read_agent_rules',
  'write_agent_rules',
  'read_own_notes',
  'write_own_notes',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/**
 * One caller-visible closed vocabulary, with one complete sentence for every member.
 *
 * The member list is the schema and the sentence table is checked against that list. Adding a
 * member without teaching the caller what it means is therefore a compile error rather than one
 * more failed first call. {@link documentedToolEnum} turns the same data into the JSON Schema and
 * its description; the handler keeps its own structured-refusal validation.
 */
interface ToolInputVocabulary<Member extends string> {
  readonly members: readonly [Member, ...Member[]]
  readonly sentences: Readonly<Record<Member, string>>
}

const toolInputVocabulary = <const Members extends readonly [string, ...string[]]>(
  members: Members,
  sentences: Readonly<Record<Members[number], string>>,
): ToolInputVocabulary<Members[number]> => ({ members, sentences })

// The kind of agent create_agent makes: one with separate workers, or a service.
const AGENT_KIND_INPUT = toolInputVocabulary(['normal', 'service'] as const, {
  normal: "'normal', the default: separate workers for each caller.",
  service: "'service': one conversation. Work runs one piece at a time.",
})

// Zod exposes `.options` as an array even though `z.enum` proves it non-empty at construction.
const PROVIDER_INPUT = toolInputVocabulary(
  providerSchema.options as [Provider, ...Provider[]],
  providerRecord((provider) => providerDescriptor(provider).words.providerChoice),
)

// **D-037 · where `find_files` looks** — the caller's tree, or every piece this app keeps files for.
export const FIND_WHERE_INPUT = toolInputVocabulary(['tree', 'everywhere'] as const, {
  tree: "'tree', the default, is the work you hold or gave and everything under it — what the Files tab of your conversation shows.",
  everywhere: "'everywhere' is every piece this app keeps files for, whoever made the file.",
})

// **Which rows `list_tasks` and `list_questions` list**: what is open, what is over, or both.
export const LISTING_INPUT = toolInputVocabulary(['open', 'ended', 'all'] as const, {
  open: "'open', the default, is what is still open or waiting, with a count of the rest.",
  ended: "'ended' is only what is over, a line each, newest first.",
  all: "'all' is what is open, then what is over, a line each, newest first.",
})

// whose answer comes back.
const MESSAGE_KIND_INPUT = toolInputVocabulary(AGENT_MESSAGE_KINDS, {
  note: "'note' tells it something for its information; no reply is expected.",
  'follow-up': "'follow-up' adds to a piece of work you gave it, which you name.",
})

// `request_routed.to` has no room for.
const QUESTION_RECIPIENT_INPUT = toolInputVocabulary(
  QUESTION_RECIPIENTS as unknown as [QuestionRecipient, ...QuestionRecipient[]],
  RECIPIENT_MEANS,
)

// sentences `RECIPIENT_MEANS` already says for those two.
const PASS_UP_RECIPIENT_INPUT = toolInputVocabulary(
  PASS_UP_RECIPIENTS as unknown as [PassUpRecipient, ...PassUpRecipient[]],
  { 'the-parent': RECIPIENT_MEANS['the-parent'], 'a-person': RECIPIENT_MEANS['a-person'] },
)

// Who a requested MCP server would be for.
const MCP_REQUEST_WHO_INPUT = toolInputVocabulary(MCP_SERVER_REQUEST_WHO, {
  everyone: "'everyone': every agent in this app may use it.",
  'only-these-agents': "'only-these-agents': only the agents you list in agents.",
})

const TASK_OUTCOME_INPUT = toolInputVocabulary(TASK_OUTCOMES, {
  done: "'done' says the work was completed.",
  blocked: "'blocked' says the work is not complete and somebody else may be able to unblock it.",
  failed: "'failed' says the work is not complete and the agent has nothing further to try.",
})

const WORK_SEARCH_SCOPE_INPUT = toolInputVocabulary(WORK_SEARCH_SCOPES, {
  mine: "'mine' covers your profile's conversations.",
  'this-conversation': "'this-conversation' covers work you own or gave here.",
  all: "'all' covers this app's work.",
})

const WORK_SEARCH_STATE_INPUT = toolInputVocabulary(
  WORK_SEARCH_TASK_STATES,
  Object.fromEntries(
    WORK_SEARCH_TASK_STATES.map((state) => [state, `'${state}' means ${WORK_STATE_WORD[state]}.`]),
  ) as Readonly<Record<(typeof WORK_SEARCH_TASK_STATES)[number], string>>,
)

/**
 * Every enum-valued argument in the published toolset, as an addressable census.
 *
 * The keys name actual tool + argument call sites. Tests compare this inventory with both the
 * registered tool schemas and the calls to {@link documentedToolEnum}; a new argument cannot be
 * documented by merely importing a vocabulary and never using it.
 */
export const TOOL_INPUT_ENUMS = {
  'search_work:scope': WORK_SEARCH_SCOPE_INPUT,
  'search_work:state': WORK_SEARCH_STATE_INPUT,
  'message_agent:kind': MESSAGE_KIND_INPUT,
  'reply_to_parent:outcome': TASK_OUTCOME_INPUT,
  'create_agent:provider': PROVIDER_INPUT,
  'give_work:provider': PROVIDER_INPUT,
  'create_agent:kind': AGENT_KIND_INPUT,
  // **611 · ONE vocabulary, advertised on BOTH question verbs** (HO-088 §2.1, §3.2). Two
  // entries and not one shared name, because `TOOL_INPUT_ENUMS` is keyed by `verb:argument` and a
  // reader asking *what may this verb be sent* must find its own row.
  'ask_question:who_answers': QUESTION_RECIPIENT_INPUT,
  // **D-009 · no longer the same vocabulary**: a question is never passed to an agent by name.
  'pass_question_up:who_answers': PASS_UP_RECIPIENT_INPUT,
  'find_files:where': FIND_WHERE_INPUT,
  'list_tasks:state': LISTING_INPUT,
  'list_questions:state': LISTING_INPUT,
  'request_mcp_server:who_gets_it': MCP_REQUEST_WHO_INPUT,
} as const

/**
 * Advertise the members on both providers while preserving the app's structured malformed-request
 * answer for an unknown value. See {@link agentToolStringEnum} for the measured adapter boundary.
 */
export function documentedToolEnum<Member extends string>(
  vocabulary: ToolInputVocabulary<Member>,
  before: string,
  after = '',
): z.ZodType<unknown> {
  const memberSentences = vocabulary.members.map((member) => vocabulary.sentences[member]).join(' ')
  return agentToolStringEnum(vocabulary.members).describe(
    `${before} One of ${vocabulary.members.join(', ')}. ${memberSentences}${after === '' ? '' : ` ${after}`}`,
  )
}

/**
 * **Every spelling of *"send it to this one"*, refused as a set** (393 §2, HO-015 §1.3).
 *
 * **A blocklist here rather than a bare allow-list, because the refusal has to TEACH.** An
 * unknown key could be a typo; these are an intent, and a model that tried to aim a reply is told
 * why that is not an argument rather than being told its call was malformed. `371` shipped the
 * other failure — a `parentSessionId` silently overridden, *"enforcement was right and disclosure
 * was wrong, and the caller was told its argument was taken"* — and this is the correction stated
 * as a list.
 *
 * **Both spellings of each, because a model writes whichever its provider taught it.** A refusal
 * that fired on `session_id` and passed `sessionId` through would be a rail with a typo in it.
 */
export const REPLY_ADDRESSING_KEYS = [
  'to',
  'parent',
  'parent_id',
  'parentId',
  'parent_session',
  'parent_session_id',
  'parentSessionId',
  'session',
  'session_id',
  'sessionId',
  'recipient',
  'agent',
  'agent_id',
  'agentId',
] as const
