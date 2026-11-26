import type {
  InjectedInstruction,
  RefusedInstruction,
  SessionInstructions,
} from '../../shared/instruction-contracts'
import type { MemoryLoadedEvent } from '../../shared/conversation-events'
import type { Provider } from '@brobot2/shared'
import type { PromptIdentity } from '../runtime/agent-preamble'
import type { InstructionSpan } from '../../shared/whose-text'

/** Result of publishing this profile's instruction file. */
export type BundlePublish =
  | { readonly ok: true; readonly path: string; readonly bytes: number }
  | { readonly ok: false; readonly path: string; readonly reason: 'unmanaged-override' }

type InstructionRefusal = 'symlink' | 'not-a-regular-file' | 'too-large' | 'not-utf8' | 'unreadable'

export type InstructionRead =
  | {
      ok: true
      text: string
      bytes: number
      truncated: boolean
      /** The path the filesystem resolves to. A caller that displays the entry compares it with its own derivation and discloses a mismatch; see {@link readClaudeAgentMemory}. */
      real?: string
    }
  | { ok: false; reason: InstructionRefusal }
  /** Nothing is there: the ordinary case, reported as nothing at all. */
  | { ok: false; reason: 'absent' }

export interface WorkspaceOwnFile {
  readonly path: string
  readonly content: string
}

export interface InstructionInputs {
  provider: Provider
  identity?: PromptIdentity
  cwd: string
  providerHome: string
  /** The app's own generated workspace instruction file, so a file BroBot wrote is labelled as such. */
  workspaceFile?: string
  /**
   * The files BroBot generated into its own workspace this launch, with the content it wrote.
   * The same body is published as both `CLAUDE.md` and `AGENTS.md`, so the Claude walk would
   * otherwise admit it twice. The content travels with the path because the agent can write that
   * directory: ownership is decided against the bytes read off disk, never by file name alone.
   * Passed in so this module stays pure over the filesystem. Absent means no workspace files were
   * published.
   */
  workspaceOwnFiles?: readonly WorkspaceOwnFile[]
  /** The OS home directory. A parameter so the boundary above is testable without one. */
  home?: string
  /**
   * What publishing this launch's compiled instruction bundle did (see `profile-bundle.ts`).
   * Passed in because the publish needs the compiled text, which needs the database this module
   * must not reach. Absent means no bundle was published.
   */
  bundle?: BundlePublish
  /**
   * The bundle this launch composed and where each layer sits inside it (see `profileBundleSpans`).
   * Passed in for the same reason as {@link InstructionInputs.bundle}. Absent means no bundle was
   * composed.
   */
  bundleComposed?: { readonly text: string; readonly spans: readonly InstructionSpan[] }
  /**
   * What is true of this conversation, composed for its launch alone (see `thisConversationSpans`).
   * Never a file, because the profile's file is shared and a sibling's launch rewrites it. It is
   * composed last by {@link composeSystemHint} on both providers and handed on where each keeps it
   * ({@link SessionLaunchRead.systemHint}, {@link SessionLaunchRead.firstTurnLead}).
   */
  thisConversation?: { readonly text: string; readonly spans: readonly InstructionSpan[] }
}

export interface SessionLaunchRead {
  /** What the model was told and what the drawer shows. */
  instructions: SessionInstructions
  /**
   * The launch row, when this profile has one to state, else `null`. `null` wherever nothing reaches
   * the prompt, so a fresh profile draws no row. Ignored on a resume: the conversation's ledger
   * already holds it (see {@link MemoryLoadedEvent}).
   */
  memoryLoaded: MemoryLoadedEvent | null
  /**
   * `SessionInstructions.composed` as the adapter's system hint: Claude sends its system prompt
   * whole at every launch. `null` on Codex; see {@link firstTurnLead}. Never a second composition.
   */
  systemHint: string | null
  /**
   * `SessionInstructions.composed` placed in front of the first message of this life, on Codex
   * (this conversation's text, opened with how to use the tools, which its catalogue cannot hold);
   * `null` on Claude. Not `developerInstructions`: a `collaborationMode` update takes precedence
   * over that field and a `thread/resume`'s copy never reached the model. Whether a compaction
   * keeps that message is unmeasured, so the host sends it again after one, and after a turn the
   * provider never began (`HostedSession.firstTurnLead`).
   */
  firstTurnLead: string | null
  /**
   * BroBot's profile file for this launch: where it was published, its text and sections, and the
   * reason when it did not reach the model (`refused`: someone else's file at its name, or on
   * Claude a budget it did not fit in). `null` when the caller composed none.
   */
  profileFile: {
    readonly path: string
    readonly text: string
    readonly spans: readonly InstructionSpan[]
    readonly refused: string | null
  } | null
}

export interface AgentMemoryRead {
  /**
   * The memories in the order the model meets them: what the provider injected first, then what
   * the agent would have to fetch. Each provider fills it from a whole directory. Empty is the
   * ordinary first case.
   */
  memory: InjectedInstruction[]
  /** Every source that exists and was not readable. Silence about a source is the defect. */
  refused: RefusedInstruction[]
}

export interface AgentMemoryStoreRead extends AgentMemoryRead {
  /**
   * The store's directory when there is one to talk about, else null. Uses `existsSync`, which
   * follows links: a store that exists and holds nothing we show is still a store, and a dangling
   * link is not one, leaving the broken-link row to say what happened.
   */
  dir: string | null
}

export interface MemoryCandidate {
  path: string
  derived: string
  // `agent-memory-topic` is one memory in its own file; see `InjectedInstructionKind` for why it
  // is a third kind rather than a second use of `agent-memory-note`.
  kind: 'agent-memory' | 'agent-memory-note' | 'agent-memory-topic'
  reach: 'prompt' | 'on-request'
}

export interface AgentMemoryPage extends AgentMemoryStoreRead {
  /** Every file the store holds that this page could show: its fixed files that exist, and every topic file or note. */
  total: number
  /** Where the next page starts, or `null` after the last. */
  nextOffset: number | null
  /** How many topic files or notes the store lists: an `offset` at or past it is past the end. */
  listed: number
  /** The names the launch readers list: the first {@link AGENT_MEMORY_NOTES_SHOWN} topic files or notes, independent of the selected entry. */
  firstListed: readonly string[]
}

export type { MemoryStoreLayout } from '@brobot2/runtime/provider-module'
