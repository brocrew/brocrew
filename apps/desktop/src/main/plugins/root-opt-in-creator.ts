import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  Marker,
  Pins,
  readRootSelectionBytes,
  validatedRootPins,
  workspacePluginRoot,
  rootSelectionIdentity,
  rootSelectionPath,
} from './root-selection'
import { PluginFence } from './state/fence'
import { syncDirectory } from './private-files'
import type { FileAccessLists } from '../recovery/windows-privacy'

type Options = {
  appData: string
  workspace: string
  slot?: string
  mode?: 'own' | 'shared'
  apply?: boolean
}
type Hooks = {
  beforePublish?: () => void | Promise<void>
  afterPin?: () => void | Promise<void>
  afterMarker?: () => void | Promise<void>
}
const same = (a: string, b: string) => rootSelectionIdentity(a) === rootSelectionIdentity(b)

/** Compatibility entry point; filesystem access errors remain ordinary errors, not ACL admission. */
export async function checkCreationPrivacy(
  _path: string,
  _lists?: Pick<FileAccessLists, 'userSid' | 'machineSid' | 'read'>,
  _platform: NodeJS.Platform = process.platform,
): Promise<void> {
  void _path
  void _lists
  void _platform
}
function paths(options: Options) {
  if (!isAbsolute(options.appData) || !isAbsolute(options.workspace))
    throw new Error('Supply absolute app-data and workspace paths.')
  if (options.mode !== undefined && options.mode !== 'own' && options.mode !== 'shared')
    throw new Error('Mode must be own or shared.')
  const parent = join(options.appData, '@brobot2')
  return {
    parent,
    pin: join(parent, 'plugin-root-pins.json'),
    marker: join(options.workspace, 'plugin-root.json'),
    defaultRoot: join(parent, 'plugins'),
  }
}
function pins(path: string) {
  const bytes = readRootSelectionBytes(path, 0)
  return validatedRootPins(bytes === undefined ? undefined : JSON.parse(bytes.toString('utf8')))
}
function atomic(path: string, value: unknown, directory: string): void {
  const temporary = path + '.new-' + randomUUID(),
    fd = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n')
    fsyncSync(fd)
    renameSync(temporary, path)
    if (process.platform !== 'win32') {
      const parent = openSync(directory, 'r')
      try {
        syncDirectory(parent)
      } finally {
        closeSync(parent)
      }
    }
  } finally {
    closeSync(fd)
    try {
      unlinkSync(temporary)
    } catch {
      // Unpublished temporary files are ignored on reopening.
    }
  }
}
/** Explicit offline location choice; no plugin data is moved, removed or regenerated. */
export async function createPluginRootSelection(options: Options, hooks: Hooks = {}) {
  const location = paths(options),
    mode = options.mode ?? 'own'
  const before = workspacePluginRoot({
    appData: options.appData,
    workspaceRoot: options.workspace,
    defaultRoot: location.defaultRoot,
  })
  const marker = mode === 'own' ? Marker.parse({ format: 1, slot: options.slot }) : undefined
  const root = marker ? join(location.parent, 'plugins-' + marker.slot) : location.defaultRoot
  const next = () => {
    const current = pins(location.pin)
    return Pins.parse({
      format: 1,
      selections: [
        ...current.selections.filter((entry) => !same(entry.workspace, options.workspace)),
        { workspace: rootSelectionPath(options.workspace), slot: marker?.slot ?? null },
      ],
    })
  }
  const preview = {
    status: same(before, root) ? 'already selected' : 'preview',
    state: same(before, location.defaultRoot) ? 'shared' : 'own',
    mode,
    root,
    workspace: options.workspace,
    appData: options.appData,
    parent: location.parent,
    pinPath: location.pin,
    markerPath: location.marker,
    slot: marker?.slot,
    marker,
    pins: next(),
    warning:
      'Changing location selects another set of plugin data. Existing data stays where it is.',
  }
  if (!options.apply || same(before, root)) return preview
  mkdirSync(location.parent, { recursive: true })
  mkdirSync(options.workspace, { recursive: true })
  const lock = PluginFence.acquire(join(location.parent, 'plugin-root-selection.sqlite'))
  try {
    return await lock.async(options, async () => {
      await hooks.beforePublish?.()
      const selected = next()
      // Publish the canonical selection first. Either old or new selection survives a crash.
      atomic(location.pin, selected, location.parent)
      await hooks.afterPin?.()
      if (marker) atomic(location.marker, marker, options.workspace)
      else {
        try {
          unlinkSync(location.marker)
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
        }
      }
      await hooks.afterMarker?.()
      return {
        ...preview,
        pins: selected,
        status: same(before, root) ? 'already selected' : mode === 'own' ? 'created' : 'removed',
        state: mode,
      }
    })
  } finally {
    lock.release()
  }
}
export async function rootOptInCommand(args: string[]) {
  const values = new Map<string, string>()
  let apply = false
  for (let at = 0; at < args.length; at++) {
    const name = args[at]!
    if (name === '--apply' && !apply) {
      apply = true
      continue
    }
    if (
      !['--app-data', '--workspace', '--slot', '--mode'].includes(name) ||
      values.has(name) ||
      !args[at + 1]
    )
      throw new Error(
        'Supply --app-data, --workspace and optional --mode own|shared|state, --slot, --apply.',
      )
    values.set(name, args[++at]!)
  }
  const mode = values.get('--mode') ?? 'own'
  const options = {
    appData: values.get('--app-data') ?? '',
    workspace: values.get('--workspace') ?? '',
    slot: values.get('--slot'),
    mode: mode as Options['mode'],
    apply,
  }
  if (mode === 'state') {
    if (apply) throw new Error('State is read-only; omit --apply.')
    const location = paths({ ...options, mode: 'own' })
    return same(
      workspacePluginRoot({
        appData: options.appData,
        workspaceRoot: options.workspace,
        defaultRoot: location.defaultRoot,
      }),
      location.defaultRoot,
    )
      ? 'shared'
      : 'own'
  }
  return createPluginRootSelection(options)
}
