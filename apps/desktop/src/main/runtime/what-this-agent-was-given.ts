import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import {
  CODEX_TOOLS_DESCRIPTION,
  type AgentToolset,
  type ContextReading,
  type LaunchSetting,
  type LaunchSettingKey,
  type LaunchSettingValue,
  MAX_COMMAND_TEXT,
  type ProviderCommand,
} from '@brobot2/runtime'
import { providerValue, type Provider } from '@brobot2/shared'
import type { AgentMemoryStore } from '../../shared/agent-memory'
import type { SnapshotAnswer } from '../../shared/provider-snapshots'
import type { TurnAsSent } from '../../shared/turn-as-sent'
import { INSTALLED_SKILL_BYTE_LIMIT } from '../../shared/skills-installation'
import {
  WROTE_IT_MEANS,
  type OwnInstructions,
  type OwnInstructionsVersion,
} from '../../shared/own-instructions'
import {
  theMessagesOf,
  type InjectedInstruction,
  type InjectedInstructionKind,
  type SessionInstructions,
  type UserTurnEvent,
} from '../../shared/runtime-ipc'
import {
  sizeOf,
  sizesAdded,
  type GivenBuiltInSkills,
  type GivenDeferral,
  type GivenExternalServer,
  type GivenFile,
  type GivenFileKind,
  type GivenLaunch,
  type GivenLaunchSettings,
  type GivenSkills,
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
import type { SavedMethodsNow, SavedMethodsUse } from '../../shared/saved-methods'
import { readSavedMethods } from '../saved-methods'
import type { TextPackUse } from '../../shared/text-pack'
import { realPathOf } from '../read-text-file'
import { type TheBuildRunning } from './factory-text'
import {
  codexConventionChain,
  conversationBlock,
  headingAsSent,
  INSTRUCTION_FILE_CAP,
  readInstructionFile,
  THIS_CONVERSATION_HEADER,
} from './instructions'
import { workspaceInstructionFiles } from './workspace'
import type { ALeadCarried } from './codex-lead'

/**
 * 🔴 **F093 · what a launch gives its agent, kept (R2) and read back (the popup's one read).**
 *
 * ⚑ **Two halves, one module.** {@link whatThisLaunchGave} builds the record a `launched` row keeps:
 * BroBot's own words in full, every other file and the memory by fingerprint. {@link whatItWasGiven}
 * reads it back for the window, with the files and memory read now beside it, the tools in full and
 * every size.
 *
 * ⛔ **The window never names a path.** Every file read here is one a launch named: a path its record
 * keeps, or a file the provider reported it read — and a record is trusted only off a launch this
 * app made (the host ignores one an imported ledger carries).
 */

/** ⚑ sha256 of a text, as hex. */
export function fingerprintOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** ⚑ The JSON Schema of a tool's arguments, as BroBot declares it (the Codex adapter's derivation). */
function parametersOf(tool: AgentToolset['tools'][number]): unknown {
  return z.toJSONSchema(z.looseObject(tool.input))
}

/** ⚑ A toolset's definitions, as one fingerprint: name, description and arguments of each. */
export function toolsetFingerprint(toolset: AgentToolset): string {
  return fingerprintOf(
    JSON.stringify(
      toolset.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: parametersOf(tool),
      })),
    ),
  )
}

/** ⚑ BroBot's profile file for one launch: its text, its sections, and whether it was published. */
export interface LaunchProfileFile {
  readonly path: string
  readonly text: string
  readonly spans: readonly InstructionSpan[]
  /** The reason it did not reach the model (`RefusedInstruction`'s code), else `null`. */
  readonly refused: string | null
}

/** ⚑ The workspace's own files, as BroBot renders them: text BroBot wrote. */
function isBroBotsWorkspaceText(text: string): boolean {
  return workspaceInstructionFiles().some((file) => file.content === text)
}

/**
 * ⚑ **The repository files Codex's own discovery would read in `cwd`, now** — one per folder, an
 * override before `AGENTS.md`, from the repository's root down to the folder ({@link codexConventionChain}).
 * ⚑ For a conversation whose launch reported none (one with no launch record); a live Codex
 * conversation's are the ones it reported.
 */
export function filesCodexWouldRead(cwd: string): string[] {
  return codexConventionChain(cwd).flatMap((dir) => {
    for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
      const path = join(dir, name)
      if (existsSync(path)) return [path]
    }
    return []
  })
}

/** ⚑ A file read now: its text and fingerprint. */
interface ReadNow {
  readonly text: string
  readonly bytes: number
  readonly truncated: boolean
  readonly sha256: string
}

/**
 * ⚑ **Read a file a launch named, now — with the launch's own reader and cap**
 * ({@link readInstructionFile}: links followed, 64 KiB, a strict decode), so an unchanged file
 * fingerprints as it did at launch. `null` when it cannot be read.
 */
export function readNow(path: string): ReadNow | null {
  const read = readInstructionFile(path, INSTRUCTION_FILE_CAP)
  if (!read.ok) return null
  return {
    text: read.text,
    bytes: read.bytes,
    truncated: read.truncated,
    sha256: fingerprintOf(read.text),
  }
}

/** ⚑ Two spellings of one file — compared where they really are, when both can be resolved. */
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
  /** The files the provider reported it read (Codex), else `[]`. */
  readonly reportedByTheProvider: readonly string[]
  readonly toolset: AgentToolset
  /** The settings the adapter says it launched with, or `undefined` where it says none. */
  readonly launchSettings?: readonly LaunchSetting[]
}

/**
 * 🔴 **F093 · R2 — the record one launch keeps** ({@link WhatALaunchGave}).
 *
 * ⛔ **BroBot's own words in full; nobody else's.** The profile file, the per-conversation text and
 * the workspace's file are BroBot's and kept whole; a repository's files and the agent's memory are
 * kept by path and fingerprint.
 */
export function whatThisLaunchGave(handed: WhatALaunchWasHanded): WhatALaunchGave {
  const { instructions } = handed
  const profileFile = theProfileFile(handed)
  const files: GivenRecordFile[] = []
  for (const item of instructions.injected) {
    if (item.kind === 'profile-instructions') continue
    const brobots = item.kind === 'workspace-instructions'
    files.push({
      path: item.path,
      kind: item.kind,
      bytes: item.bytes,
      sha256: fingerprintOf(item.text),
      truncated: item.truncated,
      ...(brobots ? { text: item.text } : {}),
    })
  }
  for (const path of handed.reportedByTheProvider) {
    if (profileFile !== null && theSameFile(path, profileFile.path)) continue
    if (files.some((one) => theSameFile(one.path, path))) continue
    const read = readNow(path)
    const brobots = read !== null && isBroBotsWorkspaceText(read.text)
    files.push({
      path,
      kind: 'read-by-codex',
      bytes: read?.bytes ?? 0,
      sha256: read?.sha256 ?? null,
      truncated: read?.truncated ?? false,
      ...(brobots && read !== null ? { text: read.text } : {}),
    })
  }
  const memory: GivenRecordMemory[] = instructions.agentMemory.map((item) => ({
    path: item.path,
    kind: item.kind,
    bytes: item.bytes,
    sha256: fingerprintOf(item.text),
  }))
  const conversation = instructions.thisConversation
  // ⚑ On Claude, the line the model read above each file BroBot sent, as this launch sent it.
  const headings = providerValue(handed.provider, { claude: true, codex: false })
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
    placement: providerValue(handed.provider, { claude: 'system-prompt', codex: 'first-message' }),
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

/** ⚑ The profile file the reader composed — or, on Claude, the one it appended. */
function theProfileFile(handed: WhatALaunchWasHanded): LaunchProfileFile | null {
  if (handed.profileFile !== null) return handed.profileFile
  const appended = handed.instructions.injected.find((item) => item.kind === 'profile-instructions')
  if (appended === undefined) return null
  return { path: appended.path, text: appended.text, spans: appended.sections ?? [], refused: null }
}

// ── reading a record back ─────────────────────────────────────────────────────────────────────────

/** ⚑ Every file kind a record may name — anything else is dropped on the way back in. */
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
/** ⚑ What a record read back keeps at most: far above any launch this app makes. */
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

/** {@link SavedMethodsUse} as a launch's row keeps it: counts, sizes and times only. */
const SavedMethodsUseRecord: z.ZodType<SavedMethodsUse> = z.discriminatedUnion('given', [
  z.object({ given: z.literal('none') }).strict(),
  z
    .object({
      given: z.literal('index'),
      folder: z.string().min(1).max(4096),
      methods: z.number().int().nonnegative(),
      leftOut: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
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

/** ⚑ A stored setting's value, kept only when it is one this module writes. */
function aSettingValue(value: unknown): LaunchSettingValue | undefined {
  if (value === null || typeof value === 'boolean' || isText(value)) return value
  if (!Array.isArray(value) || value.length > MOST_SETTING_ITEMS_KEPT) return undefined
  return value.every(isText) ? value : undefined
}

/** ⚑ Stored settings, each kept only when it is one. */
function settingsIn(value: unknown): LaunchSetting[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MOST_SETTINGS_KEPT).flatMap((one: unknown): LaunchSetting[] => {
    if (!isRecord(one) || !isString(one['key']) || !LAUNCH_SETTING_KEYS.has(one['key'])) return []
    const kept = aSettingValue(one['value'])
    return kept === undefined ? [] : [{ key: one['key'] as LaunchSettingKey, value: kept }]
  })
}

/** ⚑ A stored span, kept only when it is one. */
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
 * ⛔ **A stored record, read back defensively** — a ledger can be edited by hand, or written by a
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
            sha256: isString(one['sha256']) ? one['sha256'] : null,
            truncated: one['truncated'] === true,
            ...(isText(one['text']) ? { text: one['text'] } : {}),
            ...(isText(one['heading']) ? { heading: one['heading'] } : {}),
          },
        ]
      })
    : []
  const memory = Array.isArray(stored['memory'])
    ? stored['memory'].slice(0, MOST_MEMORY_KEPT).flatMap((one: unknown): GivenRecordMemory[] =>
        isRecord(one) &&
        isString(one['path']) &&
        isKnownKind(one['kind']) &&
        isString(one['sha256'])
          ? [
              {
                path: one['path'],
                kind: one['kind'] as InjectedInstructionKind,
                bytes: typeof one['bytes'] === 'number' ? one['bytes'] : 0,
                sha256: one['sha256'],
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
 * ⚑ The mode every provider snapshot's conversation runs in: the capture opens each asking first and
 * not planning (`provider-snapshots.smoke.ts`).
 */
const SNAPSHOTS_ARE_CAPTURED_IN = { approval: 'ask', planning: false } as const

/** ⚑ Who makes each kind of file, and the plain sentence the window draws for it. */
function originOf(
  kind: GivenFileKind,
  provider: Provider,
  /** ⚑ The file's text is the workspace's own, as BroBot renders it. */
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
        says: providerValue(provider, {
          claude:
            'This folder’s own file, written by whoever works in it — a person or an agent; this app can’t tell which. BroCrew reads it and sends it as it is.',
          codex:
            'This folder’s own file, written by whoever works in it — a person or an agent; this app can’t tell which. Codex reads it itself.',
        }),
      }
    case 'profile-memory':
      return {
        origin: 'unknown',
        madeAutomatically: false,
        says: 'This profile’s own CLAUDE.md, written by a person or by the agent; this app can’t tell which. BroCrew sends it as it is.',
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

/** ⚑ The own-instructions version, in the read's words. */
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

/** ⚑ The sections of one of BroBot's texts, each with how it was made. */
function sectionsOf(
  text: string,
  spans: readonly InstructionSpan[],
  version: GivenVersion | null,
): GivenSection[] {
  return spans.map((span) => {
    const made: GivenSection['made'] =
      span.whose === 'configured'
        ? 'own-instructions'
        : span.whose === 'dynamic'
          ? 'composed-at-launch'
          : 'shipped'
    return {
      heading: span.heading,
      whose: span.whose,
      made,
      version: made === 'own-instructions' ? version : null,
      start: span.start,
      end: span.end,
      size: sizeOf(text.slice(span.start, span.end)),
    }
  })
}

/** ⚑ How a provider hands a set of server tools to its model. */
function deferralOf(provider: Provider, published: readonly string[] | null): GivenDeferral {
  if (providerValue(provider, { claude: false, codex: true })) {
    return {
      kind: 'in-every-request',
      says: 'Codex hands the model every one of these, in full, in every request.',
    }
  }
  if (published === null) {
    return {
      kind: 'unknown',
      says: 'Claude has not reported its tool list for this conversation yet, so this app can’t tell how it hands these over.',
    }
  }
  return published.includes('ToolSearch')
    ? {
        kind: 'names-until-loaded',
        says: 'Claude puts only their names in front of the model, and the whole description when the agent loads one with its tool search.',
      }
    : {
        kind: 'in-every-request',
        says: 'Claude hands the model every one of these, in full, in every request.',
      }
}

/** ⚑ An external server's tools, as the provider hands them. */
function externalDeferralOf(
  provider: Provider,
  published: readonly string[] | null,
): GivenDeferral {
  if (providerValue(provider, { claude: false, codex: true })) {
    return {
      kind: 'found-by-search',
      says: 'Codex finds these with its tool search: until then the model sees neither their names nor their descriptions.',
    }
  }
  return deferralOf(provider, published)
}

/**
 * ⚑ **Other servers' tools, as the total counts them** ({@link GivenTotals.otherServersToolsInEveryRequest}):
 * the names the provider published that are neither BroBot's nor its own, as they stand in every
 * request — or nothing, or `null` with why. ⚠️ An estimate, like every size here: the list they
 * stand in is Claude's, and this counts the names alone.
 */
function otherServersToolsOf(
  provider: Provider,
  published: readonly string[] | null,
  brobotsServer: string,
  granted: readonly string[],
): { readonly size: PartSize | null; readonly why: string | null } {
  const nothing = sizesAdded([])
  const deferral = externalDeferralOf(provider, published)
  if (deferral.kind === 'found-by-search') {
    return {
      size: nothing,
      why:
        granted.length === 0
          ? null
          : 'Codex finds other servers’ tools with its tool search, so none of them is in every request.',
    }
  }
  if (published === null) {
    return granted.length === 0
      ? { size: nothing, why: null }
      : {
          size: null,
          why: 'Claude has not reported its tool list for this conversation yet, so this app can’t tell which other servers’ tools it sends.',
        }
  }
  const ours = `mcp__${brobotsServer}__`
  const names = published.filter((one) => one.startsWith('mcp__') && !one.startsWith(ours))
  if (names.length === 0) return { size: nothing, why: null }
  return deferral.kind === 'names-until-loaded'
    ? { size: sizeOf(names.join('\n')), why: null }
    : {
        size: null,
        why: 'Claude hands other servers’ tools over in full, and this app keeps none of their descriptions, so it can’t count them.',
      }
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
   * `declared.instructions`, or `null` where no start says it whole. ⚠️ Never a resume's: that
   * states this build's sentence, and the thread keeps the one it started with. ⚠️ Never one at the
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

/** ⚑ A file BroBot wrote, as launched, with whether it is still the same on disk. */
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
  const origin = originOf(kind, provider, true)
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

/** ⚑ A file somebody else wrote, read now, against the fingerprint its launch kept. */
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
    changedSinceLaunch:
      recorded && now !== null && file.sha256 !== null ? now.sha256 !== file.sha256 : null,
    // ⚑ What the model was given was cut where the launch cut it.
    truncated: recorded ? file.truncated : (now?.truncated ?? false),
    sections: [],
    size: sizeOf(now?.text ?? ''),
    refused: null,
  }
}

/**
 * ⚑ **W4.177 — the line the model read above each file BroBot sent** ({@link headingAsSent}): on
 * Claude, in the order the model read them, the preamble in front of the first. ⛔ None on a file it
 * did not send. ⚑ For the launch, which keeps them, and for a read of a launch that kept none.
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
 * ⚑ Each file with the line the model read above it: the one its launch kept, else this build's
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

/** ⚑ One memory entry, read now — compared with the launch's by its name in the store. */
function aMemoryEntry(
  provider: Provider,
  item: InjectedInstruction & { readonly amendable: boolean },
  atLaunch: readonly GivenRecordMemory[],
  recorded: boolean,
): GivenMemoryEntry {
  const name = basename(item.path)
  const kept = atLaunch.find((one) => one.kind === item.kind && basename(one.path) === name)
  const origin: GivenOrigin =
    providerValue(provider, { claude: false, codex: true }) && item.kind === 'agent-memory'
      ? 'the-provider'
      : 'an-agent'
  return {
    path: item.path,
    kind: item.kind,
    origin,
    reach: item.reach === 'prompt' ? 'in-every-request' : 'when-the-agent-opens-it',
    text: item.text,
    truncated: item.truncated,
    changedSinceLaunch:
      recorded && kept !== undefined ? fingerprintOf(item.text) !== kept.sha256 : null,
    textIs:
      recorded && kept !== undefined && fingerprintOf(item.text) === kept.sha256
        ? 'as-launched'
        : 'read-now',
    amendable: item.amendable,
    size: sizeOf(item.text),
  }
}

/**
 * ⚑ The provider's own parts — the snapshot this build carries for the conversation's model, or why
 * there is none. ⚠️ A snapshot is of the provider version this build bundles, so it says so when the
 * app runs another, or when another build of this app made the launch.
 */
function providerPartsOf(
  provider: Provider,
  version: string | null,
  looked: WhatTheReadIsHanded['snapshot'],
  launch: GivenLaunch,
): GivenProviderParts {
  const name = providerValue(provider, { claude: 'Claude Code', codex: 'Codex' })
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
 * The saved-methods index as the profile's folder holds it now, against the one this launch was
 * sent: its record keeps only the fingerprint, so the popup reads the folder again.
 */
export function savedMethodsNowFor(
  use: SavedMethodsUse,
  now: number,
): { readonly savedMethodsNow?: SavedMethodsNow } {
  if (use.given !== 'index' || use.methods === 0) return {}
  const read = readSavedMethods(use.folder, now)
  // No folder, or a folder with no index.md: either way the folder holds no index now.
  if (read.kind === 'none' || (read.kind === 'read' && !read.hasIndex)) {
    return { savedMethodsNow: { is: 'gone' } }
  }
  if (read.kind === 'refused') return { savedMethodsNow: { is: 'refused', refusal: read.refusal } }
  return {
    savedMethodsNow: {
      is: fingerprintOf(read.index) === use.sha256 ? 'same' : 'changed',
      index: read.index,
    },
  }
}

/**
 * 🔴 **F093 · the agent-input popup's one read** ({@link WhatThisAgentWasGiven}).
 *
 * ⚑ **BroBot's words as the launch kept them; everything else read now**, with whether it changed
 * since that launch beside it. ⛔ **Sizes are characters, words, and characters ÷ 4 as tokens** —
 * an estimate, which the window draws with "≈". ⚠️ A file that did not reach the model (refused)
 * is listed but not counted.
 */
export function whatItWasGiven(handed: WhatTheReadIsHanded): WhatThisAgentWasGiven {
  const { record, provider } = handed
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
        sectionsOf(profile.text, profile.sections, usedVersion),
        false,
        profile.refused,
      ),
    )
  }
  for (const file of record.files) {
    files.push(
      file.text !== undefined
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

  // ⚑ W4.177 — on Claude, the line the model read above each file BroBot sent. ⛔ Only a record a
  // launch kept says what the launch sent: one composed for this read is this build's.
  const headed = providerValue(provider, { claude: true, codex: false })
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
          sections: sectionsOf(conversation.text, conversation.sections, null),
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
  const deferral = deferralOf(provider, handed.published)
  // ⚑ The paragraph its launch kept, else this build's.
  const instructionsKept = recorded ? record.tools.instructions : undefined
  const instructionsText = instructionsKept ?? handed.toolset.instructions ?? ''
  // ⚑ Codex declares the tools under a namespace with a sentence of its own; Claude has none.
  const namespaceText =
    providerValue(provider, { claude: true, codex: false }) || list.length === 0
      ? null
      : (handed.declaredWith ?? CODEX_TOOLS_DESCRIPTION)
  const tools = {
    server: handed.toolset.server,
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
      handed.published === null || handed.publishedAt === null
        ? null
        : {
            names: handed.published.filter((one) =>
              one.startsWith(`mcp__${handed.toolset.server}__`),
            ),
            at: handed.publishedAt,
          },
    changedSinceLaunch: recorded
      ? toolsetFingerprint(handed.toolset) !== record.tools.sha256
      : null,
    list,
    size: sizesAdded(list.map((one) => one.size)),
  }

  // ── external servers: names only ──
  const externalServers: GivenExternalServer[] = handed.externalServers.map((name) => {
    const prefix = `mcp__${name}__`
    return {
      name,
      tools:
        handed.published === null
          ? null
          : handed.published
              .filter((one) => one.startsWith(prefix))
              .map((one) => one.slice(prefix.length)),
      deferral: externalDeferralOf(provider, handed.published),
    }
  })

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

  // ── sizes: what reaches the model ──
  const reaching = files.filter((one) => one.refused === null)
  const brobot = sizesAdded([
    ...reaching.filter((one) => one.origin === 'brobot').map((one) => one.size),
    ...(thisConversation === null ? [] : [thisConversation.size]),
    ...(record.builtInSkills ? [sizeOf(record.builtInSkills.reminder)] : []),
    // ⚑ On Codex the paragraph is already in this conversation's text ("The brobot tools").
    ...(providerValue(provider, { claude: true, codex: false }) ? [tools.instructions.size] : []),
  ])
  const otherFiles = sizesAdded(
    reaching.filter((one) => one.origin !== 'brobot').map((one) => one.size),
  )
  // ⚑ The definitions in full, with the sentence they are declared under where one is sent.
  const toolsInFull = sizesAdded([
    tools.size,
    ...(tools.namespace === undefined ? [] : [tools.namespace.size]),
  ])
  const toolsInEveryRequest =
    deferral.kind === 'names-until-loaded'
      ? sizeOf(list.map((one) => `mcp__${tools.server}__${one.name}`).join('\n'))
      : toolsInFull
  const otherServers = otherServersToolsOf(
    provider,
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
  // ⚑ The snapshot's own total: what is in front of the model before it asks for anything.
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
  const planKey: LaunchSettingKey = providerValue(provider, {
    claude: 'mode',
    codex: 'collaboration-mode',
  })
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
  const skills: GivenSkills = providerValue(provider, { claude: true, codex: false })
    ? {
        listed: null,
        at: null,
        dropped: null,
        why: record.builtInSkills ? 'not-listed-yet' : 'no-skill-files',
      }
    : handed.listedCommands === null
      ? { listed: null, at: null, dropped: null, why: 'not-listed-yet' }
      : {
          listed: handed.listedCommands.commands.map((one) => {
            const description = one.skill?.description ?? null
            return {
              name: one.name,
              description,
              descriptionMayBeCut: description !== null && description.length >= MAX_COMMAND_TEXT,
              path: one.skill?.path ?? null,
              scope: one.skill?.scope ?? null,
            }
          }),
          at: handed.listedCommands.at,
          dropped: handed.listedCommands.dropped,
          why: null,
        }

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
    tools,
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
    ...(record.savedMethods
      ? {
          savedMethods: record.savedMethods,
          ...savedMethodsNowFor(record.savedMethods, handed.now),
        }
      : {}),
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
              : `${providerValue(provider, { claude: 'Claude', codex: 'Codex' })} does not report its window size.`,
    },
  }
}

/**
 * Why no share of the window is shown while the context has no current reading: it was compacted,
 * and its provider has not said the size it left.
 */
export const NO_SIZE_SINCE_A_COMPACTION = 'Size unavailable.'

// ── one message as the model got it (C9 d) ───────────────────────────────────────────────────────

/** ⚑ An earlier message of the same launch, newest first: its place, what was handed over with it,
 * and whether it was the launch's first. */
export interface AnEarlierMessage {
  readonly ordinal: number
  readonly sent: unknown
  readonly first: boolean
}

/** ⚑ What the per-message read is handed: the message's row, its launch's, and R1's answer. */
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
   * ⚑ **W4.179 — on Codex, each lead its thread was handed and still holds, up to and including this
   * message**, oldest first (`codex-lead.ts`): a reopen sends only what the thread does not hold, so
   * the lead the model has may have ridden an earlier launch. `null` or absent: the record cannot say.
   */
  readonly leadsInThisThread?: readonly ALeadCarried[] | null
  /** R1 · the provider's own record of the turn, as `turnAsSent` read it. */
  readonly providersRecord: TurnAsSent
}

/** ⚑ Why a file's text is not in BroBot's record of a launch. */
const KEPT_BY_FINGERPRINT =
  'This app keeps this file by its fingerprint only, since BroCrew did not write it. The agent’s popup reads it now.'

/** ⚑ W4.177 — why, for a file kept by its fingerprint that has changed since its launch. */
const CHANGED_SINCE_ITS_LAUNCH =
  'This app keeps this file by its fingerprint only, since BroCrew did not write it, and the file has changed since this message’s launch: what the model got is not kept. The agent’s popup shows the file as it is now.'

/** ⚑ W4.177 — why, for a file kept by its fingerprint that cannot be read now. */
const UNREADABLE_SINCE_ITS_LAUNCH =
  'This app keeps this file by its fingerprint only, since BroCrew did not write it, and the file cannot be read now: what the model got cannot be shown.'

/**
 * ⚑ **W4.177 — what Codex reads of a folder's AGENTS files, in all**: its packaged
 * `project_doc_max_bytes`, one budget for the whole chain, root first; a file past it is cut or left
 * out of what Codex sends.
 */
const CODEX_PROJECT_DOC_BUDGET = 32 * 1024

/** ⚑ W4.177 — why, for a Codex file the model may have got only part of, or none of. */
const PAST_CODEX_BUDGET =
  'This app keeps this file by its fingerprint only, since BroCrew did not write it, and Codex reads at most 32 KiB of a folder’s AGENTS files in all, so the model may have got only part of this one, or none of it. The agent’s popup shows the file as it is now.'

/**
 * ⚑ **W4.177 — a file the launch kept by its fingerprint, as the model got it when it can tell**: read
 * now with the launch's own reader and cap ({@link readNow}), and its text given only when its
 * fingerprint is still the one the launch kept — the same text the model got. ⛔ Otherwise none, and
 * why: it changed since, or it cannot be read now.
 */
function theTextItWasSent(file: GivenRecordFile): {
  readonly text: string | null
  readonly why: string
} {
  if (file.sha256 === null) return { text: null, why: KEPT_BY_FINGERPRINT }
  const now = readNow(file.path)
  if (now === null) return { text: null, why: UNREADABLE_SINCE_ITS_LAUNCH }
  return now.sha256 === file.sha256
    ? { text: now.text, why: KEPT_BY_FINGERPRINT }
    : { text: null, why: CHANGED_SINCE_ITS_LAUNCH }
}

/** ⚑ Why BroBot's profile file did not reach the model, by the reader's reason for it. */
function whyItWasNotSent(reason: string): string {
  if (reason === 'unmanaged-override') {
    return 'It did not reach the model: someone else’s file is at the name BroCrew publishes it under, and BroCrew left that file alone.'
  }
  if (reason === 'over-budget') {
    return 'It did not reach the model: the instructions’ size limit ran out before it.'
  }
  return 'It did not reach the model: this app’s reader did not send it.'
}

/** ⚑ A file's title, in plain words. */
function titleOfFile(kind: GivenFileKind, path: string, brobots: boolean): string {
  if (kind === 'profile-instructions') return 'BroCrew’s instructions for this agent'
  if (kind === 'workspace-instructions' || brobots) return 'BroCrew’s workspace file'
  if (kind === 'profile-memory') return 'This profile’s own CLAUDE.md'
  return `${basename(path)}, this folder’s own file`
}

/**
 * ⚑ Whose words a message carried, when every message of the turn says the same: an agent's,
 * BroBot's own, a person's. ⛔ Otherwise unknown — and so is a turn whose messages cannot be read, or
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
 * 🔴 **F093 · C9 d — one message as the model got it** ({@link WhatTheModelGot}), from BroBot's own
 * records: the launch's (`launched.given`) for what sat in the system prompt or the first message,
 * and the message's (`user_turn.sent`) for what was handed over with it.
 *
 * ⚑ **Where each part sat.** On Claude, BroBot's instructions, the files it sent and this
 * conversation's text are in the system prompt of every request. On Codex, Codex reads its files
 * into the first message, and this conversation's lead rides in front of a message — the first of
 * each launch that carries words, and again after a compaction or a turn Codex never began. It is
 * split off the front of the message it rode, named where it last rode before it otherwise, and
 * said not to have reached the model yet when no message so far carried it.
 *
 * ⛔ **Nothing is composed here.** ⚑ A file kept by fingerprint only is read now, and its text given
 * when it is still the text the launch sent (W4.177, {@link theTextItWasSent}); else it is named,
 * with why, and the popup reads it now. ⛔ Only a file a launch this app made named is read.
 */
export function oneMessageAsTheModelGotIt(handed: WhatTheMessageReadIsHanded): WhatTheModelGot {
  const { provider, message, launch } = handed
  const record = launch?.kept === 'recorded' ? launch.record : null
  const claude = providerValue(provider, { claude: true, codex: false })
  /** Where BroBot's instructions sit: Claude's system prompt, or the first message Codex reads its
   * files into. */
  const instructionsSit: ModelGotWhere = claude ? 'system-prompt' : 'first-message'
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
    if (!claude) return undefined
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
    // ⚑ Codex's one budget for the AGENTS files it reads, spent in the order it read them.
    let codexRead = 0
    for (const file of record.files) {
      const brobots = file.text !== undefined
      if (file.kind === 'read-by-codex') codexRead += file.bytes
      const pastTheBudget =
        file.kind === 'read-by-codex' && (codexRead > CODEX_PROJECT_DOC_BUDGET || file.truncated)
      const sent = brobots
        ? null
        : pastTheBudget
          ? { text: null, why: PAST_CODEX_BUDGET }
          : theTextItWasSent(file)
      add(
        instructionsSit,
        file.kind,
        titleOfFile(file.kind, file.path, brobots),
        originOf(file.kind, provider, brobots).origin,
        file.path,
        file.text ?? sent?.text ?? null,
        sent?.why ?? KEPT_BY_FINGERPRINT,
        file.kind === 'read-by-codex' ? undefined : headingOf(file.path),
      )
    }
  }

  // ── this conversation's own text ──
  const words = theMessagesOf(message.event).map((one) => one.text)
  const stored: unknown = message.event.sent
  const sent = typeof stored === 'string' ? stored : null
  const conversation = record?.thisConversation ?? null
  const block = conversation === null ? null : conversationBlock(conversation.text)
  /** ⚑ Whether a text handed over carried this conversation's lead in front. */
  const carries = (text: unknown): boolean =>
    block !== null && typeof text === 'string' && text.startsWith(`${block}\n\n`)
  // ⚑ On Codex, the lead in front of this message: as the thread's record says (W4.179), else when
  // the text handed over starts with this launch's whole block.
  const leadsHeld = handed.leadsInThisThread ?? null
  const carriedHere = leadsHeld?.find((one) => one.ordinal === message.ordinal)
  const lead = claude ? null : (carriedHere?.text ?? (carries(sent) ? block : null))
  const aboutIt = 'What is true of this conversation'
  if (record === null) {
    add(instructionsSit, 'this-conversation', aboutIt, 'brobot', null, null, unrecorded)
  } else if (block !== null) {
    if (claude) add('system-prompt', 'this-conversation', aboutIt, 'brobot', null, block)
    else if (leadsHeld !== null && leadsHeld.length > 0) {
      // ⚑ **W4.179 — what the thread holds**: the newest whole lead it was handed, and each change
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
      // ⚑ Where it last rode before this message — walked back through the launch.
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
  add(
    'this-message',
    'the-message',
    // ⚑ A turn of several held messages went over as one text, every message in it.
    words.length > 1
      ? `The ${String(words.length)} messages as BroCrew handed them over, together in one turn`
      : 'The message as BroCrew handed it over',
    whoseWords(event),
    null,
    sent === null || lead === null ? sent : sent.slice(lead.length + 2),
    theMessagesOf(event)[0]?.attribution === 'provider_transcript'
      ? 'This message was read from the provider’s own record: this app did not hand it over.'
      : !claude && words.length === 1 && words[0]?.trim() === '/compact'
        ? 'This was a command for Codex’s own compaction. No words reached the model.'
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
    // ⚑ Not known for a message that carried a file: each provider keeps those in its own way.
    providerKeptTheSameText:
      handed.providersRecord.found &&
      sent !== null &&
      theMessagesOf(event).every((one) => (one.attachments?.length ?? 0) === 0)
        ? handed.providersRecord.message === sent
        : null,
  }
}
