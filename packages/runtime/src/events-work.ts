import { z } from 'zod'
import { MAX_BACKGROUND_ID, MAX_BACKGROUND_TEXT, MAX_BACKGROUND_WORK } from './background-work'
import { MAX_WORKFLOW_AGENTS, MAX_WORKFLOW_DESCRIPTION, MAX_WORKFLOW_TEXT } from './workflow-run'
import {
  MAX_SCHEDULED_JOBS,
  MAX_SCHEDULE_PROMPT,
  MAX_SCHEDULE_TEXT,
  NOT_STARTED_BECAUSE,
} from './scheduled-work'
import {
  MAX_COMMAND_ALIASES,
  MAX_COMMAND_NAME,
  MAX_COMMAND_TEXT,
  MAX_SKILL_PATH,
  MAX_SKILL_SCOPE,
  MAX_PROVIDER_COMMANDS,
} from './provider-commands'
import {
  MAX_DECLARED_TOOLS,
  MAX_PUBLISHED_SERVERS,
  MAX_PUBLISHED_TOOLS,
  MAX_STATUS_WORD,
  MAX_TOOL_NAME,
  MAX_TOOL_PARAMETERS,
  MAX_TOOL_TEXT,
} from './tool-inventory'
import {
  MAX_RECALL_ENTRIES,
  MAX_RECALL_NOTE,
  MAX_RECALL_PATH,
  MAX_RECALL_THREADS,
  MAX_THREAD_ID,
} from './memory-recall'

/**
 * Represent a dynamic workflow explicitly so its frames are visible in normal mode.
 *
 * One event per wire frame, folded onto the anchoring `Workflow` tool call and **merged in place**:
 * the nine frames of the reproduction run mutate one tree and add no transcript rows (078's rule).
 * See `workflow-run.ts` for the measurements that fixed the shape — in particular why `agents` and
 * `phases` are optional rather than defaulted to `[]`, and which two wire fields are deliberately
 * not carried.
 *
 * ⚠️ **`agents: []` and no `agents` key are different events and the fold reads them differently.**
 * 19 of 41 measured progress frames carry no roster at all; if this schema defaulted the field, every
 * one of them would arrive claiming the run has zero agents and the tree would strobe. zod would
 * happily have done that for us, which is why it is stated here rather than assumed.
 *
 * `source` is the provider's own signal name (`task_started`, `task_progress`, `task_notification`),
 * opaque here exactly as `unknown.label` is — so a reader can see WHICH wire fact a row came from.
 */
export const workflowRunEventSchema = z.object({
  type: z.literal('workflow_run'),
  /** `task_id`. The correlation key, and the ONLY one `task_updated` carries. */
  taskId: z.string().max(200),
  /** The `Workflow` tool call this hangs off. Absent on `task_updated`, which sends no id at all. */
  toolUseId: z.string().max(200).optional(),
  /**
   * ⛔ **`MAX_WORKFLOW_TEXT`, not 200, on every field a producer can WRITE** (299 §2). The
   * normalizer bounds these with `truncate`, which appends an ellipsis — so a `.max(200)` here
   * would reject exactly the strings that had just been bounded. See {@link MAX_WORKFLOW_TEXT} for
   * the delete this pair replaces, and note which fields do NOT get it: `taskId`, `toolUseId` and
   * `agentId` are IDENTIFIERS, correlation is the whole mechanism, and a truncated id is a wrong id
   * rather than a shortened one.
   */
  name: z.string().max(MAX_WORKFLOW_TEXT).optional(),
  description: z.string().max(MAX_WORKFLOW_DESCRIPTION).optional(),
  phases: z
    .array(
      z.object({
        index: z.number().int().finite().nonnegative(),
        title: z.string().max(MAX_WORKFLOW_TEXT),
      }),
    )
    .optional(),
  agents: z
    .array(
      z.object({
        agentId: z.string().max(200),
        label: z.string().max(MAX_WORKFLOW_TEXT),
        phaseIndex: z.number().int().finite().nonnegative(),
        state: z.enum(['queued', 'running', 'done', 'failed', 'unknown']),
        model: z.string().max(MAX_WORKFLOW_TEXT).optional(),
        // Epoch milliseconds as the provider sent them. Not `.positive()`: these are only ever
        // compared and displayed, never divided, so there is no `Infinity` to guard against — the
        // reason `context_reading`'s window needed that guard and this does not.
        queuedAt: z.number().finite().optional(),
        startedAt: z.number().finite().optional(),
        attempt: z.number().int().finite().positive().optional(),
        lastTool: z.string().max(MAX_WORKFLOW_TEXT).optional(),
        lastToolSummary: z.string().max(MAX_WORKFLOW_TEXT).optional(),
        tokens: z.number().finite().nonnegative().optional(),
        toolCalls: z.number().finite().nonnegative().optional(),
        durationMs: z.number().finite().nonnegative().optional(),
      }),
    )
    .max(MAX_WORKFLOW_AGENTS)
    .optional(),
  usage: z
    .object({
      tokens: z.number().finite().nonnegative().optional(),
      toolCalls: z.number().finite().nonnegative().optional(),
      ms: z.number().finite().nonnegative().optional(),
    })
    .optional(),
  /** `unknown` is a real ending: the provider closed the run with a status we could not read. */
  outcome: z.enum(['completed', 'failed', 'unknown']).optional(),
  /** Absolute path the run wrote its answer to. Opened on request; never inlined (107 §4). */
  outputFile: z.string().max(4096).optional(),
  /** Agents past {@link MAX_WORKFLOW_AGENTS}. Absent or 0 normally; non-zero is said out loud. */
  droppedAgents: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})

/**
 * **What background work exists, and what just happened to it** (247) — see `background-work.ts`
 * for the measurement this shape was built from, and for why the two fields are separate.
 *
 * ⛔ **Both fields are optional and that is the design, not laxity.** `running` is a LEVEL the
 * provider states on its own frame; `ended` is an EDGE that names its own task. The SDK's doc for
 * `background_tasks_changed` says the payload *"carries ids only, so do not correlate it with the
 * edge stream"* — so an event produced by a level frame carries no ending, and one produced by an
 * ending carries no level. Filling either in from the other is exactly the pairing that wedges a
 * stale running indicator, and `222` is what that costs.
 *
 * ⚑ **`running` absent ≠ `running: []`.** Absent is *"this frame did not state the level"*; `[]` is
 * *"the provider says nothing is running"*, which is the fact that clears a registry. `workflow_run`'s
 * `agents` draws the same line for the same reason.
 */
export const backgroundWorkSchema = z.object({
  type: z.literal('background_work'),
  /** REPLACE, never merge. Every piece of live background work after this change. */
  running: z
    .array(
      z.object({
        id: z.string().max(MAX_BACKGROUND_ID),
        toolCallId: z.string().max(MAX_BACKGROUND_ID).optional(),
        kind: z.string().max(80).optional(),
        description: z.string().max(MAX_BACKGROUND_TEXT).optional(),
      }),
    )
    .max(MAX_BACKGROUND_WORK)
    .optional(),
  /** One piece of work ended, as the provider reported it on a frame carrying its own identity. */
  ended: z
    .object({
      id: z.string().max(MAX_BACKGROUND_ID),
      toolCallId: z.string().max(MAX_BACKGROUND_ID).optional(),
      outcome: z.enum(['completed', 'failed', 'stopped', 'unknown']),
      summary: z.string().max(MAX_BACKGROUND_TEXT).optional(),
      outputFile: z.string().max(4096).optional(),
    })
    .optional(),
  /**
   * Rows the level payload carried that this event does not — **for any reason**, so a cap can never
   * be silent (092's rule, 096's precedent). Absent or 0 normally.
   *
   * ⚠️ **Two reasons, deliberately counted together**: entries past {@link MAX_BACKGROUND_WORK}, and
   * entries the provider sent with no id at all. The second is the one worth folding in rather than
   * dropping quietly — an entry with no id cannot be listed and cannot be stopped, so a registry
   * that simply showed one fewer row would be understating what is running with nothing to say so.
   * The `unknown{lifecycle}` frame beside this one still carries the payload verbatim either way.
   */
  dropped: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})

const scheduleText = z.string().min(1).max(MAX_SCHEDULE_TEXT)
const anInstant = z.number().int().nonnegative()

/** What every receipt carries: the call, when it ran, and the sub-agent it ran inside, if any. */
const receiptBase = {
  toolUseId: scheduleText,
  /**
   * When the provider was about to run the call, on this host's clock. Absent when it was not seen,
   * or when the clock moved between this and {@link answeredAt}, so the two cannot be compared.
   */
  calledAt: anInstant.optional(),
  /** When the provider reported the call's result, on this host's clock. */
  answeredAt: anInstant,
  /** The sub-agent the call ran inside; absent for the conversation's own calls. */
  childId: scheduleText.optional(),
  /**
   * The app's calendar as it kept the receipt: which one, and the version of its zone data. A
   * job's time is placed only on the calendar it was created under.
   */
  stamp: z.object({ calendar: scheduleText, version: z.string().min(1).max(16_384) }).optional(),
}

/**
 * **One scheduling call the provider ran, and what it answered**, read at its documented
 * `PostToolUse` hook: the input as it was executed, and the result in the tool's published shape.
 * ⚑ `result` is absent when the answer did not have that shape: the call happened, and what it did
 * is not known. ⚑ A call that failed runs no such hook, so it has no receipt. ⚑ No prompt is copied:
 * the tool call's own row holds it.
 */
const scheduleReceiptSchema = z.discriminatedUnion('tool', [
  z.object({
    ...receiptBase,
    tool: z.literal('CronCreate'),
    input: z
      .object({
        cron: scheduleText,
        recurring: z.boolean().optional(),
        durable: z.boolean().optional(),
      })
      .optional(),
    result: z
      .object({ id: scheduleText, recurring: z.boolean(), durable: z.boolean().optional() })
      .optional(),
  }),
  z.object({
    ...receiptBase,
    tool: z.literal('CronDelete'),
    input: z.object({ id: scheduleText }).optional(),
    result: z.object({ id: scheduleText }).optional(),
  }),
  z.object({
    ...receiptBase,
    tool: z.literal('CronList'),
    result: z
      .object({
        jobs: z
          .array(
            z.object({
              id: scheduleText,
              cron: scheduleText.optional(),
              recurring: z.boolean().optional(),
              durable: z.boolean().optional(),
            }),
          )
          .max(MAX_SCHEDULED_JOBS),
        /** Jobs the list carried that this receipt does not: past the cap, or with no id. */
        dropped: z.number().int().nonnegative().optional(),
      })
      .optional(),
  }),
  z.object({
    ...receiptBase,
    tool: z.literal('ScheduleWakeup'),
    input: z
      .object({ delaySeconds: z.number().nonnegative().optional(), stop: z.boolean().optional() })
      .optional(),
    result: z
      .object({
        /** When the wake-up will come, in epoch milliseconds, as the provider said; 0 on a stop. */
        scheduledFor: anInstant,
        stopped: z.boolean().optional(),
        cancelledWakeups: z.number().int().nonnegative().optional(),
      })
      .optional(),
  }),
])

/**
 * **What this session has promised to do later** (253) — see `scheduled-work.ts` for the
 * measurement, for why fires are deliberately not published, and for why there is no control.
 *
 * ⛔ **The only LEVEL in this taxonomy with no arm in either `normalize.ts`.** `session_crons` never
 * appears on the message stream: `250` proved that with a positive control — a cron row produced 0
 * of the 5 `task_*` frames a backgrounded `Bash` produced one row later in the same capture. It
 * arrives on the `Stop` hook, so its producer is `claude/session-crons.ts`, beside the callback.
 * ⚑ A row may carry one scheduling call's receipt instead, read at the tool hooks
 * (`claude/scheduling-calls.ts`); such a row states no level.
 *
 * ⚑ **Not the first provider fact to arrive off-stream, and the precedent is worth naming**:
 * `permission_request` comes from the `canUseTool` callback for the same structural reason. What is
 * new here is that the off-stream fact is a SET rather than a question.
 *
 * ⚑ **`jobs` absent ≠ `jobs: []`.** Absent is *"this frame did not state the level"*; `[]` is *"the
 * provider says nothing is scheduled"*, which is the fact that clears a registry. `workflow_run`'s
 * `agents` and `background_work`'s `running` draw the same line for the same reason.
 *
 * ⚠️ **There is no `fired` field, and that is the answer rather than an omission.** The only typed
 * label (`UserPromptSubmitHookInput.source`) is unset for external accounts, and the prompt cannot
 * stand in for it because the provider's copy is clipped at 1000 characters. A one-shot that has
 * fired is carried the honest way instead: it is simply gone from the next level.
 *
 * ⚑ **A second producer, the app's host**: it states the level it reads from the scheduling
 * calls' receipts and the provider's levels, its `source` naming the app — so a job is listed when
 * it is made and leaves when its cancellation is confirmed, without waiting for the turn's end.
 */
export const scheduledWorkSchema = z.object({
  type: z.literal('scheduled_work'),
  /** REPLACE, never merge. Every job that will wake this session, after this change. */
  jobs: z
    .array(
      z.object({
        id: z.string().max(MAX_SCHEDULE_TEXT),
        schedule: z.string().max(MAX_SCHEDULE_TEXT).optional(),
        recurring: z.boolean().optional(),
        prompt: z.string().max(MAX_SCHEDULE_PROMPT).optional(),
        /** The minute it will next run, where the app knows it; only its own levels carry it. */
        nominalAt: anInstant.optional(),
        /** Why the app does not start its conversation for it; only its own levels carry it. */
        notStarted: z.enum(NOT_STARTED_BECAUSE).optional(),
      }),
    )
    .max(MAX_SCHEDULED_JOBS)
    .optional(),
  /**
   * Rows the level carried that this event does not — **for any reason**, so a cap can never be
   * silent (092's rule, 096's precedent, 247's wording). Absent or 0 normally.
   *
   * ⚠️ Two reasons counted together, as `background_work.dropped` counts its two: entries past
   * {@link MAX_SCHEDULED_JOBS}, and entries the provider sent with no id. An entry with no id cannot
   * be told apart from any other, so a registry that simply showed one fewer row would be
   * understating what is scheduled with nothing to say so.
   */
  dropped: z.number().int().nonnegative().optional(),
  /**
   * One scheduling call the provider ran, read as it happened. A row that carries one states no
   * level (`jobs` absent): what it changed is the level's to say.
   */
  receipt: scheduleReceiptSchema.optional(),
  /**
   * The provider began a new conversation under this session just before this row (a
   * `conversation_reset`): written by the app, and it states no level. Whether a job from before
   * it is still scheduled is the provider's to say, in the next level it states.
   */
  reset: z.literal(true).optional(),
  source: z.string().max(120),
})

/**
 * **What the running agent will answer to** (279) — see `provider-commands.ts` for the measurement
 * both providers were asked for, and for why the two answers are not the same kind of thing.
 *
 * ⛔ **`commands` is REQUIRED, unlike every other level in this union, and that is the design.**
 * `background_work` and `scheduled_work` each carry an optional level because a second, independent
 * fact can ride the same event — an ending, in one case — so *"this frame did not state the level"*
 * has to be representable. This event has one payload and no reason to exist without it: a frame
 * that stated nothing is a frame nobody emits.
 *
 * ⚑ **The `undefined` ≠ `[]` distinction is not lost, it MOVED** — to the registry that folds this,
 * where it is the difference §2 asks to be told apart out loud: a session nobody has asked holds
 * `null` and must not be drawn as an agent with no commands, while `[]` is the provider's own answer
 * and may be.
 *
 * ⛔ **REPLACE, never merge**, on the SDK's own instruction: *"Clients should REPLACE their cached
 * command list with this payload."* A merge would make a skill deleted mid-session immortal, which
 * is `222`'s stale indicator wearing a different hat.
 */
export const providerCommandsSchema = z.object({
  type: z.literal('provider_commands'),
  /** Every command the agent has, after this change. REPLACE, never merge. */
  commands: z
    .array(
      z.object({
        name: z.string().max(MAX_COMMAND_NAME),
        description: z.string().max(MAX_COMMAND_TEXT).optional(),
        argumentHint: z.string().max(MAX_COMMAND_TEXT).optional(),
        aliases: z.array(z.string().max(MAX_COMMAND_NAME)).max(MAX_COMMAND_ALIASES).optional(),
        skill: z
          .object({
            path: z.string().max(MAX_SKILL_PATH),
            scope: z.string().max(MAX_SKILL_SCOPE),
            description: z.string().max(MAX_COMMAND_TEXT).optional(),
          })
          .optional(),
      }),
    )
    .max(MAX_PROVIDER_COMMANDS),
  /**
   * What a person types before a name — `/` for Claude, `$` for Codex, measured rather than styled.
   *
   * ⚠️ **On the event rather than on each row** — one fact about the provider, stated once. `169`
   * §1's rule: one rule spelled in N places drifts, and `248` had to go and fix five copies of one.
   */
  prefix: z.string().max(4),
  /**
   * Rows the provider named that this event does not carry — **for any reason**, so a cap can never
   * be silent (`092`'s rule, `096`'s precedent, `247`'s wording). Absent or 0 normally.
   *
   * ⚠️ Two reasons counted together, as its two siblings count theirs: entries past
   * {@link MAX_PROVIDER_COMMANDS}, and entries the provider sent with no usable name. A command with
   * no name cannot be typed and cannot be searched for, so a list that simply showed one fewer row
   * would be understating what the agent has with nothing to say so.
   */
  dropped: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})

/**
 * 🔴 **The tools this conversation has** (358) — see `tool-inventory.ts` for the two halves, for
 * why merging them would be a lie, and for the measurement behind every bound below.
 *
 * ⛔ **BOTH payload fields are REQUIRED and nullable, which is a different shape from every other
 * level in this union and is the whole design.** `provider_commands` makes `commands` required so
 * that *"we were not told"* can only be the ABSENCE of the event; this event needs THREE states,
 * not two, because Codex will never publish an inventory and *"the provider does not publish one"*
 * is permanently different from *"nobody has told us yet"*:
 *
 * | state | how it is expressed | what a surface must say |
 * |---|---|---|
 * | nobody has told us | **no event** — the registry stays `null` | *BroBot has not been told what this conversation has* |
 * | the provider publishes none | an event with `published: null` | *Codex does not report its inventory; these were offered* |
 * | the provider published | an event with `published: {…}` | the join — offered, and confirmed |
 *
 * ⚠️ **`null` is unforgeable in both directions because the fields are required.** An adapter
 * cannot reach the middle row by forgetting a field, and it cannot reach the top row at all — only
 * silence does that.
 *
 * ⛔ **REPLACE, never merge.** Claude re-publishes on every `system/init`, and `257` §0 measured a
 * scheduled job waking a session and emitting a second one on the same stream at 10 194 / 54 805 /
 * 114 037 ms. A merge would make a server that dropped out of the second frame immortal, which is
 * `222`'s stale indicator wearing a new hat.
 */
export const toolInventorySchema = z.object({
  type: z.literal('tool_inventory'),
  /**
   * ⛔ **How this provider spells a server's tool** — `{prefix:'mcp__', separator:'__'}` on Claude,
   * `{prefix:'', separator:'__'}` on Codex, both measured.
   *
   * ⚑ **On the event rather than worked out downstream, and `039` is why.** A renderer that decided
   * a spelling by recognising a provider is the exact shape `provider-neutrality.test.ts` refuses;
   * this is `provider_commands.prefix`'s idiom applied to a second fact, stated once by the adapter
   * that knows it.
   */
  naming: z.object({
    prefix: z.string().max(MAX_TOOL_NAME),
    separator: z.string().min(1).max(MAX_TOOL_NAME),
  }),
  /**
   * ⛔ **What BroBot HANDED this session** — offered, never proof. `null` where the adapter was
   * given no toolset at all, which on the two ordinary paths never happens (`runtime-host.ts`
   * declares them with no condition on either line, at start and at resume).
   */
  declared: z
    .object({
      server: z.string().max(MAX_TOOL_NAME),
      instructions: z.string().max(MAX_TOOL_TEXT).optional(),
      tools: z
        .array(
          z.object({
            name: z.string().max(MAX_TOOL_NAME),
            description: z.string().max(MAX_TOOL_TEXT),
            parameters: z
              .array(
                z.object({
                  name: z.string().max(MAX_TOOL_NAME),
                  type: z.string().max(MAX_TOOL_NAME),
                  required: z.boolean(),
                  description: z.string().max(MAX_TOOL_TEXT).optional(),
                }),
              )
              .max(MAX_TOOL_PARAMETERS),
          }),
        )
        .max(MAX_DECLARED_TOOLS),
    })
    .nullable(),
  /**
   * ⛔ **What the CHILD published about itself** — the only evidence in this event. `null` means the
   * provider publishes no inventory at all, which is Codex's permanent answer and is NOT the same
   * as an empty one.
   */
  published: z
    .object({
      /** Model-visible names, verbatim and provider-qualified. Built-ins and MCP tools in one list. */
      tools: z.array(z.string().max(MAX_TOOL_NAME)).max(MAX_PUBLISHED_TOOLS),
      servers: z
        .array(
          z.object({
            name: z.string().max(MAX_TOOL_NAME),
            /** ⛔ The provider's own word, NOT narrowed — see `PublishedServer.status`. */
            status: z.string().max(MAX_STATUS_WORD),
            connectionKind: z.string().max(MAX_STATUS_WORD).optional(),
          }),
        )
        .max(MAX_PUBLISHED_SERVERS),
    })
    .nullable(),
  /**
   * Rows either half named that this event does not carry — **for any reason**, so a cap can never
   * be silent (`092`'s rule, `247`'s wording). Absent or 0 normally.
   */
  dropped: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})

/**
 * Record the agent's claim that it read a memory source.
 *
 * ⛔ **This event exists because a measurement overturned a conclusion of mine.** 316 searched the
 * wire for a memory TOOL item, found none across fifteen config arms, and reported that a recall is
 * *"invisible, permanently"*. 318 went back with a control and found it on the item 316 had already
 * seen: `agentMessage.memoryCitation`, parsed by the app-server out of the model's own
 * `<oai-mem-citation>` block, stripped out of `text`, and dropped on the floor by
 * `codex/normalize.ts`, which read `text` and nothing else. Counting item TYPES could not see a
 * FIELD — a filter blinding the instrument that would have justified it.
 *
 * ## ⚠️ What it is a statement about, which is not what a tool call is a statement about
 *
 * A `tool_call` says *the provider reported this call*. This says *the agent said it used this*.
 * The app-server parsed the claim and structured it; it did not watch a file being read. Every
 * surface built on this has to survive that distinction — see `memory-recall.ts` for the three
 * rules that follow from it, the first of which is that {@link MemoryRecallEvent} paths are
 * displayed and never opened.
 *
 * ## ⛔ One provider, and the silence of the other is not a finding
 *
 * Only Codex publishes this at the pins this app ships. 318 measured that Claude's CLI preloads its
 * memory index into its own system prompt with no tool and no citation — and that its memory WRITES
 * are already visible as ordinary `Write`/`Edit` tool calls. So a Claude session emits none of
 * these, that is a fact about the provider rather than about the conversation, and no surface may
 * read a missing row as *"nothing was consulted"*.
 *
 * ## ⚠️ `null` is a real answer on the wire and is deliberately not an event here
 *
 * 318's control arm: a reply carrying no citation block still carries `memoryCitation`, **present
 * and `null`**. So *"no memory was consulted"* and *"this build does not report"* ARE distinguished
 * by the provider, and this app collapses both to no event on purpose. ⛔ A row under every answer
 * saying *"no memory was consulted"* is noise; a row saying *"unknown"* is the fabricated third
 * state 319 §1.3 forbids by name. The distinction survives where it can be used — in the probe that
 * measured it, and in this paragraph — rather than in a row nobody asked for.
 *
 * `source` is the provider's own field name, opaque here exactly as `unknown.label` is, so a reader
 * can see WHICH wire fact a row came from.
 */
export const memoryRecallSchema = z.object({
  type: z.literal('memory_recall'),
  /**
   * The files the agent cited, **in the model's own order of importance** — its instruction is
   * *"list entries in order of importance (most important first)"*, so this array is not re-sorted
   * anywhere. Never empty: an event with nothing to name is not emitted.
   */
  entries: z
    .array(
      z.object({
        /** Relative to the profile's memory base path, and never resolved. See `memory-recall.ts`. */
        path: z.string().max(MAX_RECALL_PATH),
        /** 1-based, inclusive, and present only as a PAIR — a half range is not a range. */
        lineStart: z.number().int().finite().nonnegative().optional(),
        lineEnd: z.number().int().finite().nonnegative().optional(),
        /** The model's own words for how it used this file. Clipped, never dropped. */
        note: z.string().max(MAX_RECALL_NOTE).optional(),
      }),
    )
    .max(MAX_RECALL_ENTRIES),
  /**
   * Entries the citation named that this event does not carry — **for any reason**, so a cap can
   * never be silent (`092`'s rule, `096`'s precedent). Absent or 0 normally.
   */
  dropped: z.number().int().nonnegative().optional(),
  /**
   * Ids of earlier sessions the model says it drew on — carried, never drawn as ids.
   *
   * ⚠️ **Carried although no surface prints one**, and that is 319 §1.2's ruling rather than an
   * oversight: the provider's own instruction calls this list *"for us to track"* while calling the
   * entries above *"for rendering"*, the ids are TRANSCRIBED by the model out of text files rather
   * than minted by the app-server, and nothing in this app can resolve one into a conversation a
   * person would recognise. See `memory-recall.ts` for the whole argument. ⛔ Dropping them instead
   * would be 319 committing 319's own defect — throwing away the half of the citation that is
   * hardest to re-derive later.
   */
  threadIds: z.array(z.string().max(MAX_THREAD_ID)).max(MAX_RECALL_THREADS).optional(),
  /** Ids past the cap. Absent or 0 normally — the same no-silent-cap rule as `dropped`. */
  threadsDropped: z.number().int().nonnegative().optional(),
  source: z.string().max(120),
})
