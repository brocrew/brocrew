import type { InstalledSkillVersion } from './skills-installation'
import type { LaunchSetting, LaunchSettingKey, LaunchSettingValue } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { MemoryStoreState } from './agent-memory'
import type { WhoWroteIt } from './own-instructions'
import type { ProviderSnapshot } from './provider-snapshots'
import type { TurnAsSent } from './turn-as-sent'
import type { InjectedInstructionKind, RefusedInstruction } from './runtime-ipc'
import type { ActedBy } from './who-did-it'
import type { SavedMethodsNow, SavedMethodsUse } from './saved-methods'
import type { TextPackUse } from './text-pack'
import type { InstructionSpan, WhoseText } from './whose-text'

/**
 * 🔴 **Everything an agent was given, as one read** — the agent-input popup's contract.
 *
 * ⚑ **Two halves.** {@link WhatALaunchGave} is what a launch KEEPS on its `launched` row: BroBot's own
 * words in full, everything else by fingerprint. {@link WhatThisAgentWasGiven} is what the window
 * READS: that record, with the files and memory read now beside it, the tools in full, and sizes.
 */

/** ⚑ Characters, words, and tokens as an estimate: characters ÷ 4, rounded. */
export interface PartSize {
  readonly characters: number
  readonly words: number
  /** ⚠️ An estimate — characters ÷ 4. Drawn with "≈". */
  readonly tokens: number
}

/** ⚑ The size of one text. */
export function sizeOf(text: string): PartSize {
  const trimmed = text.trim()
  return {
    characters: text.length,
    words: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    tokens: Math.round(text.length / 4),
  }
}

/** ⚑ The sizes of several parts, added. */
export function sizesAdded(parts: readonly PartSize[]): PartSize {
  return parts.reduce(
    (sum, one) => ({
      characters: sum.characters + one.characters,
      words: sum.words + one.words,
      tokens: sum.tokens + one.tokens,
    }),
    { characters: 0, words: 0, tokens: 0 },
  )
}

/** Who made a file the agent has. */
export type GivenOrigin =
  'brobot' | 'a-person' | 'an-agent' | 'a-repository' | 'the-provider' | 'unknown'

/**
 * ⚑ A file Codex reads itself, which BroBot did not send it: a repository's own `AGENTS.md` — as
 * Codex reported it at launch, or, with no launch record, as its discovery would find it now.
 */
export type GivenFileKind = InjectedInstructionKind | 'read-by-codex'

/** Whether the model has it in every request, or only when the agent opens it. */
export type GivenReach = 'in-every-request' | 'when-the-agent-opens-it'

/** Where a text came from, for this answer. */
export type GivenTextIs = 'as-launched' | 'read-now' | 'composed-now' | 'unreadable'

/** How a section was made. */
export type GivenMade = 'shipped' | 'own-instructions' | 'own-notes' | 'composed-at-launch'

// ── what a launch keeps (R2), on its `launched` row ───────────────────────────────────────────────

/** ⚑ One file a launch saw, kept by fingerprint — and in full only when BroBot wrote it. */
export interface GivenRecordFile {
  readonly path: string
  readonly kind: GivenFileKind
  readonly bytes: number
  /** ⚑ sha256 of the text the agent was given; `null` when it could not be read at launch. */
  readonly sha256: string | null
  readonly truncated: boolean
  /** ⚑ Only for BroBot's own files (the workspace's): their text, as launched. */
  readonly text?: string
  /** ⚑ The line the model read above it ({@link GivenFile.heading}), where BroBot put one. */
  readonly heading?: string
}

/** ⚑ One memory file a launch saw, by fingerprint only: the agent's words are not BroBot's. */
export interface GivenRecordMemory {
  readonly path: string
  readonly kind: InjectedInstructionKind
  readonly bytes: number
  readonly sha256: string
}

/**
 * 🔴 **What one launch gave its agent, kept with the launch** (`LaunchedEvent.given`, F093 · R2).
 *
 * ⛔ **BroBot's own words in full; nobody else's.** A repository's files and the agent's memory are
 * kept by path and fingerprint, so the ledger learns nothing it did not hold before.
 */
export interface WhatALaunchGave {
  readonly builtInSkills?: GivenBuiltInSkills
  /** The text pack this launch read in place of the shipped texts, or could not use. */
  readonly textPack?: TextPackUse
  /** What this launch was given from its profile's saved methods. */
  readonly savedMethods?: SavedMethodsUse
  /** The build that composed it, or `null` when it could not be read. */
  readonly build: { readonly id: string; readonly commit: string } | null
  /** Where BroBot's text sits: Claude's system prompt, or Codex's first message. */
  readonly placement: 'system-prompt' | 'first-message'
  /** BroBot's profile file, in full, with its sections — or `null` when none was composed. */
  readonly profileFile: {
    readonly path: string
    readonly text: string
    readonly sections: readonly InstructionSpan[]
    /** The plain reason it was not published (someone else's file at its name), else `null`. */
    readonly refused: string | null
    /** ⚑ The line the model read above it ({@link GivenFile.heading}), where BroBot put one. */
    readonly heading?: string
  } | null
  /** The own-instructions version the launch used, or `null` when there was none. */
  readonly ownInstructionsVersion: number | null
  /** Profile-shared notes snapshot used by this launch; absent/null on legacy records. */
  readonly ownNotesVersion?: number | null
  /** BroBot's per-conversation text, in full, with its sections. */
  readonly thisConversation: {
    readonly text: string
    readonly sections: readonly InstructionSpan[]
    /** ⚑ The line the model read above it ({@link GivenText.heading}). */
    readonly heading?: string
  } | null
  /** Every other instruction file, in the order the model reads them. */
  readonly files: readonly GivenRecordFile[]
  /** The memory files there at launch. */
  readonly memory: readonly GivenRecordMemory[]
  /**
   * BroBot's tools at launch, by fingerprint: the full definitions are the build's. ⚑ Their
   * paragraph ({@link GivenTools.instructions}) in full, where there was one.
   */
  readonly tools: {
    readonly server: string
    readonly count: number
    readonly sha256: string
    readonly instructions?: string
  }
  /**
   * The settings the launch gave the provider that change what it sends its model, as its adapter
   * launched with them ({@link LaunchSetting}); absent where the adapter said none.
   */
  readonly settings?: readonly LaunchSetting[]
}

// ── what the window reads ─────────────────────────────────────────────────────────────────────────

/** Which launch an answer describes. */
export type GivenLaunch =
  | {
      readonly recorded: true
      /** When that launch was made: its row's time. */
      readonly at: number
      readonly build: { readonly id: string; readonly commit: string } | null
      /** `false` when an older build composed it. */
      readonly thisBuild: boolean
      readonly running: boolean
    }
  | {
      readonly recorded: false
      /**
       * `before-this-build`: its last launch is not one this app recorded — before launches were
       * recorded, by another app (an imported conversation), or by its provider in a home this app
       * made before this app took it in (an adopted one, W4.177). `not-kept`: its launch could not
       * keep a record. `never-launched`: nothing has been launched yet.
       */
      readonly why: 'before-this-build' | 'not-kept' | 'never-launched'
      readonly running: boolean
    }

/** One section of BroBot's own text, and how it was made. */
export interface GivenSection {
  /** `null` for a file's own head. */
  readonly heading: string | null
  readonly whose: WhoseText
  readonly made: GivenMade
  /** Only for `own-instructions`. */
  readonly version: GivenVersion | null
  readonly ownNotesVersion?: number | null
  /** Inclusive index into the text it is a section of. */
  readonly start: number
  /** Exclusive index into the text it is a section of. */
  readonly end: number
  readonly size: PartSize
}

/** One version of an agent's own instructions: who wrote it, and when. */
export interface GivenVersion {
  readonly version: number
  readonly whoWroteIt: WhoWroteIt
  /** ⚑ `WROTE_IT_MEANS`, e.g. "you wrote this". */
  readonly whoWroteItMeans: string
  readonly by: ActedBy
  readonly writtenAt: number
  readonly conversation: string | null
  readonly broughtBack: number | null
}

/** The own-instructions version a launch used, and the newest one now. */
export interface GivenOwnInstructions {
  readonly used: GivenVersion | null
  readonly newest: GivenVersion | null
  /** `true` when a newer version was saved after this launch: the next start uses it. */
  readonly changedSinceLaunch: boolean
}

/** One instruction file the agent has. */
export interface GivenFile {
  readonly path: string
  readonly kind: GivenFileKind
  readonly origin: GivenOrigin
  readonly madeAutomatically: boolean
  /** ⚑ One plain sentence on who makes it and when. */
  readonly originSays: string
  readonly reach: GivenReach
  /** `null` when it cannot be read now. */
  readonly text: string | null
  readonly textIs: GivenTextIs
  /** `null` when this app cannot tell. */
  readonly changedSinceLaunch: boolean | null
  readonly truncated: boolean
  /** Only BroBot's own profile file has sections. */
  readonly sections: readonly GivenSection[]
  readonly size: PartSize
  /** The plain reason this app did not send it, else `null`. */
  readonly refused: string | null
  /**
   * ⚑ **W4.177 — the line the model read just above this file's text**, a blank line apart from it:
   * on Claude, `Contents of <path> (<what the model is told it is>):`, and in front of the first file
   * BroBot's preamble too (*"Codebase and user instructions are shown below…"*). Absent when BroBot
   * put no line above it: a file it did not send, or one Codex read itself (Codex frames its files
   * its own way, and its record of a turn shows that).
   */
  readonly heading?: string
  /**
   * Where {@link heading} came from, beside it: `as-launched`, kept with the launch; `composed-now`,
   * this build's line for that file, for a launch that kept none.
   */
  readonly headingIs?: 'as-launched' | 'composed-now'
}

/** BroBot's per-conversation text: written into no file. */
export interface GivenText {
  readonly text: string
  readonly textIs: 'as-launched' | 'composed-now'
  readonly sections: readonly GivenSection[]
  readonly size: PartSize
  /**
   * ⚑ **W4.177 — the line the model read just above it**, a blank line apart:
   * *"Composed by BroBot for this conversation at this launch:"*, on both providers.
   */
  readonly heading?: string
  /** Where {@link heading} came from, as {@link GivenFile.headingIs}. */
  readonly headingIs?: 'as-launched' | 'composed-now'
}

/**
 * How the provider hands a set of tools to its model: only their names until the agent loads one
 * (Claude's tool search), every definition in every request, found by a search with not even the
 * names in front of the model (Codex's external servers), or not known yet.
 */
export interface GivenDeferral {
  readonly kind: 'names-until-loaded' | 'in-every-request' | 'found-by-search' | 'unknown'
  /** One plain sentence. */
  readonly says: string
}

/** One of BroBot's agent tools, in full. */
export interface GivenTool {
  readonly name: string
  /** Never cut. */
  readonly description: string
  /** The JSON Schema of its arguments. */
  readonly parameters: unknown
  readonly size: PartSize
}

/** BroBot's agent tools. */
export interface GivenTools {
  readonly server: string
  /** BroBot's paragraph on its tools, and where it rides. */
  readonly instructions: {
    readonly text: string
    /**
     * With the first message, on both providers. On Codex, this app puts it in front of the first
     * message of each launch. On Claude, Claude Code sends it among its context sections with the
     * first message: in the context message after it, or, for a model that takes none, as a
     * reminder at its head.
     */
    readonly ridesIn: 'in-the-first-message'
    /**
     * `as-launched`, the paragraph its launch kept; `composed-now`, this build's, for a launch that
     * kept none. Always set by the read.
     */
    readonly textIs?: 'as-launched' | 'composed-now'
    readonly size: PartSize
  }
  /**
   * The sentence the tools are declared under, where the provider takes one (Codex's namespace);
   * absent where none is sent. `as-launched` is what the provider's thread was started with;
   * `composed-now` is this build's sentence, where the ledger holds no start, or holds one that may
   * have been cut.
   */
  readonly namespace?: {
    readonly text: string
    readonly textIs: 'as-launched' | 'composed-now'
    readonly size: PartSize
  }
  readonly deferral: GivenDeferral
  /**
   * BroBot's tool names as the provider itself last listed them for this conversation, qualified as
   * it listed them, and when; `null` where it lists none (Codex), or has not yet. Always set by the
   * read.
   */
  readonly listedByTheProvider?: { readonly names: readonly string[]; readonly at: number } | null
  /** `null` when the launch is not recorded. */
  readonly changedSinceLaunch: boolean | null
  readonly list: readonly GivenTool[]
  readonly size: PartSize
}

/** An external server the agent is handed: names only. */
export interface GivenExternalServer {
  readonly name: string
  /** The tool names the provider published, or `null` when it reported none. */
  readonly tools: readonly string[] | null
  readonly deferral: GivenDeferral
}

/** One memory file, read now. */
export interface GivenMemoryEntry {
  readonly path: string
  readonly kind: InjectedInstructionKind
  readonly origin: GivenOrigin
  readonly reach: GivenReach
  readonly text: string
  readonly truncated: boolean
  /** `null` when the launch did not see it, or is not recorded. */
  readonly changedSinceLaunch: boolean | null
  /**
   * `as-launched` when the text read now has the fingerprint its launch kept, so it is the text the
   * launch gave; else `read-now`. Always set by the read.
   */
  readonly textIs?: 'as-launched' | 'read-now'
  readonly amendable: boolean
  readonly size: PartSize
}

/** One provider's memory store, one page of it. */
export interface GivenMemoryStore {
  readonly provider: Provider
  readonly state: MemoryStoreState
  readonly dir: string | null
  readonly entries: readonly GivenMemoryEntry[]
  /** Every entry the store holds. */
  readonly total: number
  /** Where the next page starts, or `null` after the last. */
  readonly nextOffset: number | null
  readonly refused: readonly RefusedInstruction[]
}

/** The agent's memory, read now, and what was there at its launch. */
export interface GivenMemory {
  readonly readAt: number
  readonly stores: readonly GivenMemoryStore[]
  readonly atLaunch: readonly GivenRecordMemory[]
}

/**
 * ⚑ **The provider's own parts (R3)** — what the bundled provider puts in front of its model on its
 * own, as this build captured it for the conversation's model (`shared/provider-snapshots.ts`).
 */
export interface GivenProviderParts {
  /** The provider version this app runs now, or `null` when it could not be read. */
  readonly version: string | null
  /**
   * The model the snapshot was looked up by: the one the provider last reported running, else the
   * one selected — or `null`, none named, so the provider's own default.
   */
  readonly model: string | null
  /** The snapshot, or `null` with {@link why}. */
  readonly snapshot: ProviderSnapshot | null
  /**
   * The mode the snapshot's conversation ran in: every capture opens its conversations asking first
   * and not planning. Compare it with {@link GivenLaunchSetting}'s `approval` and plan state. Set
   * by the read wherever there is a snapshot.
   */
  readonly capturedIn?: { readonly approval: 'ask'; readonly planning: false }
  /**
   * One plain sentence: why there is no snapshot, or how it may differ from what this conversation
   * was sent. `null` when there is a snapshot and nothing to add.
   */
  readonly why: string | null
}

/** One skill the agent has, as its provider listed it. */
export interface GivenSkill {
  readonly name: string
  /** As the provider gives it to the model; `null` where the list did not carry it. */
  readonly description: string | null
  /** `true` where the description reached this app's cap, so it may have been cut. */
  readonly descriptionMayBeCut: boolean
  /** The full path of its `SKILL.md`; `null` where the list did not carry it. */
  readonly path: string | null
  /** Where the provider found it: `system`, `user`, `repo`…; `null` with no path. */
  readonly scope: string | null
}

/**
 * The agent's skills, as its provider listed them after its newest launch. Their list rides in
 * every request; a skill's own file is read only when the agent opens it.
 */
export interface GivenSkills {
  /** `null` where none can be given, with {@link why}. */
  readonly listed: readonly GivenSkill[] | null
  /** When the provider listed them: its row's time; `null` with no list. */
  readonly at: number | null
  /**
   * Skills the provider listed that {@link listed} does not carry: past this app's cap, or with no
   * usable name. `0` when none; `null` with no list. Always set by the read.
   */
  readonly dropped?: number | null
  /**
   * Why {@link listed} is `null`: `not-listed-yet`, the provider has not listed its skills since
   * its newest launch; `no-skill-files`, Claude, which this app starts with no settings sources, so
   * it loads no skill from disk and its skills are its own, listed in the first message's context.
   */
  readonly why: 'not-listed-yet' | 'no-skill-files' | null
}

/** The app-owned skill view installed for this launch, distinct from a provider's catalogue. */
export interface GivenBuiltInSkills {
  readonly catalogueRevision?: number
  readonly versions?: readonly InstalledSkillVersion[]
  readonly version: string
  readonly reminder: string
  readonly listed: readonly GivenSkill[]
}

/** One launch setting: as the launch gave it, and as it stands now where it can change after. */
export interface GivenLaunchSetting {
  readonly key: LaunchSettingKey
  /** As launched; `null` where the launch kept no settings. */
  readonly atLaunch: LaunchSettingValue | null
  /**
   * As this app's record of the conversation holds it now, for a setting that can change after the
   * launch: `approval`, and the plan state (`mode` on Claude, `collaboration-mode` on Codex). Absent
   * for the others.
   */
  readonly now?: LaunchSettingValue
}

/** The launch's settings, beside what changed since. */
export interface GivenLaunchSettings {
  /** `false` where the launch kept none: before they were kept, or an adapter that said none. */
  readonly recorded: boolean
  readonly settings: readonly GivenLaunchSetting[]
}

/** Sizes, added up. */
export interface GivenTotals {
  /** Everything BroBot wrote: its files, this conversation, its tools paragraph. */
  readonly brobot: PartSize
  /** Repository, person and agent files in every request. */
  readonly otherFiles: PartSize
  /**
   * BroBot's tool definitions in full, with the sentence they are declared under where one is sent
   * ({@link GivenTools.namespace}): what the model gets once it has every one of them. ⚠️ Not what
   * {@link total} counts for them — that is {@link toolsInEveryRequest}.
   */
  readonly tools: PartSize
  /**
   * ⚑ **BroBot's tools as {@link total} counts them**: the full definitions ({@link tools}) when the
   * provider hands them over in every request — Codex, Claude without its tool search, or Claude
   * before it has said how it hands them over — and their names alone when Claude loads each one
   * only on request (`tools.deferral.kind` is `names-until-loaded`).
   */
  readonly toolsInEveryRequest: PartSize
  /**
   * ⚑ **Other servers' tools as {@link total} counts them** — the person's own servers, never
   * BroBot's: on Claude with its tool search, their names, which every request carries; on Codex,
   * nothing, since it finds them with its own tool search. `null` when that cannot be counted, with
   * {@link otherServersToolsWhy}: Claude has not reported its tool list yet, or hands those tools
   * over in full, and this app keeps no other server's descriptions.
   */
  readonly otherServersToolsInEveryRequest: PartSize | null
  /**
   * Why {@link otherServersToolsInEveryRequest} is `null`, or why it is nothing though there are
   * other servers (Codex); else `null`.
   */
  readonly otherServersToolsWhy: string | null
  /** Claude's `MEMORY.md` / Codex's `memory_summary.md`. */
  readonly memoryInEveryRequest: PartSize
  /**
   * The provider's own parts, when there is a snapshot: the snapshot's own total, which leaves out
   * a tool sent only once the model asks for it.
   */
  readonly provider: PartSize | null
  /**
   * The sum of what is known to be in every request: {@link brobot}, {@link otherFiles},
   * {@link toolsInEveryRequest}, {@link otherServersToolsInEveryRequest} when known,
   * {@link memoryInEveryRequest} and {@link provider} when known — exactly.
   */
  readonly total: PartSize
  /** The share of the context window, when the provider reported its size. */
  readonly contextWindow: { readonly tokens: number; readonly share: number } | null
  /** Why `contextWindow` is `null`, else `null`. */
  readonly contextWindowWhy: string | null
}

/** 🔴 **F093 · the agent-input popup's one read.** */
export interface WhatThisAgentWasGiven {
  readonly builtInSkills?: GivenBuiltInSkills
  /** {@link WhatALaunchGave.textPack}. */
  readonly textPack?: TextPackUse
  /** {@link WhatALaunchGave.savedMethods}. */
  readonly savedMethods?: SavedMethodsUse
  /** The saved-methods index as the profile's folder holds it now, read for this view. */
  readonly savedMethodsNow?: SavedMethodsNow
  readonly sessionId: string
  readonly provider: Provider
  readonly profileId: string | null
  readonly readAt: number
  readonly launch: GivenLaunch
  readonly placement: 'system-prompt' | 'first-message'
  readonly files: readonly GivenFile[]
  readonly thisConversation: GivenText | null
  readonly ownInstructions: GivenOwnInstructions
  readonly ownNotesVersion?: number | null
  readonly tools: GivenTools
  readonly externalServers: readonly GivenExternalServer[]
  readonly memory: GivenMemory
  /** The provider's own parts (R3), from the snapshot this build carries for its model. */
  readonly providerParts: GivenProviderParts
  /** The launch's settings that change what the provider sends its model. Always set by the read. */
  readonly launchSettings?: GivenLaunchSettings
  /** The agent's skills, as its provider listed them. Always set by the read. */
  readonly skills?: GivenSkills
  readonly size: GivenTotals
}

// ── one message as the model got it (C9 d) ───────────────────────────────────────────────────────

/** Where a part sat in what the model got. */
export type ModelGotWhere =
  /** In every request: on Claude, BroBot's instructions, files and this conversation's text. */
  | 'system-prompt'
  /**
   * In the first message of the launch, which every later request re-sends: on Codex, the files it
   * reads itself, and this conversation's lead.
   */
  | 'first-message'
  /**
   * In an earlier message: of this launch — on Codex, this conversation's lead, sent again after a
   * compaction or after a first turn Codex never began — or (W4.179) of an earlier launch, whose
   * lead a reopened Codex thread still holds. The part's title says which.
   */
  | 'an-earlier-message'
  /** In this message. */
  | 'this-message'

/** ⚑ One part of what the model got, from BroBot's own records (R2). */
export interface ModelGotPart {
  readonly where: ModelGotWhere
  /** A file's kind, this conversation's own text, or the message itself. */
  readonly kind: GivenFileKind | 'this-conversation' | 'the-message'
  /** In plain words: what it is. */
  readonly title: string
  readonly origin: GivenOrigin
  /** A file's path; `null` for the others. */
  readonly path: string | null
  /** As the model got it, or `null` with {@link why}. */
  readonly text: string | null
  /** Why {@link text} is `null`, in plain words; else `null`. */
  readonly why: string | null
  readonly size: PartSize | null
  /**
   * ⚑ **W4.177 — the line the model read just above this part's text**, a blank line apart from it:
   * on Claude, a file's `Contents of <path> (…):` line, with BroBot's preamble in front of the first
   * file — so the parts in the system prompt, each as its heading and its text, are BroBot's whole
   * appended text (a file kept by fingerprint only has its heading and no text). Absent where BroBot
   * put no line above it; this conversation's own part already begins with its line.
   */
  readonly heading?: string
}

/**
 * 🔴 **F093 · C9 d — one message as the model got it**: BroBot's parts in the order the model read
 * them, each with where it sat, and the provider's own record of the turn (R1).
 */
export interface WhatTheModelGot {
  readonly sessionId: string
  readonly provider: Provider
  /**
   * The message this answers for: the one at the place asked, or — for any other row — the one
   * handed to the model at or before it.
   */
  readonly ordinal: number
  /** When it was handed over: its row's time. */
  readonly at: number
  /** Its words as the transcript shows them, one per message the turn carried. */
  readonly words: readonly string[]
  /**
   * The launch it was handed over in: that row's place and time, and whether it kept a record.
   * `null`: the record holds no launch before it.
   */
  readonly launch: {
    readonly ordinal: number
    readonly at: number
    readonly recorded: boolean
  } | null
  /** Whether it was the first message of that launch; `null` with no launch. */
  readonly firstOfItsLaunch: boolean | null
  readonly parts: readonly ModelGotPart[]
  /**
   * R1 · the turn as the provider kept it in its own record — the message, and what it added
   * beside it, in the order the model got them ({@link TurnAsSent}) — or why it could not be read.
   */
  readonly providersRecord: TurnAsSent
  /**
   * Whether the provider's own record of the message is the same text BroBot kept as handed over
   * (`sent`); `null` when either is missing, or when the message carried a file, which each provider
   * records in its own way (an image reads `[an image]` in Claude Code's). ⚑ **It reads `true` or
   * `null`, never `false`** (W4.172): the provider's record finds a message only by that exact text.
   */
  readonly providerKeptTheSameText: boolean | null
}
