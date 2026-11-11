import type {
  InjectedInstruction,
  InjectedInstructionKind,
  SessionInstructions,
} from '../../shared/instruction-contracts'
import type { UserTurnEvent } from '../../shared/human-answer-contracts'
import {
  providerKnowledge,
  historicalInstructionReads,
  historicalProfileMemory,
} from '../providers/index'
import { providerDefinitions } from '../providers/index'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { z } from 'zod'
import {
  type AgentToolset,
  type ContextReading,
  type LaunchSetting,
  type LaunchSettingKey,
  type LaunchSettingValue,
  type ProviderCommand,
} from '@brobot2/runtime'
import { providerDescriptor, type Provider } from '@brobot2/shared'
import type { AgentMemoryStore } from '../../shared/agent-memory'
import type { SnapshotAnswer } from '../../shared/provider-snapshots'
import type { TurnAsSent } from '../../shared/turn-as-sent'
import { INSTALLED_SKILL_BYTE_LIMIT } from '../../shared/skills-installation'
import {
  WROTE_IT_MEANS,
  type OwnInstructions,
  type OwnInstructionsVersion,
} from '../../shared/own-instructions'
import { theMessagesOf } from '../../shared/runtime-ipc'
import {
  sizeOf,
  sizesAdded,
  type GivenBuiltInSkills,
  type GivenExternalServer,
  type GivenFile,
  type GivenFileKind,
  type GivenLaunch,
  type GivenLaunchSettings,
  type GivenMemoryEntry,
  type GivenMemoryStore,
  type GivenOrigin,
  type GivenProviderParts,
  type GivenRecordFile,
  type GivenRecordMemory,
  type GivenSection,
  type GivenText,
  type GivenTextIs,
  type GivenTool,
  type GivenVersion,
  type ModelGotPart,
  type ModelGotWhere,
  type PartSize,
  type WhatALaunchGave,
  type WhatTheModelGot,
  type WhatThisAgentWasGiven,
} from '../../shared/what-this-agent-was-given'
import { WHOSE_TEXT, type InstructionSpan } from '../../shared/whose-text'
import { BUILT_IN_SKILL_NAMES } from '../../shared/built-in-skills'
import { SAVED_METHODS_MOST_INDEX_BYTES, type SavedMethodsUse } from '../../shared/saved-methods'
import type { TextPackUse } from '../../shared/text-pack'
import { realPathOf } from '../read-text-file'
import { type TheBuildRunning } from './factory-text'
import {
  conversationBlock,
  headingAsSent,
  INSTRUCTION_FILE_CAP,
  readInstructionFile,
  THIS_CONVERSATION_HEADER,
} from './instructions'
import { workspaceInstructionFiles } from './workspace'
import type { ALeadCarried } from './codex-lead'

/**
 * What a launch gives its agent: {@link whatThisLaunchGave} builds the record a `launched` row keeps,
 * and {@link whatItWasGiven} reads it back for the window, with the files and memory read now beside
 * it, the tools in full and every size. Every file read here is one a launch named.
 */

/** The JSON Schema of a tool's arguments, as BroBot declares it (the Codex adapter's derivation). */
function parametersOf(tool: AgentToolset['tools'][number]): unknown {
  return z.toJSONSchema(z.looseObject(tool.input))
}

/** A toolset's definitions, as one fingerprint: name, description and arguments of each. */
export function toolsetFingerprint(toolset: AgentToolset): string {
  const definitions = toolset.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: parametersOf(tool),
  }))
  return createHash('sha256').update(JSON.stringify(definitions), 'utf8').digest('hex')
}

/** BroBot's profile file for one launch: its text, its sections, and whether it was published. */
export interface LaunchProfileFile {
  readonly path: string
  readonly text: string
  readonly spans: readonly InstructionSpan[]
  /** The reason it did not reach the model (`RefusedInstruction`'s code), else `null`. */
  readonly refused: string | null
}

/** The workspace's own files, as BroBot renders them: text BroBot wrote. */
function isBroBotsWorkspaceText(text: string): boolean {
  return workspaceInstructionFiles().some((file) => file.content === text)
}

/**
 * **The repository files Codex's own discovery would read in `cwd`, now** — one per folder, an
 * override before `AGENTS.md`, from the repository's root down to the folder ({@link codexConventionChain}).
 * For a conversation whose launch reported none (one with no launch record); a live Codex
 * conversation's are the ones it reported.
 */

interface ReadNow {
  readonly text: string
  readonly bytes: number
  readonly truncated: boolean
}

/**
 * A file a launch named, read now with the launch's own reader and cap, so an unchanged file reads
 * as it did at launch. `null` when it cannot be read.
 */
export function readNow(path: string): ReadNow | null {
  const read = readInstructionFile(path, INSTRUCTION_FILE_CAP)
  if (!read.ok) return null
  return { text: read.text, bytes: read.bytes, truncated: read.truncated }
}

/** Two spellings of one file — compared where they really are, when both can be resolved. */
function theSameFile(one: string, other: string): boolean {
  if (one === other) return true
  const a = realPathOf(one)
  const b = realPathOf(other)
  return a.ok && b.ok && a.path === b.path
}

/** What {@link whatThisLaunchGave} is handed. */
export interface WhatALaunchWasHanded {
  readonly builtInSkills?: GivenBuiltInSkills
  readonly textPack?: TextPackUse
  readonly savedMethods?: SavedMethodsUse
  readonly provider: Provider
  readonly build: TheBuildRunning | null
  /** What the instruction reader answered for this launch. */
  readonly instructions: SessionInstructions
  /** BroBot's profile file, when the reader composed one. */
  readonly profileFile: LaunchProfileFile | null
  /** The own-instructions version the profile file was rendered from, or `null`. */
  readonly ownInstructionsVersion: number | null
  readonly ownNotesVersion?: number | null
  /** The files the provider reported it read (Codex), else `[]`. */
  readonly reportedByTheProvider: readonly string[]
  readonly toolset: AgentToolset
  /** The settings the adapter says it launched with, or `undefined` where it says none. */
  readonly launchSettings?: readonly LaunchSetting[]
}

/** The record one launch keeps ({@link WhatALaunchGave}): every text it gave, in full. */
export function whatThisLaunchGave(handed: WhatALaunchWasHanded): WhatALaunchGave {
  const { instructions } = handed
  const profileFile = theProfileFile(handed)
  const files: GivenRecordFile[] = []
  for (const item of instructions.injected) {
    if (item.kind === 'profile-instructions') continue
    files.push({
      path: item.path,
      kind: item.kind,
      bytes: item.bytes,
      text: item.text,
      truncated: item.truncated,
    })
  }
  for (const path of handed.reportedByTheProvider) {
    if (profileFile !== null && theSameFile(path, profileFile.path)) continue
    if (files.some((one) => theSameFile(one.path, path))) continue
    const read = readNow(path)
    files.push({
      path,
      kind: 'read-by-codex',
      bytes: read?.bytes ?? 0,
      text: read?.text ?? null,
      truncated: read?.truncated ?? false,
    })
  }
  const memory: GivenRecordMemory[] = instructions.agentMemory.map((item) => ({
    path: item.path,
    kind: item.kind,
    bytes: item.bytes,
    text: item.text,
  }))
  const conversation = instructions.thisConversation
  // On Claude, the line the model read above each file BroBot sent, as this launch sent it.
  const headings =
    providerDescriptor(handed.provider).contextPlacement === 'system-prompt'
      ? headingsAsSentFor(
          [
            ...(profileFile === null
              ? []
              : [
                  {
                    path: profileFile.path,
                    kind: 'profile-instructions' as const,
                    refused: profileFile.refused,
                  },
                ]),
            ...files.map((file) => ({ path: file.path, kind: file.kind, refused: null })),
          ],
          instructions.composed?.split('\n\n', 1)[0],
        )
      : []
  const [profileHeading, ...fileHeadings] =
    profileFile === null ? [undefined, ...headings] : headings
  const toolsParagraph = handed.toolset.instructions
  return {
    build: handed.build === null ? null : { id: handed.build.id, commit: handed.build.commit },
    placement: providerDescriptor(handed.provider).contextPlacement,
    profileFile:
      profileFile === null
        ? null
        : {
            path: profileFile.path,
            text: profileFile.text,
            sections: profileFile.spans,
            refused: profileFile.refused,
            ...(profileHeading === undefined ? {} : { heading: profileHeading }),
          },
    ownInstructionsVersion: handed.ownInstructionsVersion,
    ...(typeof handed.ownNotesVersion === 'number'
      ? { ownNotesVersion: handed.ownNotesVersion }
      : {}),
    thisConversation:
      conversation === undefined
        ? null
        : {
            text: conversation.text,
            sections: conversation.spans,
            heading: THIS_CONVERSATION_HEADER,
          },
    files: files.map((file, at) => {
      const heading = fileHeadings[at]
      return heading === undefined ? file : { ...file, heading }
    }),
    memory,
    tools: {
      server: handed.toolset.server,
      count: handed.toolset.tools.length,
      sha256: toolsetFingerprint(handed.toolset),
      ...(toolsParagraph === undefined ? {} : { instructions: toolsParagraph }),
    },
    ...(handed.launchSettings === undefined ? {} : { settings: [...handed.launchSettings] }),
    ...(handed.builtInSkills === undefined ? {} : { builtInSkills: handed.builtInSkills }),
    ...(handed.textPack === undefined ? {} : { textPack: handed.textPack }),
    ...(handed.savedMethods === undefined ? {} : { savedMethods: handed.savedMethods }),
  }
}

/** The profile file the reader composed — or, on Claude, the one it appended. */
function theProfileFile(handed: WhatALaunchWasHanded): LaunchProfileFile | null {
  if (handed.profileFile !== null) return handed.profileFile
  const appended = handed.instructions.injected.find((item) => item.kind === 'profile-instructions')
  if (appended === undefined) return null
  return { path: appended.path, text: appended.text, spans: appended.sections ?? [], refused: null }
}

// ── reading a record back ─────────────────────────────────────────────────────────────────────────

/** Every file kind a record may name — anything else is dropped on the way back in. */
const KNOWN_KINDS: ReadonlySet<string> = new Set<GivenFileKind>([
  'profile-instructions',
  'profile-memory',
  'project-memory',
  'repository-conventions',
  'workspace-instructions',
  'agent-memory',
  'agent-memory-note',
  'agent-memory-topic',
  'read-by-codex',
])
/** What a record read back keeps at most: far above any launch this app makes. */
const BuiltInSkillsRecord = z
  .object({
    version: z.string().min(1).max(80),
    reminder: z.string().max(16_384),
    catalogueRevision: z.number().int().nonnegative().safe().optional(),
    versions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(256),
            versionId: z.string().min(1).max(256),
            version: z.string().min(1).max(80),
            alias: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
            sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().min(1).max(INSTALLED_SKILL_BYTE_LIMIT),
            requirement: z.enum(['create-agents', 'create-agents-or-coordinator']).nullable(),
            textPackDigest: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            textPackVersion: z.string().min(1).max(80).optional(),
            textPackSourceSha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
          })
          .strict()
          .refine((one) =>
            one.textPackDigest === undefined
              ? one.textPackVersion === undefined && one.textPackSourceSha256 === undefined
              : one.textPackVersion !== undefined && one.textPackSourceSha256 !== undefined,
          ),
      )
      .max(64)
      .optional(),
    listed: z
      .array(
        z
          .object({
            name: z.string().min(1).max(100),
            description: z.string().min(1).max(500),
            descriptionMayBeCut: z.literal(false),
            path: z.string().min(1).max(4096),
            scope: z.enum(['plugin', 'user']).nullable(),
          })
          .strict(),
      )
      .max(64),
  })
  .strict()
  .refine((value) =>
    value.listed.length === 0 ? value.reminder === '' : value.reminder.length > 0,
  )
  .refine((value) => new Set(value.listed.map((one) => one.name)).size === value.listed.length)
  .refine((value) => new Set(value.listed.map((one) => one.path)).size === value.listed.length)
  .refine(
    (value) =>
      value.versions === undefined ||
      (value.versions.length === value.listed.length &&
        new Set(value.versions.map((one) => one.id)).size === value.versions.length &&
        value.versions.every((one, index) => {
          const name = value.listed[index]?.name
          return name === one.alias || name === `brobot:${one.alias}`
        })),
  )

/** A launch's use of a text pack, read back as {@link TextPackUse} says it. */
const TextPackUseRecord: z.ZodType<TextPackUse> = z
  .object({
    folder: z.string().min(1).max(4096),
    refused: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('not-absolute') }).strict(),
        z.object({ kind: z.literal('unreadable') }).strict(),
        z.object({ kind: z.literal('core-missing') }).strict(),
        z
          .object({
            kind: z.literal('core-block-missing'),
            block: z.enum(['core', 'coordinator']),
          })
          .strict(),
        z.object({ kind: z.literal('turn-line-missing') }).strict(),
        z
          .object({ kind: z.literal('turn-line-without'), skill: z.enum(BUILT_IN_SKILL_NAMES) })
          .strict(),
        z
          .object({ kind: z.literal('skill-missing'), skill: z.enum(BUILT_IN_SKILL_NAMES) })
          .strict(),
        z.object({ kind: z.literal('skill-rules') }).strict(),
        z.object({ kind: z.literal('too-large'), file: z.string().min(1).max(200) }).strict(),
      ])
      .nullable(),
  })
  .strict()

/** {@link SavedMethodsUse} as a launch's row keeps it. */
const SavedMethodsUseRecord: z.ZodType<SavedMethodsUse> = z.discriminatedUnion('given', [
  z.object({ given: z.literal('none') }).strict(),
  z
    .object({
      given: z.literal('index'),
      folder: z.string().min(1).max(4096),
      methods: z.number().int().nonnegative(),
      leftOut: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      index: z.string().max(SAVED_METHODS_MOST_INDEX_BYTES),
      readAt: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      given: z.literal('refused'),
      refusal: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('too-large'), bytes: z.number().int().nonnegative() }).strict(),
        z
          .object({
            kind: z.literal('a-link'),
            what: z.enum(['the-folder', 'the-index', 'a-method']),
          })
          .strict(),
        z
          .object({ kind: z.literal('not-a-file'), what: z.enum(['the-folder', 'the-index']) })
          .strict(),
        z.object({ kind: z.literal('index-file-too-large') }).strict(),
        z.object({ kind: z.literal('unreadable') }).strict(),
      ]),
      readAt: z.number().int().nonnegative(),
    })
    .strict(),
])

const MOST_FILES_KEPT = 200
const MOST_MEMORY_KEPT = 1_000
const MOST_SECTIONS_KEPT = 50
const MOST_TEXT_KEPT = 1024 * 1024
const MOST_SETTINGS_KEPT = 40
const MOST_SETTING_ITEMS_KEPT = 200

const LAUNCH_SETTING_KEYS: ReadonlySet<string> = new Set<LaunchSettingKey>([
  'settings-sources',
  'memory-folder',
  'built-in-tools',
  'denied-tools',
  'mode',
  'connectors',
  'attribution',
  'memory',
  'thread-overrides',
  'plan-tool',
  'approval-sandbox',
  'collaboration-mode',
  'approval',
  'tools-off',
  'tools-left-on',
])

const isString = (value: unknown): value is string => typeof value === 'string'
const isText = (value: unknown): value is string =>
  isString(value) && value.length <= MOST_TEXT_KEPT
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isKnownKind = (value: unknown): value is GivenFileKind =>
  isString(value) && KNOWN_KINDS.has(value)
const WHOSE: ReadonlySet<string> = new Set(WHOSE_TEXT)

/** A stored setting's value, kept only when it is one this module writes. */
function aSettingValue(value: unknown): LaunchSettingValue | undefined {
  if (value === null || typeof value === 'boolean' || isText(value)) return value
  if (!Array.isArray(value) || value.length > MOST_SETTING_ITEMS_KEPT) return undefined
  return value.every(isText) ? value : undefined
}

/** Stored settings, each kept only when it is one. */
function settingsIn(value: unknown): LaunchSetting[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MOST_SETTINGS_KEPT).flatMap((one: unknown): LaunchSetting[] => {
    if (!isRecord(one) || !isString(one['key']) || !LAUNCH_SETTING_KEYS.has(one['key'])) return []
    const kept = aSettingValue(one['value'])
    return kept === undefined ? [] : [{ key: one['key'] as LaunchSettingKey, value: kept }]
  })
}

/** A stored span, kept only when it is one. */
function spansIn(value: unknown): InstructionSpan[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MOST_SECTIONS_KEPT).flatMap((one: unknown): InstructionSpan[] => {
    if (!isRecord(one)) return []
    const { whose, heading, start, end } = one
    if (!isString(whose) || !WHOSE.has(whose)) return []
    if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end < start) return []
    if (heading !== null && !isString(heading)) return []
    return [{ whose: whose as InstructionSpan['whose'], heading, start, end }]
  })
}

/**
 * **A stored record, read back defensively** — a ledger can be edited by hand, or written by a
 * newer build, so a field that is not what this module writes is dropped rather than trusted, and
 * every list and text is bounded. `null` when the record is not one.
 */
export function aLaunchRecordIn(stored: unknown): WhatALaunchGave | null {
  if (!isRecord(stored)) return null
  const placement = stored['placement']
  if (placement !== 'system-prompt' && placement !== 'first-message') return null
  const builtBy = stored['build']
  const build =
    isRecord(builtBy) && isString(builtBy['id']) && isString(builtBy['commit'])
      ? { id: builtBy['id'], commit: builtBy['commit'] }
      : null
  const profile = stored['profileFile']
  const profileFile =
    isRecord(profile) && isString(profile['path']) && isText(profile['text'])
      ? {
          path: profile['path'],
          text: profile['text'],
          sections: spansIn(profile['sections']),
          refused: isString(profile['refused']) ? profile['refused'] : null,
          ...(isText(profile['heading']) ? { heading: profile['heading'] } : {}),
        }
      : null
  const conversation = stored['thisConversation']
  const thisConversation =
    isRecord(conversation) && isText(conversation['text'])
      ? {
          text: conversation['text'],
          sections: spansIn(conversation['sections']),
          ...(isText(conversation['heading']) ? { heading: conversation['heading'] } : {}),
        }
      : null
  const files = Array.isArray(stored['files'])
    ? stored['files'].slice(0, MOST_FILES_KEPT).flatMap((one: unknown): GivenRecordFile[] => {
        if (!isRecord(one) || !isString(one['path']) || !isKnownKind(one['kind'])) return []
        return [
          {
            path: one['path'],
            kind: one['kind'],
            bytes: typeof one['bytes'] === 'number' ? one['bytes'] : 0,
            text: isText(one['text']) ? one['text'] : null,
            truncated: one['truncated'] === true,
            ...(isText(one['heading']) ? { heading: one['heading'] } : {}),
          },
        ]
      })
    : []
  const memory = Array.isArray(stored['memory'])
    ? stored['memory'].slice(0, MOST_MEMORY_KEPT).flatMap((one: unknown): GivenRecordMemory[] =>
        isRecord(one) && isString(one['path']) && isKnownKind(one['kind'])
          ? [
              {
                path: one['path'],
                kind: one['kind'] as InjectedInstructionKind,
                bytes: typeof one['bytes'] === 'number' ? one['bytes'] : 0,
                text: isText(one['text']) ? one['text'] : null,
              },
            ]
          : [],
      )
    : []
  const tools = stored['tools']
  const builtInSkills = BuiltInSkillsRecord.safeParse(stored['builtInSkills'])
  const textPack = TextPackUseRecord.safeParse(stored['textPack'])
  const savedMethods = SavedMethodsUseRecord.safeParse(stored['savedMethods'])
  return {
    ...(builtInSkills.success ? { builtInSkills: builtInSkills.data } : {}),
    ...(textPack.success ? { textPack: textPack.data } : {}),
    ...(savedMethods.success ? { savedMethods: savedMethods.data } : {}),
    build,
    placement,
    profileFile,
    ownInstructionsVersion:
      typeof stored['ownInstructionsVersion'] === 'number'
        ? stored['ownInstructionsVersion']
        : null,
    ownNotesVersion:
      typeof stored['ownNotesVersion'] === 'number' &&
      Number.isSafeInteger(stored['ownNotesVersion']) &&
      stored['ownNotesVersion'] >= 0
        ? stored['ownNotesVersion']
        : null,
    thisConversation,
    files,
    memory,
    tools:
      isRecord(tools) && isString(tools['server']) && isString(tools['sha256'])
        ? {
            server: tools['server'],
            count: typeof tools['count'] === 'number' ? tools['count'] : 0,
            sha256: tools['sha256'],
            ...(isText(tools['instructions']) ? { instructions: tools['instructions'] } : {}),
          }
        : { server: '', count: 0, sha256: '' },
    ...(Array.isArray(stored['settings']) ? { settings: settingsIn(stored['settings']) } : {}),
  }
}

// ── the popup's one read ──────────────────────────────────────────────────────────────────────────

/**
 * The mode every provider snapshot's conversation runs in: the capture opens each asking first and
 * not planning (`provider-snapshots.smoke.ts`).
 */
const SNAPSHOTS_ARE_CAPTURED_IN = { approval: 'ask', planning: false } as const

/** Who makes each kind of file, and the plain sentence the window draws for it. */
function originOf(
  kind: GivenFileKind,
  provider: Provider,
  /** The file's text is the workspace's own, as BroBot renders it. */
  brobots: boolean,
): { origin: GivenOrigin; madeAutomatically: boolean; says: string } {
  const theWorkspaces = {
    origin: 'brobot' as const,
    madeAutomatically: true,
    says: 'BroCrew writes this workspace file when the app starts and whenever a conversation opens in its workspace.',
  }
  switch (kind) {
    case 'profile-instructions':
      return {
        origin: 'brobot',
        madeAutomatically: true,
        says: 'BroCrew writes this file at every launch, from the rules it ships with and this agent’s own instructions.',
      }
    case 'workspace-instructions':
      return theWorkspaces
    case 'repository-conventions':
    case 'project-memory':
    case 'read-by-codex':
      if (brobots) return theWorkspaces
      return {
        origin: 'a-repository',
        madeAutomatically: false,
        says: providerKnowledge[provider].instructions.given.repositoryOrigin,
      }
    case 'profile-memory':
      return {
        origin: 'unknown',
        madeAutomatically: false,
        says: historicalProfileMemory.says,
      }
    case 'agent-memory':
    case 'agent-memory-topic':
    case 'agent-memory-note':
      return { origin: 'an-agent', madeAutomatically: false, says: 'Written by the agent.' }
    default:
      return {
        origin: 'unknown',
        madeAutomatically: false,
        says: 'This app can’t say who wrote this file.',
      }
  }
}

/** The own-instructions version, in the read's words. */
function versionOf(one: OwnInstructionsVersion): GivenVersion {
  return {
    version: one.version,
    whoWroteIt: one.whoWroteIt,
    whoWroteItMeans: WROTE_IT_MEANS[one.whoWroteIt],
    by: one.by,
    writtenAt: one.writtenAt,
    conversation: one.conversation,
    broughtBack: one.broughtBack,
  }
}

/** The sections of one of BroBot's texts, each with how it was made. */
function sectionsOf(
  text: string,
  spans: readonly InstructionSpan[],
  version: GivenVersion | null,
  ownNotesVersion: number | null = null,
): GivenSection[] {
  return spans.map((span) => {
    const made: GivenSection['made'] =
      span.whose === 'configured'
        ? 'own-instructions'
        : span.whose === 'own-notes'
          ? 'own-notes'
          : span.whose === 'dynamic'
            ? 'composed-at-launch'
            : 'shipped'
    return {
      heading: span.heading,
      whose: span.whose,
      made,
      version: made === 'own-instructions' ? version : null,
      ...(made === 'own-notes' ? { ownNotesVersion } : {}),
      start: span.start,
      end: span.end,
      size: sizeOf(text.slice(span.start, span.end)),
    }
  })
}

/** What {@link whatItWasGiven} is handed. */
export interface WhatTheReadIsHanded {
  readonly sessionId: string
  readonly provider: Provider
  readonly profileId: string | null
  readonly launch: GivenLaunch
  /** The launch's record, or one composed now when the launch kept none. */
  readonly record: WhatALaunchGave
  readonly own: OwnInstructions | null
  /** The toolset now, as this build hands it over. */
  readonly toolset: AgentToolset
  /** The tool names the provider last published for this conversation, or `null`. */
  readonly published: readonly string[] | null
  /** When the provider published {@link published}: its row's time, or `null`. */
  readonly publishedAt: number | null
  /**
   * The provider's newest command list since the conversation's newest launch, with its row's time,
   * or `null` where it has listed none since.
   */
  readonly listedCommands: {
    readonly commands: readonly ProviderCommand[]
    readonly at: number
    /** Rows the provider named that the list does not carry. */
    readonly dropped: number
  } | null
  /**
   * The sentence the provider's thread was started with, off its tool list's
   * `declared.instructions`, or `null` where no start says it whole. Never a resume's: that
   * states this build's sentence, and the thread keeps the one it started with. Never one at the
   * list's text cap, which may have been cut.
   */
  readonly declaredWith: string | null
  /** The external servers this agent is handed now, by name. */
  readonly externalServers: readonly string[]
  readonly memory: { readonly stores: readonly AgentMemoryStore[]; readonly readAt: number }
  readonly providerVersion: string | null
  /** What the host looked up for this conversation's model, or `null`: this app carries none. */
  readonly snapshot: { readonly model: string | null; readonly answer: SnapshotAnswer } | null
  readonly context: ContextReading | null
  readonly now: number
  /**
   * The conversation's approval mode and whether it is planning, as this app's record of it holds
   * them now; `null` where the record does not say.
   */
  readonly standsNow: {
    readonly approval: 'ask' | 'auto' | null
    readonly planning: boolean | null
  }
}

/** A file as its launch gave it, with whether it is still the same on disk. */
function aFileAsLaunched(
  provider: Provider,
  path: string,
  kind: GivenFileKind,
  text: string,
  textIs: GivenTextIs,
  sections: readonly GivenSection[],
  truncated: boolean,
  refused: string | null,
): GivenFile {
  const origin = originOf(kind, provider, isBroBotsWorkspaceText(text))
  const now = textIs === 'as-launched' ? readNow(path) : null
  return {
    path,
    kind,
    origin: origin.origin,
    madeAutomatically: origin.madeAutomatically,
    originSays: origin.says,
    reach: 'in-every-request',
    text,
    textIs,
    changedSinceLaunch: now === null ? null : now.text !== text,
    truncated,
    sections,
    size: sizeOf(text),
    refused,
  }
}

/** A file whose launch kept no text, read now. */
function aFileReadNow(provider: Provider, file: GivenRecordFile, recorded: boolean): GivenFile {
  const now = readNow(file.path)
  const brobots = now !== null && isBroBotsWorkspaceText(now.text)
  const origin = originOf(file.kind, provider, brobots)
  return {
    path: file.path,
    kind: file.kind,
    origin: origin.origin,
    madeAutomatically: origin.madeAutomatically,
    originSays: origin.says,
    reach: 'in-every-request',
    text: now?.text ?? null,
    textIs: now === null ? 'unreadable' : recorded ? 'read-now' : 'composed-now',
    changedSinceLaunch: null,
    truncated: recorded ? file.truncated : (now?.truncated ?? false),
    sections: [],
    size: sizeOf(now?.text ?? ''),
    refused: null,
  }
}

/**
 * The line the model read above each file BroBot sent ({@link headingAsSent}): on
 * Claude, in the order the model read them, the preamble in front of the first. None on a file it
 * did not send. For the launch, which keeps them, and for a read of a launch that kept none.
 */
function headingsAsSentFor(
  files: readonly {
    readonly path: string
    readonly kind: GivenFileKind
    readonly refused: string | null
  }[],
  preamble?: string,
): (string | undefined)[] {
  let first = true
  return files.map(({ path, kind, refused }) => {
    if (refused !== null || kind === 'read-by-codex') return undefined
    const heading = headingAsSent({ path, kind }, first, preamble)
    first = false
    return heading
  })
}

/**
 * Each file with the line the model read above it: the one its launch kept, else this build's
 * ({@link headingsAsSentFor}), and which.
 */
function withTheirHeadings(
  files: readonly GivenFile[],
  kept: readonly (string | undefined)[],
): GivenFile[] {
  const composed = headingsAsSentFor(files)
  return files.map((file, at) => {
    if (composed[at] === undefined) return file
    const launched = kept[at]
    return launched === undefined
      ? { ...file, heading: composed[at], headingIs: 'composed-now' as const }
      : { ...file, heading: launched, headingIs: 'as-launched' as const }
  })
}

/** One memory entry, read now, compared with the launch's by its name in the store. */
function aMemoryEntry(
  provider: Provider,
  item: InjectedInstruction & { readonly amendable: boolean },
  atLaunch: readonly GivenRecordMemory[],
  recorded: boolean,
): GivenMemoryEntry {
  const name = basename(item.path)
  const kept = atLaunch.find((one) => one.kind === item.kind && basename(one.path) === name)
  const origin = providerKnowledge[provider].memory.entryOrigin(item.kind)
  return {
    path: item.path,
    kind: item.kind,
    origin,
    reach: item.reach === 'prompt' ? 'in-every-request' : 'when-the-agent-opens-it',
    text: item.text,
    truncated: item.truncated,
    changedSinceLaunch:
      recorded && kept !== undefined && kept.text !== null ? kept.text !== item.text : null,
    textIs: recorded && kept?.text === item.text ? 'as-launched' : 'read-now',
    amendable: item.amendable,
    size: sizeOf(item.text),
  }
}

/**
 * The provider's own parts — the snapshot this build carries for the conversation's model, or why
 * there is none. A snapshot is of the provider version this build bundles, so it says so when the
 * app runs another, or when another build of this app made the launch.
 */
function providerPartsOf(
  provider: Provider,
  version: string | null,
  looked: WhatTheReadIsHanded['snapshot'],
  launch: GivenLaunch,
): GivenProviderParts {
  const name = providerDescriptor(provider).programName
  if (looked === null) {
    return {
      version,
      model: null,
      snapshot: null,
      why: `This app carries no snapshot of what ${name} puts in front of its model on its own.`,
    }
  }
  const { model, answer } = looked
  if (!answer.found) return { version, model, snapshot: null, why: answer.why }
  const snapshot = answer.snapshot
  return {
    version,
    model,
    snapshot,
    why:
      version !== null && version !== snapshot.version
        ? `This app runs ${name} ${version}, and the snapshot is ${snapshot.label}.`
        : launch.recorded && !launch.thisBuild
          ? `Another build of this app made this conversation’s last launch, and its ${name} may have put other parts in front of the model.`
          : null,
  }
}

/**
 * The agent-input popup's one read ({@link WhatThisAgentWasGiven}): each text as its launch kept
 * it, with whether it changed since, and memory read now. Sizes are characters, words, and
 * characters ÷ 4 as tokens, an estimate. A file that did not reach the model is listed but not
 * counted.
 */
export function whatItWasGiven(handed: WhatTheReadIsHanded): WhatThisAgentWasGiven {
  const { record, provider } = handed
  const givenPolicy = providerKnowledge[provider].instructions.given
  const recorded = handed.launch.recorded
  const textIs: 'as-launched' | 'composed-now' = recorded ? 'as-launched' : 'composed-now'
  const versions = handed.own?.versions ?? []
  const newestVersion =
    versions.length === 0 ? null : versionOf(versions[0] as OwnInstructionsVersion)
  const usedVersion =
    record.ownInstructionsVersion === null
      ? null
      : (versions.map(versionOf).find((one) => one.version === record.ownInstructionsVersion) ??
        null)

  // ── files, in the order the model reads them ──
  const files: GivenFile[] = []
  if (record.profileFile !== null) {
    const profile = record.profileFile
    files.push(
      aFileAsLaunched(
        provider,
        profile.path,
        'profile-instructions',
        profile.text,
        textIs,
        sectionsOf(profile.text, profile.sections, usedVersion, record.ownNotesVersion ?? null),
        false,
        profile.refused,
      ),
    )
  }
  for (const file of record.files) {
    files.push(
      file.text !== null
        ? aFileAsLaunched(
            provider,
            file.path,
            file.kind,
            file.text,
            textIs,
            [],
            file.truncated,
            null,
          )
        : aFileReadNow(provider, file, recorded),
    )
  }

  // On Claude, the line the model read above each file BroBot sent. Only a record a
  // launch kept says what the launch sent: one composed for this read is this build's.
  const headed =
    providerDescriptor(provider).contextPlacement === 'system-prompt'
      ? withTheirHeadings(
          files,
          recorded
            ? [
                ...(record.profileFile === null ? [] : [record.profileFile.heading]),
                ...record.files.map((file) => file.heading),
              ]
            : [],
        )
      : files

  // ── this conversation's own text ──
  const conversation = record.thisConversation
  const keptHeading = recorded ? conversation?.heading : undefined
  const thisConversation: GivenText | null =
    conversation === null
      ? null
      : {
          text: conversation.text,
          textIs,
          sections: sectionsOf(
            conversation.text,
            conversation.sections,
            null,
            record.ownNotesVersion ?? null,
          ),
          size: sizeOf(conversation.text),
          heading: keptHeading ?? THIS_CONVERSATION_HEADER,
          headingIs: keptHeading === undefined ? 'composed-now' : 'as-launched',
        }

  // ── tools ──
  const list: GivenTool[] = handed.toolset.tools.map((tool) => {
    const parameters = parametersOf(tool)
    return {
      name: tool.name,
      description: tool.description,
      parameters,
      size: sizeOf(JSON.stringify({ name: tool.name, description: tool.description, parameters })),
    }
  })
  const nativeToolNames = givenPolicy.toolNames(
    handed.toolset.server,
    list.map((tool) => tool.name),
    handed.published,
    handed.externalServers,
  )
  const deferral = givenPolicy.deferral(handed.published)
  // The paragraph its launch kept, else this build's.
  const instructionsKept = recorded ? record.tools.instructions : undefined
  const instructionsText = instructionsKept ?? handed.toolset.instructions ?? ''
  // Codex declares the tools under a namespace with a sentence of its own; Claude has none.
  const namespaceText = givenPolicy.namespaceText(handed.declaredWith, list.length)
  const tools = {
    server: handed.toolset.server,
    declarationNames: nativeToolNames.declarations,
    instructions: {
      text: instructionsText,
      ridesIn: 'in-the-first-message' as const,
      textIs: instructionsKept === undefined ? ('composed-now' as const) : ('as-launched' as const),
      size: sizeOf(instructionsText),
    },
    ...(namespaceText === null
      ? {}
      : {
          namespace: {
            text: namespaceText,
            textIs:
              handed.declaredWith === null ? ('composed-now' as const) : ('as-launched' as const),
            size: sizeOf(namespaceText),
          },
        }),
    deferral,
    listedByTheProvider:
      nativeToolNames.published === null || handed.publishedAt === null
        ? null
        : {
            names: nativeToolNames.published,
            at: handed.publishedAt,
          },
    changedSinceLaunch: recorded
      ? toolsetFingerprint(handed.toolset) !== record.tools.sha256
      : null,
    list,
    size: sizesAdded(list.map((one) => one.size)),
  }

  // ── external servers: names only ──
  const externalServers: GivenExternalServer[] = nativeToolNames.external.map((server) => ({
    ...server,
    deferral: givenPolicy.externalDeferral(handed.published),
  }))

  // ── memory, read now ──
  const stores: GivenMemoryStore[] = handed.memory.stores.map((store) => ({
    provider: store.provider,
    state: store.state,
    dir: store.dir,
    entries: store.entries.map((item) =>
      aMemoryEntry(store.provider, item, record.memory, recorded),
    ),
    total: store.total ?? store.entries.length,
    nextOffset: store.nextOffset ?? null,
    refused: store.refused,
  }))

  const providerParts = providerPartsOf(
    provider,
    handed.providerVersion,
    handed.snapshot,
    handed.launch,
  )

  const disabled = recorded
    ? record.settings?.find((one) => one.key === 'tools-off')?.value
    : undefined
  const notSentDeclarations = Array.isArray(disabled)
    ? (providerParts.snapshot?.parts ?? [])
        .flatMap((part) => part.tools ?? [])
        .filter((tool) => !givenPolicy.toolWasSent(tool.name, disabled))
        .map((tool) => tool.name)
    : undefined

  // ── sizes: what reaches the model ──
  const reaching = files.filter((one) => one.refused === null)
  const brobot = sizesAdded([
    ...reaching.filter((one) => one.origin === 'brobot').map((one) => one.size),
    ...(thisConversation === null ? [] : [thisConversation.size]),
    ...(record.builtInSkills ? [sizeOf(record.builtInSkills.reminder)] : []),
    // On Codex the paragraph is already in this conversation's text ("The brobot tools").
    ...(providerDescriptor(provider).contextPlacement === 'system-prompt'
      ? [tools.instructions.size]
      : []),
  ])
  const otherFiles = sizesAdded(
    reaching.filter((one) => one.origin !== 'brobot').map((one) => one.size),
  )
  // The definitions in full, with the sentence they are declared under where one is sent.
  const toolsInFull = sizesAdded([
    tools.size,
    ...(tools.namespace === undefined ? [] : [tools.namespace.size]),
  ])
  const toolsInEveryRequest =
    deferral.kind === 'names-until-loaded' ? sizeOf(nativeToolNames.namesOnlyText) : toolsInFull
  const otherServers = givenPolicy.otherServers(
    handed.published,
    tools.server,
    handed.externalServers,
  )
  const memoryInEveryRequest = sizesAdded(
    stores
      .filter((store) => store.provider === provider)
      .flatMap((store) => store.entries)
      .filter((entry) => entry.reach === 'in-every-request')
      .map((entry) => entry.size),
  )
  // The snapshot's own total: what is in front of the model before it asks for anything.
  const shot = providerParts.snapshot
  const providerSize: PartSize | null =
    shot === null ? null : { characters: shot.chars, words: shot.words, tokens: shot.approxTokens }
  const total = sizesAdded([
    brobot,
    otherFiles,
    toolsInEveryRequest,
    ...(otherServers.size === null ? [] : [otherServers.size]),
    memoryInEveryRequest,
    ...(providerSize === null ? [] : [providerSize]),
  ])
  const window = handed.context?.kind === 'proportional' ? handed.context.window : null

  // ── the launch's settings, beside where the conversation stands now ──
  const planKey = providerKnowledge[provider].instructions.given.planningKey
  const { approval, planning } = handed.standsNow
  const nowOf = (key: LaunchSettingKey): { now: LaunchSettingValue } | object =>
    key === 'approval'
      ? { now: approval }
      : key === planKey
        ? { now: planning === null ? null : planning ? 'plan' : 'default' }
        : {}
  const keptSettings = recorded ? record.settings : undefined
  const launchSettings: GivenLaunchSettings =
    keptSettings === undefined
      ? {
          recorded: false,
          settings: (['approval', planKey] as const).map((key) => ({
            key,
            atLaunch: null,
            ...nowOf(key),
          })),
        }
      : {
          recorded: true,
          settings: keptSettings.map((one) => ({
            key: one.key,
            atLaunch: one.value,
            ...nowOf(one.key),
          })),
        }

  // ── skills: Codex's list is its skills, each with its file; Claude loads none from disk ──
  const skills = providerKnowledge[provider].skills.asGiven(
    handed.listedCommands,
    Boolean(record.builtInSkills),
  )

  return {
    sessionId: handed.sessionId,
    provider,
    profileId: handed.profileId,
    readAt: handed.now,
    launch: handed.launch,
    placement: record.placement,
    files: headed,
    thisConversation,
    ownInstructions: {
      used: recorded ? usedVersion : newestVersion,
      newest: newestVersion,
      changedSinceLaunch:
        recorded && (newestVersion?.version ?? null) !== (usedVersion?.version ?? null),
    },
    ...(typeof record.ownNotesVersion === 'number'
      ? { ownNotesVersion: record.ownNotesVersion }
      : {}),
    tools: { ...tools, ...(notSentDeclarations === undefined ? {} : { notSentDeclarations }) },
    externalServers,
    memory: { readAt: handed.memory.readAt, stores, atLaunch: recorded ? record.memory : [] },
    providerParts:
      providerParts.snapshot === null
        ? providerParts
        : { ...providerParts, capturedIn: SNAPSHOTS_ARE_CAPTURED_IN },
    launchSettings,
    skills,
    ...(record.builtInSkills ? { builtInSkills: record.builtInSkills } : {}),
    ...(record.textPack ? { textPack: record.textPack } : {}),
    ...(record.savedMethods ? { savedMethods: record.savedMethods } : {}),
    size: {
      brobot,
      otherFiles,
      tools: toolsInFull,
      toolsInEveryRequest,
      otherServersToolsInEveryRequest: otherServers.size,
      otherServersToolsWhy: otherServers.why,
      memoryInEveryRequest,
      provider: providerSize,
      total,
      contextWindow: window === null ? null : { tokens: window, share: total.tokens / window },
      contextWindowWhy:
        window !== null
          ? null
          : handed.context === null
            ? 'No context reading has come in for this conversation yet.'
            : handed.context.kind === 'unknown'
              ? NO_SIZE_SINCE_A_COMPACTION
              : `${providerDescriptor(provider).displayName} does not report its window size.`,
    },
  }
}

/**
 * Why no share of the window is shown while the context has no current reading: it was compacted,
 * and its provider has not said the size it left.
 */
export const NO_SIZE_SINCE_A_COMPACTION = 'Size unavailable.'

// ── one message as the model got it ───────────────────────────────────────────────────────

/** An earlier message of the same launch, newest first: its place, what was handed over with it,
 * and whether it was the launch's first. */
export interface AnEarlierMessage {
  readonly ordinal: number
  readonly sent: unknown
  readonly first: boolean
}

/** What the per-message read is handed: the message's row, its launch's, and the provider's record of it. */
export interface WhatTheMessageReadIsHanded {
  readonly sessionId: string
  readonly provider: Provider
  readonly message: { readonly ordinal: number; readonly at: number; readonly event: UserTurnEvent }
  /**
   * The launch it was handed over in, and what that launch kept: its record, none, one this app
   * could not read, or one it does not take from a conversation brought in from elsewhere.
   */
  readonly launch: {
    readonly ordinal: number
    readonly at: number
    readonly kept: 'recorded' | 'none' | 'unreadable' | 'imported'
    readonly record: WhatALaunchGave | null
  } | null
  readonly firstOfItsLaunch: boolean | null
  /** The launch's messages before this one, newest first — walked only to find where a lead rode. */
  readonly earlierInThisLaunch: () => Iterable<AnEarlierMessage>
  /**
   * **On Codex, each lead its thread was handed and still holds, up to and including this
   * message**, oldest first (`codex-lead.ts`): a reopen sends only what the thread does not hold, so
   * the lead the model has may have ridden an earlier launch. `null` or absent: the record cannot say.
   */
  readonly leadsInThisThread?: readonly ALeadCarried[] | null
  /** The provider's own record of the turn, as `turnAsSent` read it. */
  readonly providersRecord: TurnAsSent
}

const NOT_KEPT = 'This app kept no copy of this file at its launch.'

/** Why BroBot's profile file did not reach the model, by the reader's reason for it. */
function whyItWasNotSent(reason: string): string {
  if (reason === 'unmanaged-override') {
    return 'It did not reach the model: someone else’s file is at the name BroCrew publishes it under, and BroCrew left that file alone.'
  }
  if (reason === 'over-budget') {
    return 'It did not reach the model: the instructions’ size limit ran out before it.'
  }
  return 'It did not reach the model: this app’s reader did not send it.'
}

/** A file's title, in plain words. */
function titleOfFile(kind: GivenFileKind, path: string, brobots: boolean): string {
  if (kind === 'profile-instructions') return 'BroCrew’s instructions for this agent'
  if (kind === 'workspace-instructions' || brobots) return 'BroCrew’s workspace file'
  if (kind === 'profile-memory') return historicalProfileMemory.title
  return `${basename(path)}, this folder’s own file`
}

/**
 * Whose words a message carried, when every message of the turn says the same: an agent's,
 * BroBot's own, a person's. Otherwise unknown — and so is a turn whose messages cannot be read, or
 * a row rebuilt from a provider's own transcript.
 */
function whoseWords(event: UserTurnEvent): GivenOrigin {
  const each = theMessagesOf(event).map((one): GivenOrigin => {
    if (one.relayedFrom !== undefined) return 'an-agent'
    if (one.attribution === 'app_authored') return 'brobot'
    if (one.attribution === 'provider_transcript') return 'unknown'
    return 'a-person'
  })
  const [first] = each
  return first !== undefined && each.every((one) => one === first) ? first : 'unknown'
}

/**
 * One message as the model got it ({@link WhatTheModelGot}), from BroBot's own
 * records: the launch's (`launched.given`) for what sat in the system prompt or the first message,
 * and the message's (`user_turn.sent`) for what was handed over with it.
 *
 * **Where each part sat.** On Claude, BroBot's instructions, the files it sent and this
 * conversation's text are in the system prompt of every request. On Codex, Codex reads its files
 * into the first message, and this conversation's lead rides in front of a message — the first of
 * each launch that carries words, and again after a compaction or a turn Codex never began. It is
 * split off the front of the message it rode, named where it last rode before it otherwise, and
 * said not to have reached the model yet when no message so far carried it.
 *
 * Nothing is read from disk here.
 */
export function oneMessageAsTheModelGotIt(handed: WhatTheMessageReadIsHanded): WhatTheModelGot {
  const { provider, message, launch } = handed
  const record = launch?.kept === 'recorded' ? launch.record : null
  const inSystem = providerDescriptor(provider).contextPlacement === 'system-prompt'
  /** Where BroBot's instructions sit: Claude's system prompt, or the first message Codex reads its
   * files into. */
  const instructionsSit: ModelGotWhere = providerDescriptor(provider).contextPlacement
  const parts: ModelGotPart[] = []
  const add = (
    where: ModelGotWhere,
    kind: ModelGotPart['kind'],
    title: string,
    origin: GivenOrigin,
    path: string | null,
    text: string | null,
    why = '',
    heading?: string,
  ): void => {
    parts.push({
      where,
      kind,
      title,
      origin,
      path,
      text,
      why: text === null ? why : null,
      size: text === null ? null : sizeOf(text),
      ...(heading === undefined ? {} : { heading }),
    })
  }
  // Historical framing is known only when this launch kept it.
  const headingOf = (path: string): string | undefined => {
    if (!inSystem) return undefined
    return record?.profileFile?.path === path
      ? record.profileFile.heading
      : record?.files.find((file) => file.path === path)?.heading
  }
  const unrecorded =
    launch === null
      ? 'This app’s record of the conversation holds no launch before this message.'
      : launch.kept === 'imported'
        ? 'This conversation was brought in from elsewhere, and this app describes only the launches it made itself.'
        : launch.kept === 'unreadable'
          ? 'This message’s launch kept a record this app could not read.'
          : 'This message’s launch kept no record of what it gave: it was made before this app kept one, or keeping it failed.'
  const instructionsTitle = titleOfFile('profile-instructions', '', true)

  // ── BroBot's instructions, and the files the launch sent or Codex read ──
  if (record === null) {
    add(
      instructionsSit,
      'profile-instructions',
      instructionsTitle,
      'brobot',
      null,
      null,
      unrecorded,
    )
  } else {
    const profile = record.profileFile
    if (profile !== null) {
      add(
        instructionsSit,
        'profile-instructions',
        instructionsTitle,
        'brobot',
        profile.path,
        profile.refused === null ? profile.text : null,
        whyItWasNotSent(profile.refused ?? ''),
        profile.refused === null ? headingOf(profile.path) : undefined,
      )
    }
    // The provider's one budget for native instruction files, spent in read order.
    let nativeReadBytes = 0
    for (const file of record.files) {
      const brobots = file.text !== null && isBroBotsWorkspaceText(file.text)
      if (historicalInstructionReads.matches(file.kind)) nativeReadBytes += file.bytes
      const pastTheBudget =
        !brobots &&
        historicalInstructionReads.matches(file.kind) &&
        historicalInstructionReads.mayBeCut(nativeReadBytes, file.truncated)
      add(
        instructionsSit,
        file.kind,
        titleOfFile(file.kind, file.path, brobots),
        originOf(file.kind, provider, brobots).origin,
        file.path,
        pastTheBudget ? null : file.text,
        pastTheBudget ? historicalInstructionReads.why : NOT_KEPT,
        historicalInstructionReads.matches(file.kind) ? undefined : headingOf(file.path),
      )
    }
  }

  // ── this conversation's own text ──
  const words = theMessagesOf(message.event).map((one) => one.text)
  const stored: unknown = message.event.sent
  const sent = typeof stored === 'string' ? stored : null
  const conversation = record?.thisConversation ?? null
  const block = conversation === null ? null : conversationBlock(conversation.text)
  /** Whether a text handed over carried this conversation's lead in front. */
  const carries = (text: unknown): boolean =>
    block !== null && typeof text === 'string' && text.startsWith(`${block}\n\n`)
  // On Codex, the lead in front of this message: as the thread's record says, else when
  // the text handed over starts with this launch's whole block.
  const leadsHeld = handed.leadsInThisThread ?? null
  const carriedHere = leadsHeld?.find((one) => one.ordinal === message.ordinal)
  const lead = inSystem ? null : (carriedHere?.text ?? (carries(sent) ? block : null))
  const aboutIt = 'What is true of this conversation'
  if (record === null) {
    add(instructionsSit, 'this-conversation', aboutIt, 'brobot', null, null, unrecorded)
  } else if (block !== null) {
    if (inSystem) add('system-prompt', 'this-conversation', aboutIt, 'brobot', null, block)
    else if (leadsHeld !== null && leadsHeld.length > 0) {
      // What the thread holds: the newest whole lead it was handed, and each change
      // sent after it, each where it rode — this message, this launch, or an earlier launch.
      const carried = leadsHeld
      const fromWhole = carried.map((one) => one.is).lastIndexOf('whole')
      for (const one of fromWhole === -1 ? carried : carried.slice(fromWhole)) {
        const here = one.ordinal === message.ordinal
        const thisLaunch = launch !== null && one.ordinal > launch.ordinal
        const where: ModelGotWhere = here
          ? 'this-message'
          : thisLaunch && one.firstOfItsLaunch
            ? 'first-message'
            : 'an-earlier-message'
        const rodeIn = here
          ? 'this message'
          : thisLaunch
            ? one.firstOfItsLaunch
              ? 'the first message of this launch'
              : 'an earlier message of this launch'
            : 'a message of an earlier launch'
        add(
          where,
          'this-conversation',
          one.is === 'whole'
            ? `${aboutIt}, in front of ${rodeIn}`
            : `What changed in it since, in front of ${rodeIn}`,
          'brobot',
          null,
          one.text,
        )
      }
    } else if (lead !== null) {
      add(
        'this-message',
        'this-conversation',
        `${aboutIt}, in front of this message`,
        'brobot',
        null,
        lead,
      )
    } else {
      // Where it last rode before this message — walked back through the launch.
      let rode: AnEarlierMessage | null = null
      let unknown = sent === null
      for (const one of handed.earlierInThisLaunch()) {
        if (carries(one.sent)) {
          rode = one
          break
        }
        if (typeof one.sent !== 'string') unknown = true
      }
      if (rode !== null) {
        add(
          rode.first ? 'first-message' : 'an-earlier-message',
          'this-conversation',
          `${aboutIt}, in front of ${rode.first ? 'the first message' : 'an earlier message'} of this launch`,
          'brobot',
          null,
          block,
        )
      } else {
        add(
          'first-message',
          'this-conversation',
          aboutIt,
          'brobot',
          null,
          null,
          unknown
            ? 'Where it rode is not known: this app kept no copy of the text handed over with every message of this launch.'
            : 'It had not reached the model by this message: it rides in front of the next message that carries words.',
        )
      }
    }
  }

  // ── the message ──
  const event = message.event
  const noModelMessage =
    words.length === 1
      ? providerDefinitions[provider].transcripts.noModelMessageReason?.(words[0] ?? '')
      : null
  add(
    'this-message',
    'the-message',
    // A turn of several held messages went over as one text, every message in it.
    words.length > 1
      ? `The ${String(words.length)} messages as BroCrew handed them over, together in one turn`
      : 'The message as BroCrew handed it over',
    whoseWords(event),
    null,
    sent === null || lead === null ? sent : sent.slice(lead.length + 2),
    theMessagesOf(event)[0]?.attribution === 'provider_transcript'
      ? 'This message was read from the provider’s own record: this app did not hand it over.'
      : noModelMessage != null
        ? noModelMessage
        : `This app kept no copy of the text it handed over for this ${words.length > 1 ? 'turn' : 'message'}.`,
  )

  return {
    sessionId: handed.sessionId,
    provider,
    ordinal: message.ordinal,
    at: message.at,
    words,
    launch:
      launch === null
        ? null
        : { ordinal: launch.ordinal, at: launch.at, recorded: record !== null },
    firstOfItsLaunch: handed.firstOfItsLaunch,
    parts,
    providersRecord: handed.providersRecord,
    // Not known for a message that carried a file: each provider keeps those in its own way.
    providerKeptTheSameText:
      handed.providersRecord.found &&
      sent !== null &&
      theMessagesOf(event).every((one) => (one.attachments?.length ?? 0) === 0)
        ? handed.providersRecord.message === sent
        : null,
  }
}
