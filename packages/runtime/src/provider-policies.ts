import type { RuntimeEvent } from './events'
import type { SessionRef } from './session-ref'
import type { LaunchSettingValue } from './launch-settings'
import type { ProviderCommand } from './provider-commands'
import type { ZodType } from 'zod'
import type { Provider } from '@brobot2/shared'

/** Values owned by the consuming host, rather than its provider implementation. */
export interface ProviderHostValues {
  readonly event: { readonly type: string }
  readonly retentionCandidate: object
  readonly session: object
  readonly file: object
  readonly memoryNote: object
  readonly childPart: string
  readonly childResult: object
  readonly turnAsked: object
  readonly turnAnswer: object
  readonly discovery: object
  readonly protectedPlaceKind: string
  readonly instructionInputs: object
  readonly launchRead: object
  readonly instruction: { readonly kind: string }
  readonly origin: string
  readonly memoryStore: object
  readonly memoryPage: object
  readonly givenSkills: object
  readonly deferral: object
  readonly partSize: object
  readonly snapshot: object
}

export type ProviderDisplayEvent<H extends ProviderHostValues> = RuntimeEvent | H['event']

export interface ResolveImageClaim {
  imageId: string
  savedPath?: string
}
export type ResolveImagePath = (claim: ResolveImageClaim) => string | null

export interface ImportedEntry<H extends ProviderHostValues> {
  at: number
  event: ProviderDisplayEvent<H>
}
export interface ImportedTranscript<H extends ProviderHostValues> {
  entries: ImportedEntry<H>[]
  unreadable: number
  lastAt: number
  edits: object | undefined
}

export interface TurnReadingOptions {
  readonly hasAContextMessage?: (model: string) => boolean | null
}
export interface TurnReading<H extends ProviderHostValues> {
  line(text: string): 'more' | 'done'
  answer(): H['turnAnswer']
}

export interface RetentionScan<H extends ProviderHostValues> {
  readonly home: string
  scanChildren(path: string): AsyncGenerator<string>
  plainDirectory(path: string): Promise<boolean>
  considered(path: string): boolean
  add(
    file: string,
    session: string,
    directory: string | null,
  ): Promise<H['retentionCandidate'] | null>
}

export interface ProviderChildWorkRequest<H extends ProviderHostValues> {
  readonly ref: SessionRef
  readonly updatedAt: number
  readonly part: H['childPart']
  readonly agents: readonly string[]
  readonly taskId: string | null
  home(): string
  pathForChild(home: string, ref: SessionRef): string | null
}

export interface TranscriptPolicy<H extends ProviderHostValues> {
  eventForDisplay?(event: ProviderDisplayEvent<H>): ProviderDisplayEvent<H>
  splitToolName?(name: string): { server: string; tool: string } | null
  readEarlierModel?(home: string, file: string): string | null
  keepEarlierReportedEffort(): boolean
  whatDeletionLeaves(): string[]
  noModelMessageReason?(words: string): string | null
  imageResolver?(
    threadId: string,
    home: () => string | null,
    resolveAsset: (candidate: string) => string | null,
  ): ResolveImagePath
  scanRetention(input: RetentionScan<H>): AsyncGenerator<{
    path: string
    candidate: H['retentionCandidate'] | null
  }>
  filesOf(home: string, sessions: readonly H['session'][]): H['file'][]
  memoryNotesOf(home: string, sessions: readonly H['session'][]): H['memoryNote'][]
  readChild(request: ProviderChildWorkRequest<H>): H['childResult']
  readTurn(asked: H['turnAsked'], options: TurnReadingOptions): TurnReading<H>
  parse(
    frames: string[],
    fallbackAt: number,
    options?: { edits?: object | undefined; resolveImage?: ResolveImagePath | undefined },
  ): ImportedTranscript<H>
  nativePath(home: string, ref: SessionRef): string | null
  ownsRecord(home: string, file: string): boolean
  exportPath(home: string, ref: SessionRef, startedAt: number, recordedAt: string): string
  exportSupport(): { format: string; resumable: boolean; note: string }
}

export interface ProviderDescription {
  title: string
  preview: string
}
export interface DiscoveryPolicy<H extends ProviderHostValues> {
  discover(home: string, profileId: string): H['discovery']
  userHome(env: NodeJS.ProcessEnv, defaultHome: () => string): string
  configHomes(home: string, env: NodeJS.ProcessEnv): readonly string[]
  readonly protectedPlaceKind: H['protectedPlaceKind']
  descriptions?(): Promise<Map<string, ProviderDescription>>
}

export interface ListedSkills {
  readonly commands: readonly ProviderCommand[]
  readonly at: number
  readonly dropped: number
}
interface GivenToolNames {
  readonly declarations: readonly string[]
  readonly namesOnlyText: string
  readonly published: readonly string[] | null
  readonly external: readonly { readonly name: string; readonly tools: readonly string[] | null }[]
}

export interface GivenPolicy<H extends ProviderHostValues> {
  nativeFiles(cwd: string): string[]
  toolNames(
    server: string,
    names: readonly string[],
    published: readonly string[] | null,
    externalServers: readonly string[],
  ): GivenToolNames
  toolWasSent(declaration: string, disabled: readonly string[]): boolean
  readonly repositoryOrigin: string
  deferral(published: readonly string[] | null): H['deferral']
  externalDeferral(published: readonly string[] | null): H['deferral']
  otherServers(
    published: readonly string[] | null,
    brobotsServer: string,
    granted: readonly string[],
  ): { readonly size: H['partSize'] | null; readonly why: string | null }
  namespaceText(declaredWith: string | null, count: number): string | null
  readonly planningKey: string
  launchSettingKeys?(): readonly string[]
  launchSetting?(
    key: string,
    value: LaunchSettingValue,
  ):
    | {
        readonly label: string
        readonly words: string | null
        readonly lines: readonly string[]
      }
    | undefined
}
export interface InstructionPolicy<H extends ProviderHostValues> {
  readonly given: GivenPolicy<H>
  read(inputs: H['instructionInputs']): H['launchRead']
  workspaceFile?(root: string): string
  readonly bundleLeaf: string
}

export interface MemoryStoreLayout {
  readonly fixedFiles: (home: string) => readonly string[]
  readonly notesFolder: (home: string) => string
  readonly listNotes: (folder: string) => { names: string[] }
  readonly acceptsNote: (name: string) => boolean
}
export interface MemoryPolicy<H extends ProviderHostValues> {
  entryOrigin(kind: H['instruction']['kind']): H['origin']
  readonly readStore: (home: string) => H['memoryStore']
  readonly layout: MemoryStoreLayout
  counts(home: string): { readonly total: number; readonly listed: number }
  readPage(home: string, offset: number, limit: number): H['memoryPage']
  select(home: string, entry: string): H['instruction'] | undefined
  noteDirectory(home: string): string | null
}
export interface SkillPolicy<H extends ProviderHostValues> {
  asGiven(listed: ListedSkills | null, builtIn: boolean): H['givenSkills']
  needsReminders(confirmed: () => boolean | undefined): boolean
  readonly builtInScope: string | null
  readonly discoveryRoot: string
  initialFiles(): Map<string, string>
  /** Native metadata placed beside the shared skill folders, when this provider needs it. */
  sharedFiles?(): ReadonlyMap<string, string>
  /** Recognize entries produced by this adapter's current and persisted skill-view format. */
  installedEntry?(relative: string): 'directory' | 'file' | null
  fileFor(name: string): string
  launchedEntry(
    root: string,
    skill: { readonly name: string; readonly description: string },
  ): {
    name: string
    description: string
    path: string
  }
  readonly legacyReminder: {
    readonly field: string
    readonly schema: ZodType<string>
    canonical(name: string, text: string): string | null
  }
}
export interface SnapshotPolicy<H extends ProviderHostValues> {
  fileFor(platform: NodeJS.Platform): H['snapshot']
}

export interface KeptRule {
  readonly kept: string
  readonly rule:
    | {
        readonly kind: 'tool'
        readonly tool: string
        readonly content?: string
        readonly server?: string
      }
    | { readonly kind: 'command-prefix'; readonly prefix: string[] }
}

/** One file that keeps such rules, and what it keeps — or why it could not be read. */
export interface KeptRulesFile {
  readonly file: string
  readonly rules: readonly KeptRule[]
  /** Set when the file is there and could not be read: its rules are not known. */
  readonly unreadable?: string
  /** Set when this app does not edit the file: why, so a rule in it is removed by hand. */
  readonly notEditedHere?: string
}

export interface KeptRulePolicy {
  projectFolders(
    records: readonly { readonly provider: Provider; readonly cwd: string }[],
  ): string[]
  files(homes: readonly string[], projectFiles: readonly string[]): KeptRulesFile[]
  remove(file: string, kept: string, platform: NodeJS.Platform): void
}
