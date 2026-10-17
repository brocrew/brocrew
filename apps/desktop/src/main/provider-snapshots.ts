import { ipcMain } from 'electron'
import type { Provider } from '@brobot2/shared'
import {
  PROVIDER_SNAPSHOTS_CHANNELS,
  sizeOf,
  type KeptPart,
  type ProviderSnapshot,
  type ProviderSnapshotFile,
  type SnapshotAnswer,
  type SnapshotCatalogue,
  type SnapshotPart,
} from '../shared/provider-snapshots'
import claudeCode from './provider-snapshots/claude-code.json'
import codex from './provider-snapshots/codex.json'
import claudeCodeOnLinux from './provider-snapshots/linux/claude-code.json'
import codexOnLinux from './provider-snapshots/linux/codex.json'

/**
 * 🔴 **W4.164 · F093 R3 — the bundled providers' own parts, as shipped with this build**: what
 * `pnpm run snapshots:providers` captured from the bundled Claude Code and Codex, per model (see
 * `shared/provider-snapshots.ts`). ⚑ Read from the files the build carries, never from a provider
 * at run time: no program is started and nothing of a person's is read to answer.
 */

/** The snapshot files this build carries, by the platform they were captured on. */
export const SNAPSHOT_FILES_BY_PLATFORM: Readonly<
  Record<'linux' | 'macos', Readonly<Record<Provider, ProviderSnapshotFile>>>
> = {
  linux: {
    claude: claudeCodeOnLinux as unknown as ProviderSnapshotFile,
    codex: codexOnLinux as unknown as ProviderSnapshotFile,
  },
  macos: {
    claude: claudeCode as unknown as ProviderSnapshotFile,
    codex: codex as unknown as ProviderSnapshotFile,
  },
}

/**
 * The platform whose capture a build shows: Linux's own on Linux, and macOS's on macOS and on every
 * platform with no capture of its own, Windows among them. A capture says in its own notes where it
 * was made, so one shown on another platform is never called that platform's.
 */
export function capturedOnFor(platform: NodeJS.Platform): 'linux' | 'macos' {
  return platform === 'linux' ? 'linux' : 'macos'
}

export function snapshotFilesFor(
  platform: NodeJS.Platform,
): Readonly<Record<Provider, ProviderSnapshotFile>> {
  return SNAPSHOT_FILES_BY_PLATFORM[capturedOnFor(platform)]
}

/** The snapshot files for the platform this build runs on, one per provider. */
export const SNAPSHOT_FILES = snapshotFilesFor(process.platform)

/** A kept part made whole again: its text, its tools' texts, and their sizes. */
function partOf(kept: KeptPart, texts: Readonly<Record<string, string>>): SnapshotPart {
  const tools = kept.tools?.map((tool) => {
    const text = texts[tool.text] ?? ''
    return { name: tool.name, text, chars: sizeOf(text).chars }
  })
  const text =
    tools === undefined ? (texts[kept.text] ?? '') : tools.map((tool) => tool.text).join('\n')
  return {
    id: kept.id,
    title: kept.title,
    where: kept.where,
    when: kept.when,
    text,
    ...sizeOf(text),
    ...(tools === undefined ? {} : { tools }),
    ...(kept.varies === undefined ? {} : { varies: kept.varies }),
  }
}

/**
 * 🔴 **The snapshot for a provider and a model**: the model as the conversation names it — the id a
 * menu offered (`opus`, `gpt-5.5`) or the one the provider told its model (`claude-opus-5-5`) — or
 * the provider's default for none. ⚑ A model this build did not capture is said so, with the ones
 * it did: never another model's parts in its place.
 */
export function snapshotFor(
  provider: Provider,
  model: string | null,
  files: Readonly<Record<Provider, ProviderSnapshotFile>> = SNAPSHOT_FILES,
): SnapshotAnswer {
  const file = files[provider]
  const asked = model ?? file.defaultModel
  const models = Object.keys(file.models)
  // ⚑ A menu's `opus[1m]` is `opus` with a longer context: the same parts.
  const bare = asked?.replace(/\[1m\]$/, '') ?? null
  const entries = Object.entries(file.models)
  const entry =
    bare === null
      ? undefined
      : (entries.find(([id]) => id === asked || id === bare) ??
        entries.find(([, one]) => one.alsoCalled.includes(bare)))
  if (entry === undefined) {
    return {
      found: false,
      why:
        asked === null
          ? `No model was named, and ${file.label} names no default.`
          : `${asked} was not captured ${file.label}.`,
      models,
    }
  }
  const [id, one] = entry
  const parts = one.parts.map((kept) => partOf(kept, file.texts))
  // ⚑ What is in front of the model before it asks for anything: a tool loaded on demand is not.
  const whole = sizeOf(
    parts
      .filter((part) => part.when !== 'when-loaded')
      .map((part) => part.text)
      .join('\n'),
  )
  const snapshot: ProviderSnapshot = {
    provider,
    version: file.version,
    label: file.label,
    model: id,
    shape: one.shape,
    notes: file.notes,
    parts,
    ...whole,
  }
  return { found: true, snapshot }
}

/** What this build carries, per provider: for a window that names the version and lists models. */
export function snapshotCatalogue(
  files: Readonly<Record<Provider, ProviderSnapshotFile>> = SNAPSHOT_FILES,
): SnapshotCatalogue[] {
  return (['claude', 'codex'] as const).map((provider) => {
    const file = files[provider]
    return {
      provider,
      version: file.version,
      label: file.label,
      defaultModel: file.defaultModel,
      notes: file.notes,
      models: Object.entries(file.models).map(([model, one]) => ({
        model,
        shape: one.shape,
        alsoCalled: one.alsoCalled,
      })),
    }
  })
}

/** The window's asks: what this build carries, and one provider's parts for one model. */
export function startProviderSnapshots(): void {
  ipcMain.handle(PROVIDER_SNAPSHOTS_CHANNELS.list, (): SnapshotCatalogue[] => snapshotCatalogue())
  ipcMain.handle(
    PROVIDER_SNAPSHOTS_CHANNELS.forModel,
    (_event, provider: unknown, model: unknown): SnapshotAnswer => {
      if (provider !== 'claude' && provider !== 'codex') {
        return { found: false, why: 'A provider is claude or codex.', models: [] }
      }
      return snapshotFor(provider, typeof model === 'string' && model !== '' ? model : null)
    },
  )
}
