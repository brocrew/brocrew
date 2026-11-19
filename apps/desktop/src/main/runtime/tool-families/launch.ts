import { ABriefThatDidNotArrive, AGiveThatGaveNothing } from '../session-unavailable'
import { RecordWriteFailed } from '../record-write'
import { sendOverflowSaid } from '../send-overflow'
import { type AgentModelChoice } from '../../../shared/model-choice-contracts'
import {
  type AgentToolAnswer,
  type AgentToolDefinition,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import {
  CREATED_UNDER_ITS_PROFILE_NAME,
  ITS_RULES_ARE_SAVED,
  createdAndNamed,
} from '../agent-tool-answer-words'
import { type Caller } from '../conversation-caller'
import { HELD_FORMS_WITH_EXTENSIONS_SAID, MAX_RESOURCES_PER_REPLY } from '../../../shared/documents'
import {
  type NewAgent,
  PATH_SEGMENT_RULE,
  PROVIDER_NAME,
  isPathSegment,
} from '../../../shared/runtime-ipc'
import { OWN_INSTRUCTIONS_CHARS } from '../../../shared/own-instructions'
import { PIECE_TITLE_CHARS, pieceNumbersOf } from '../../../shared/piece-called'
import { type Provider, providerSchema } from '@brobot2/shared'
import { TOOL_INPUT_ENUMS, type ToolName, documentedToolEnum } from './catalog'
import { whatADeliveryMet } from './delivery'
import { WORK_FIELD_WORDS } from '../../../shared/work-fields'
import type { WhatItRunsOn } from '../spawn-rails'
import { aPairInWords } from '../../../shared/model-choice'
import { answer, itsLabelIsNotUsed, refusalAnswer, sendAnswer } from './answers'
import { carryRailRefusal, refuseTool, type PublishedRefusal } from './refusals'
import { clockTimeFrom } from '../../../shared/clock'
import { namedByItsWorkOnce } from './listings'
import { protectedPlaceSaid } from '../../../shared/work-folders'
import { z } from 'zod'

// Launch, creation and restore tools classify only their known failure types.

/**
 * **D-042 · R4 — what the helper's conversation runs on, said to the giver** (*"the give's answer
 * says what it now runs"*).
 *
 * **Rendered from {@link WhatItRunsOn}** — read off the conversation after the brief was handed
 * over — and never asserted about the mechanism (standing rule 8.2). A start says where its model
 * came from (R1's order); a give whose choice was not used says which half of what it named, and
 * why (F1, or a conversation that took its place on another provider). An effort its provider has
 * not reported is said as *requested* (R5), as `get_agent_status` says it. `''` only for a
 * conversation that has named no pair yet.
 */
export function whatItRunsOnSaid(runsOn: WhatItRunsOn): string {
  if (runsOn.model === null) return ''
  const { model, effort } = runsOn.named
  // *"Offers no effort levels"* only where the pair was named against the list — a start's, or
  // the one this give named; a conversation's own pair it left may be a row from before D-042 that
  // recorded no effort.
  const judged =
    runsOn.how === 'started' ||
    runsOn.how === 'switched' ||
    (runsOn.how === 'unchanged' && (model || effort))
  const pair =
    runsOn.effort === null
      ? `on “${runsOn.model}”${judged ? ', which offers no effort levels' : ''}`
      : `on “${runsOn.model}” at ${runsOn.effort} effort${runsOn.effortReported ? '' : ' (requested)'}`
  const unused = `so the ${model && effort ? 'model and effort' : model ? 'model' : 'effort'} you named ${model && effort ? 'were' : 'was'} not used`
  switch (runsOn.how) {
    case 'started':
      return `It runs ${pair} — ${whereItCameFromSaid(runsOn)}.`
    case 'switched':
      return `It now runs ${pair}, from this piece on.`
    case 'unchanged':
      return `It runs ${pair}.`
    case 'a-person-chose-it':
      return `It keeps running ${pair}: a person chose that for this conversation, ${unused}.`
    case 'another-provider':
      return `It runs ${pair}: the conversation that took its place runs on ${PROVIDER_NAME[runsOn.provider]}, ${unused}.`
  }
}

/**
 * **D-042 · R1's order, in words** — where a started conversation's MODEL came from, and the
 * effort said as the give's own only when the give named it.
 */
function whereItCameFromSaid(runsOn: WhatItRunsOn): string {
  const atYourEffort = runsOn.named.effort ? ', at the effort you named' : ''
  switch (runsOn.from) {
    case 'named':
      return runsOn.named.effort ? 'as you named' : 'the model you named'
    case 'its-default':
      return `its default${atYourEffort}`
    case 'the-last-pick':
      return `the model a person last picked for ${PROVIDER_NAME[runsOn.provider]}${atYourEffort}`
    case 'the-providers-default':
    case null:
      return `${PROVIDER_NAME[runsOn.provider]}’s default${atYourEffort}`
  }
}

interface CreateAgentArguments {
  /** The name. Folded, globally unique, and refused if it is taken in any spelling. */
  readonly profile_slug: string
  /**
   * Which provider its conversations run on, kept from its making — absent: the provider whose list
   * alone holds the model it names, else the creator's.
   */
  readonly provider?: Provider
  /**
   * **618 · the new identity's own standing rules, or absent** (`HO-078` §4).
   *
   * **The same name `propose_agent_rules` uses for the same thing**: a creation that called a rule
   * set something else would make a model translate between two spellings of one layer.
   *
   * **Optional, and staying optional is `HO-078` §4.3**: an agent creating another without rules
   * is the ordinary case. **Absent and `''` are NOT the same** — absent writes no version at all,
   * and an empty string writes a version that says *there are none*, which is a fact with a date and
   * an author. The door refuses neither; the answer says which happened.
   */
  readonly rules?: string
  /**
   * **D-042 · R2 — the model its new conversations start on: its default** — from the list a
   * person keeps for its provider, judged by the one seam (`model-rails.ts`).
   */
  readonly model?: string
  /** **D-042 · R2 — the effort its default runs at**, one that model offers. */
  readonly effort?: string
  /** A normal agent, absent, or a service: one conversation its callers share, one piece at a time. */
  readonly kind?: 'normal' | 'service'
}

const CREATE_SLUG_ARGUMENT = 'profile_slug' satisfies keyof CreateAgentArguments

const CREATE_PROVIDER_ARGUMENT = 'provider' satisfies keyof CreateAgentArguments

const CREATE_RULES_ARGUMENT = 'rules' satisfies keyof CreateAgentArguments

const CREATE_MODEL_ARGUMENT = 'model' satisfies keyof CreateAgentArguments

const CREATE_EFFORT_ARGUMENT = 'effort' satisfies keyof CreateAgentArguments

const CREATE_KIND_ARGUMENT = 'kind' satisfies keyof CreateAgentArguments

/**
 * **D-016 · every argument `give_work` advertises, as a TYPE** — `415`'s device: the
 * advertisement `satisfies` this interface, so *documented* and *read* cannot drift apart.
 *
 * **They are the door's own names, and the tool hands them over untouched**: `giveRequestSchema`
 * is `.strict()`, so an argument neither knows reaches it under its own spelling and is refused BY
 * NAME — `303` B's lesson, with no rename map between the two for a key to fall through.
 * A provider chooses the conversation, while model and effort choose what it runs on.
 * Approval mode still comes from the giver; this door never switches an existing provider.
 */
interface GiveWorkArguments {
  readonly definition_of_done: string
  /** The agent, by profile — as `list_profiles` names it. */
  readonly profile: string
  /** What the piece is called. */
  readonly title: string
  /** The work, as the agent is to be told it. */
  readonly brief: string
  /** The piece folder: a fresh conversation starts there; an existing one gets a grant. */
  readonly folder?: string
  /** "new", or the address of the conversation that continues the job. */
  readonly to?: string
  /** The job's name, for a new conversation. */
  readonly conversation_title?: string
  /** The caller's own task to hang this under, by label or id. */
  readonly under?: string
  /** The provider a new conversation runs on. */
  readonly provider?: Provider
  /** **D-016 · R2** — files handed over with the work, kept as the piece's inputs. */
  readonly inputs?: readonly string[]
  /** **D-042 · R4** — the model that conversation runs on, from this piece on. */
  readonly model?: string
  /** **D-042 · R4** — its reasoning effort, one that model offers. */
  readonly effort?: string
}

export function createGiveWorkTool(
  host: Pick<AgentToolHost, 'giveWork' | 'receiptForSend'>,
  by: Caller,
  theModels: string,
  theEfforts: string,
  launchedOrSaid: (
    args: Record<string, unknown>,
    run: () => Promise<AgentToolAnswer>,
  ) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'give_work',
    handlerOwnsMissingInput: true,
    description:
      'Give a profile a task. The to field says where it goes. A conversation address adds the task there. "new" starts a new conversation for a new job and requires conversation_title. A service has one conversation, so name its profile and leave to out. Use under for your task this belongs to. Every valid give records the task before starting its provider. Anything over 2,000 characters arrives as a file the reader is pointed to. An existing conversation keeps its provider. Its model and effort can change from this task on unless the person set either, then it keeps both. The receipt names who received the task, the conversation address and whether it was sent or held.',
    /**
     * **486 · a person is asked as well** (HO-031 §2.4) — as `spawn_agent` was.
     *
     * **It can launch a provider CLI child and spend somebody's account on it.** `SPAWN_RAILS`
     * answer *may you*; none of them answers *should you, now*, and nothing in this roster
     * un-spends a turn. HO-031 §2.4's own criterion read literally — *permissions are for acts
     * that reach outside this app* — and it is the only verb here that can.
     */
    beyondItsRails: 'it-starts-something-outside-this-app',
    input: Object.fromEntries(
      Object.entries({
        profile: z
          .string()
          .describe(
            'Which agent to give it to — a name list_profiles gives. It must exist; create_agent makes one.',
          ),
        title: z
          .string()
          .describe(
            `What the task is called: one line, at most ${String(PIECE_TITLE_CHARS)} characters.`,
          ),
        definition_of_done: z.string().describe(WORK_FIELD_WORDS.condition),
        brief: z.string().describe(WORK_FIELD_WORDS.brief),
        folder: z
          .string()
          .optional()
          .describe(
            "A folder for this task: any that exists; a relative path is read from your own working directory. A new conversation works in the task's folder, or else your working directory. An existing conversation keeps its own working folder and may also use the task's folder while the task is open.",
          ),
        to: z
          .string()
          .optional()
          .describe(
            'Where the task goes: "new" for a new conversation of that profile, or a conversation by any of its task labels (W4.1621). Required, except for a service. A label names that task’s conversation: the work becomes a new task there, and the labelled task keeps its outcome.',
          ),
        conversation_title: z
          .string()
          .optional()
          .describe(
            'With to: "new", the new conversation’s title: the job, not this task, short, distinguishing word first ("DEV-78078", "Lisbon trip, March"). Required with to: "new"; leave it out otherwise.',
          ),
        under: z
          .string()
          .optional()
          .describe(
            'Your own task this belongs to, by its label (W1.2) or id. Leave it out to put it under the one task you hold — holding several, the one the words that began this turn were about; holding none, your own conversation’s work. A task whose brief has not reached you yet is never chosen for you. list_tasks names them.',
          ),
        provider: documentedToolEnum(
          TOOL_INPUT_ENUMS['give_work:provider'],
          'Which provider a new conversation runs on. Leave it out to use the named model’s provider, else the profile’s default. An existing conversation keeps its provider.',
          'Leave it out for the named model’s provider, else the profile’s default.',
        ).optional(),
        inputs: z
          .array(z.string())
          .optional()
          .describe(
            `Files to hand over with the work, at most ${String(MAX_RESOURCES_PER_REPLY)} — ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere; a relative path is read from your own working directory. Each is copied and hashed and kept as one of the piece\u2019s inputs, and the brief names each by its id; one that cannot be kept refuses the whole give, and nothing is given.`,
          ),
        model: z
          .string()
          .optional()
          .describe(
            'The model from this task on, from the list a person keeps for its provider (an alias such as opus stands for the model it points at). Leave it out: a new conversation starts on the profile’s default, an existing one keeps what it runs on.' +
              theModels,
          ),
        effort: z
          .string()
          .optional()
          .describe(
            'The reasoning effort, one that model offers. Leave it out to keep its effort when the model offers it, else the model\u2019s own default.' +
              theEfforts,
          ),
      } satisfies Readonly<Record<keyof GiveWorkArguments, z.ZodType>>).map(([field, schema]) => [
        field,
        agentToolHandlerInput(schema),
      ]),
    ),
    call: (args) =>
      launchedOrSaid(args, async () => {
        args = toolArgumentsAtHandler(args)
        // **Handed to the door VERBATIM, and NOT re-shaped into a narrower object.** `303` B
        // measured a command arriving with eight keys and parsing to seven; the door's schema is
        // `.strict()`, so a key it does not know is refused BY NAME — which is only true while this
        // layer strips nothing on the way.
        let given: Awaited<ReturnType<AgentToolHost['giveWork']>>
        try {
          given = await host.giveWork(args, by)
        } catch (error) {
          if (error instanceof RecordWriteFailed) {
            return refusalAnswer({
              ...refuseTool('work-record-unavailable'),
              reason: 'This conversation could not save the change.',
            })
          }
          // **A give that took its label and gave nothing** says so, after what failed: the
          // label is not handed out again, and nothing is called by it.
          if (error instanceof AGiveThatGaveNothing) {
            const failed = error.cause
            return itsLabelIsNotUsed(
              failed instanceof ABriefThatDidNotArrive
                ? whatADeliveryMet(failed.cause, failed.to, 'give_work')
                : await launchedOrSaid(args, () => Promise.reject(failed)),
              error.label,
            )
          }
          // **A brief that did not arrive is a DELIVERY's failure**, answered as `message_agent`
          // answers one; anything else — a launch that did not start among it — goes on to
          // {@link launchedOrSaid}, which classifies a launch and lets the rest propagate.
          if (error instanceof ABriefThatDidNotArrive) {
            return whatADeliveryMet(error.cause, error.to, 'give_work')
          }
          throw error
        }
        if (!given.ok) {
          const { refusal } = given
          // **D-016 · a file that could not be kept** — a `ResourceRefusal` is already
          // `341`-shaped and carries `outcome`, so it is spread unchanged, as `carryReplyRefusal`
          // spreads it.
          const carried = 'outcome' in refusal ? { ...refusal } : carryRailRefusal(refusal)
          return answer(carried, `refused (${refusal.rail}): ${refusal.reason}`)
        }
        const { receipt, said } = host.receiptForSend({
          recorded: { kind: 'task', id: given.piece, taskLabel: given.label },
          to: given.owner,
          profile: given.profile,
          state: given.recipientState,
          attachments: given.inputs.map((file) => {
            const overflow = given.overflow?.find((part) => part.file.resource === file.resource)
            return overflow === undefined ? file : { ...file, overflowField: overflow.field }
          }),
        })
        const folder = given.givenFolder
        const folderProblem =
          given.folderNotGranted === null ? '' : ` Folder could not be granted: ${given.folderNotGranted}.`
        const notice =
          folder?.notice === undefined ? '' : ` ${protectedPlaceSaid(folder.folder, folder.notice)}`
        const stalled = given.stalled ?? []
        const overflow = given.overflow?.map(sendOverflowSaid).join('') ?? ''
        return answer(
          {
            outcome: 'ok',
            piece: given.piece,
            label: given.label,
            agent: given.owner,
            profile: given.profile,
            delivery: given.delivery,
            receipt,
            started: given.runsOn.how === 'started',
            runs_on: { model: given.runsOn.model, effort: given.runsOn.effort },
            ...(given.queuedBehind === undefined ? {} : { queued_behind: given.queuedBehind }),
            ...(given.inputs.length === 0 ? {} : { inputs: given.inputs }),
            ...(folder === null ? {} : { folder }),
            ...(given.grantReach === null ? {} : { folder_reach: given.grantReach }),
            ...(stalled.length === 0 ? {} : { stalled: stalled.map((one) => one.label) }),
          },
          said + folderProblem + notice + overflow,
        )
      }).then(sendAnswer),
  }
}

export function createCreateAgentTool(
  host: Pick<AgentToolHost, 'createAgentFor' | 'judgeTheDefaultItNames' | 'mayCreateAgents'>,
  by: Caller,
  me: string,
  theModels: string,
  theEfforts: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  const notCreated = (refusal: PublishedRefusal): AgentToolAnswer => {
    const reason = `Not sent: ${refusal.reason}`
    return answer({ ...refusal, reason }, reason)
  }
  return {
    name: 'create_agent',

    description:
      'Bring a new agent into existence: a name, and optionally the standing rules it works under. No conversation is started, nothing is sent, and no purpose is recorded — the job goes in a piece of work you give it with give_work, while rules are what this agent is in every conversation it ever runs. This app gives the new agent its human name and tells you what it chose, so there is nothing to decide and nobody to ask. Returns the agent that now exists, or a refusal naming the rule that stopped it. Name model and effort to give it a default: what its new conversations start on.',
    /**
     * **Advertised against a TYPE, so *documented* and *read* cannot drift apart** — `415`'s
     * device, and the `satisfies` below fails to compile if this shape and
     * {@link CreateAgentArguments} stop naming the same set, in either direction.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      profile_slug: z
        .string()
        .describe(
          `The name the agent will be known by — ${PATH_SEGMENT_RULE}. It is compared without ` +
            'case, and a name that is already an agent is refused rather than reused. It is the ' +
            'same value give_work takes as profile.',
        ),
      /**
       * **The published enum and the door's validator are deliberately two layers** (`490`).
       * The shared schema advertises the closed vocabulary but preserves an unknown original
       * value, so the all-at-once structured refusal below still names what the caller may send.
       */
      provider: documentedToolEnum(
        TOOL_INPUT_ENUMS['create_agent:provider'],
        'The default provider for its conversations. A give can choose another provider without changing this default.',
        'Omit it to take the provider of the model you name, else yours.',
      ).optional(),

      rules: z
        .string()
        .describe(
          'The standing rules this agent works under — the text it is given at the start of every conversation it runs, for as long as they stand. ' +
            `At most ${String(OWN_INSTRUCTIONS_CHARS)} characters. ` +
            'This is what the agent IS, not the job you are about to give it: a job goes in a piece of work you give it with give_work. ' +
            'You write these here, as you create it. After that, you — from any conversation of your profile — and the person can change them; others can propose changes. ' +
            'Leave it out if you have none; an agent created without rules is the ordinary case and works exactly as it always has.',
        )
        .optional(),
      model: z
        .string()
        .optional()
        .describe(
          'The model its new conversations start on — its default — from the list a person keeps for its provider (provider; without it, the provider whose list holds this model, else yours). Leave it out and they start on the model a person last picked for that provider, else the provider\u2019s default.' +
            theModels,
        ),
      effort: z
        .string()
        .optional()
        .describe(
          'The reasoning effort its new conversations start at, one that model offers.' +
            theEfforts,
        ),
      kind: documentedToolEnum(
        TOOL_INPUT_ENUMS['create_agent:kind'],
        'What kind of agent it is, set when it is made.',
        'A service can be made only while a person has services on.',
      ).optional(),
    } satisfies Readonly<Record<keyof CreateAgentArguments, z.ZodType>>,
    call: (args) =>
      guarded(async () => {
        const wall = host.mayCreateAgents(me)
        if (!wall.ok) return notCreated(refuseTool(wall.rail, wall.detail))
        // **Every problem at once, never the first one** (325). A model that has to discover
        // three malformed arguments one round trip at a time is a model spending three turns on
        // one call, and the refusal is permanent for each of them anyway.
        const problems: string[] = []
        const slug = args[CREATE_SLUG_ARGUMENT]
        if (typeof slug !== 'string' || !isPathSegment(slug)) {
          problems.push(`${CREATE_SLUG_ARGUMENT} is required and must be ${PATH_SEGMENT_RULE}`)
        }
        const provider = args[CREATE_PROVIDER_ARGUMENT]
        if (provider !== undefined && !providerSchema.safeParse(provider).success) {
          problems.push(
            `${CREATE_PROVIDER_ARGUMENT} must be one of ${providerSchema.options.join(', ')}, or left out`,
          )
        }
        const rules = args[CREATE_RULES_ARGUMENT]
        if (
          rules !== undefined &&
          (typeof rules !== 'string' || rules.length > OWN_INSTRUCTIONS_CHARS)
        ) {
          problems.push(
            `${CREATE_RULES_ARGUMENT} must be a string of at most ${String(OWN_INSTRUCTIONS_CHARS)} characters, or left out`,
          )
        }
        // **D-042 · the default's two halves, shaped as the give's door shapes them.**
        const model = args[CREATE_MODEL_ARGUMENT]
        if (
          model !== undefined &&
          (typeof model !== 'string' || model.trim() === '' || model.length > 120)
        ) {
          problems.push(
            `${CREATE_MODEL_ARGUMENT} must be a model's name of at most 120 characters, or left out`,
          )
        }
        const effort = args[CREATE_EFFORT_ARGUMENT]
        if (
          effort !== undefined &&
          (typeof effort !== 'string' || effort.trim() === '' || effort.length > 60)
        ) {
          problems.push(
            `${CREATE_EFFORT_ARGUMENT} must be an effort's name of at most 60 characters, or left out`,
          )
        }
        const kind = args[CREATE_KIND_ARGUMENT]
        if (kind !== undefined && kind !== 'normal' && kind !== 'service') {
          problems.push(`${CREATE_KIND_ARGUMENT} must be one of normal, service, or left out`)
        }
        if (problems.length > 0) {
          return notCreated(refuseTool('malformed-request', { problems }))
        }
        // **D-042 · R4 — the default it names, judged by the one seam** (`model-rails.ts`: the
        // list, then the model's efforts) — above the mint, so a refused default creates nothing.
        let itsDefault: AgentModelChoice | null = null
        if (model !== undefined || effort !== undefined) {
          const judged = await host.judgeTheDefaultItNames(
            me,
            provider === undefined ? null : (provider as Provider),
            {
              ...(model === undefined ? {} : { model: model as string }),
              ...(effort === undefined ? {} : { effort: effort as string }),
            },
          )
          if (!judged.ok) return notCreated(judged.refusal)
          itsDefault = judged.chosen
        }
        const said: NewAgent = {
          slug: slug as string,
          // **584 · ALWAYS null from this door, and that is the ruling rather than a default**
          // (`HO-078` §5). There is no argument to read: the app assigns the name inside
          // `SessionStore.createAgentIdentity`, which falls through to `human-names.ts` for
          // exactly this value. **`NewAgent` keeps the field because the PERSON's door still
          // fills it** — `NewAgent.vue` sends what somebody typed — so the two creation doors
          // differ in what they may say rather than in what the store does with it.
          displayName: null,
          provider: provider === undefined ? null : (provider as Provider),
          ...(kind === 'service' ? { asAService: true as const } : {}),
        }
        // **618 · `null` and not `undefined` across the boundary**, so the host's parameter is
        // required and there is no default for a call site to fall through
        // (`a-default-no-call-site-reaches`): *nobody sent any* is a value this door computes,
        // once, from the only argument that can say it.
        const outcome = host.createAgentFor(
          me,
          said,
          by,
          rules === undefined ? null : (rules as string),
          itsDefault,
        )
        if (!outcome.ok) return notCreated(refuseTool(outcome.rail, outcome.detail))
        const named = outcome.identity.displayName
        // **618 · what the RULES did, computed from the outcome and said in both halves**
        // (`a-report-must-be-computed-from-the-outcome`, and `489`/HO-031 §2.6's one
        // composition).
        //
        // **A key that is ALWAYS there, never an absent one meaning *none*.** An answer whose
        // *nothing was written* is the absence of a field is
        // `an-unenumerated-state-counts-as-success` — a caller reading its own argument back
        // instead of this app's answer is exactly the drift this pair exists to stop.
        //
        // **Whether rules were written is READ off the outcome rather than off the argument.**
        // The version number (1 on every path this door can take) is not said.
        const wrote = outcome.rules
        return answer(
          {
            outcome: 'ok',
            agent: outcome.identity.slug,
            identity: outcome.identity.id,
            ...(named === null ? {} : { display_name: named }),
            rules: wrote === null ? 'none-given' : 'written',
            ...(outcome.defaultModel === null ? {} : { default_model: outcome.defaultModel }),
          },
          // Read off the outcome, never echoing the call: the name this app chose, that nothing
          // was started, its default, and whether its rules are saved.
          `${named === null ? CREATED_UNDER_ITS_PROFILE_NAME : createdAndNamed(named)} It is not running and has been sent nothing.${
            // **D-042 · R2 — the default it now has, read back**.
            outcome.defaultModel === null
              ? ''
              : ` Its new conversations start on ${aPairInWords(outcome.defaultModel)}.`
          }${wrote === null ? '' : ` ${ITS_RULES_ARE_SAVED}`}`,
        )
      }),
  }
}

export function createRestoreAgentTool(
  host: Pick<AgentToolHost, 'addressOf' | 'nameByItsWorkUnder' | 'restoreAsAnAgent'>,
  by: Caller,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'restore_agent',
    description:
      'Bring an archived conversation back: it shows again in the person’s lists and in list_agents, with the helpers archived with it. This sends it nothing, and its transcript says that you restored it, so the person sees who did. It carries on as when a person restores it: one that held messages when it was archived starts to take them, one with a schedule wakes for it, and any other stays stopped. So restoring a conversation that held a message or a schedule starts it and spends a turn; the answer says which. To only read an archived conversation, do not restore it: list_agents with archived: true finds it, and read_transcript reads it where it could before it was archived. Restore only what your work needs: a person archived it to put it away. Name it by the piece it owns (W1.2) or by its id; list_agents with archived: true lists the archived conversations. To restore one and tell it something in the same act, send it a message or give it work instead: whatever is sent to an archived conversation brings it back.',
    /**
     * A person's Restore, asked by an agent. It sends nothing of its own: what starts is only
     * what the app starts for words and jobs the conversation already held, as a message to a
     * stopped one does. The host's own refusals are the whole gate, and any archived
     * conversation may be restored.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: {
      agent: z
        .string()
        .describe(
          'The archived conversation, by the piece it owns (W1.2) or by its id from list_agents with archived: true.',
        ),
    },
    call: (args) =>
      guarded(async () => {
        if (typeof args.agent !== 'string' || args.agent.length === 0) {
          return refusalAnswer(refuseTool('malformed-request', { problems: ['agent is required'] }))
        }
        const restored = host.restoreAsAnAgent(args.agent, by, me)
        if (restored.is === 'no-such-agent') {
          return refusalAnswer(refuseTool('no-such-agent', { agent: args.agent }))
        }
        if (restored.is === 'not-archived') {
          return refusalAnswer(
            refuseTool('that-conversation-is-not-archived', { agent: args.agent }),
          )
        }
        if (restored.is === 'being-set-aside' || restored.is === 'could-not') {
          return refusalAnswer(
            refuseTool(
              restored.is === 'could-not'
                ? 'it-could-not-be-restored'
                : 'it-is-being-archived-or-deleted',
              { agent: args.agent, said: restored.said },
            ),
          )
        }
        const called = namedByItsWorkOnce(host)
        /** One restored conversation, and how it carries on, in a line. */
        const line = ({ conversation, carriesOn }: (typeof restored.conversations)[number]) => {
          // One that holds no piece is named with its address too, as `name, address`.
          const address = host.addressOf(conversation)
          const name =
            pieceNumbersOf(address) === null
              ? `${called(conversation, null)}, ${address}`
              : called(conversation, null)
          if (carriesOn === null) return `${name}: stays stopped until something starts it`
          return carriesOn === 'starting'
            ? `${name}: starting now, for what it held when it was archived`
            : `${name}: wakes at ${clockTimeFrom(carriesOn.wakesAt, restored.readAt)} for its schedule`
        }
        const many = restored.conversations.length > 1
        return answer(
          {
            outcome: 'ok',
            restored: restored.conversations.map(({ conversation, carriesOn }) => ({
              agent: conversation,
              carries_on:
                carriesOn === null
                  ? 'stopped'
                  : carriesOn === 'starting'
                    ? 'starting'
                    : `wakes at ${clockTimeFrom(carriesOn.wakesAt, restored.readAt)}`,
            })),
          },
          [
            `restored, back in the lists; you sent ${many ? 'them' : 'it'} nothing, and ${
              many ? 'their transcripts say' : 'its transcript says'
            } you restored ${many ? 'them' : 'it'}:`,
            ...restored.conversations.map(line),
          ].join('\n'),
        )
      }),
  }
}
