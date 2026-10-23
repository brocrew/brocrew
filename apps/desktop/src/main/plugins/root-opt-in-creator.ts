import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  linkSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  Marker,
  Pins,
  plannedPluginRoot,
  readRootSelectionBytes,
  workspacePluginRoot,
} from './root-selection'
import { isPrivateEntry, isWithinOrSame, pinDirectory, type DirectoryPin } from './private-files'
import {
  keepFileToThisUser,
  verifyFileToThisUser,
  windowsAccessLists,
  type FileAccessLists,
} from '../recovery/windows-privacy'

type Options = { appData: string; workspace: string; slot: string; apply?: boolean }
type Hooks = { beforePublish?: () => void | Promise<void>; afterPin?: () => void | Promise<void> }
const same = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const absent = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const fail = (reason: string): never => {
  throw new Error(`Plugin setup refused: ${reason}`)
}
function statOrAbsent(path: string) {
  try {
    return lstatSync(path, { bigint: true })
  } catch (error) {
    if (absent(error)) return undefined
    throw error
  }
}
const unchanged = (a: BigIntStats, b: BigIntStats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs
function snapshot(path: string, limit: number) {
  const stat = statOrAbsent(path),
    bytes = readRootSelectionBytes(path, limit)
  if ((stat === undefined) !== (bytes === undefined)) fail('record changed while reading')
  if (stat && !unchanged(stat, lstatSync(path, { bigint: true })))
    fail('record changed while reading')
  return { stat, bytes }
}
function agrees(path: string, limit: number, before: ReturnType<typeof snapshot>) {
  const now = snapshot(path, limit)
  if (before.stat && now.stat && before.bytes && now.bytes) {
    if (unchanged(before.stat, now.stat) && before.bytes.equals(now.bytes)) return
  } else if (!before.stat && !now.stat) return
  fail('configuration changed; nothing was overwritten')
}

/** Check inherited privacy without changing any existing directory or its ACL. */
export async function checkCreationPrivacy(
  path: string,
  lists: Pick<FileAccessLists, 'userSid' | 'machineSid' | 'read'> = windowsAccessLists,
  platform: NodeJS.Platform = process.platform,
) {
  await verifyFileToThisUser(path, lists, platform)
}

function plan(options: Options) {
  if (!options || !isAbsolute(options.appData ?? '') || !isAbsolute(options.workspace ?? ''))
    fail('supply absolute --app-data and --workspace paths')
  if (options.apply !== undefined && typeof options.apply !== 'boolean')
    fail('invalid apply option')
  const slot = Marker.parse({ format: 1, slot: options.slot }).slot
  const appData = realpathSync.native(options.appData),
    workspace = realpathSync.native(options.workspace)
  if (!lstatSync(appData).isDirectory() || !lstatSync(workspace).isDirectory())
    fail('not a directory')
  const parent = join(appData, '@brobot2')
  if (
    !same(realpathSync.native(parent), parent) ||
    !lstatSync(parent).isDirectory() ||
    !isPrivateEntry(lstatSync(parent), 0o022)
  )
    fail('unsafe configuration parent')
  // The daily default folder and all internal app data are deliberately ineligible.
  if (isWithinOrSame(parent, workspace)) fail('internal or default workspace is not eligible')
  const pinPath = join(parent, 'plugin-root-pins.json'),
    markerPath = join(workspace, 'plugin-root.json')
  const pinsBefore = snapshot(pinPath, 64 * 1024),
    markerBefore = snapshot(markerPath, 1024)
  const pins = pinsBefore.bytes
    ? Pins.parse(JSON.parse(pinsBefore.bytes.toString('utf8')))
    : { format: 1 as const, selections: [] }
  const defaultRoot = join(parent, 'plugins')
  const selected = workspacePluginRoot({ appData, workspaceRoot: workspace, defaultRoot })
  const root = join(parent, `plugins-${slot}`)
  if (!same(selected, defaultRoot)) {
    if (!same(selected, root)) fail('workspace already selects another setup')
    return {
      status: 'already selected' as const,
      appData,
      workspace,
      slot,
      root,
      parent,
      pinPath,
      markerPath,
      pinsBefore,
      markerBefore,
      pins,
      otherRoots: [],
    }
  }
  if (pins.selections.some((entry) => entry.slot === slot)) fail('slot is already used')
  if (statOrAbsent(root)) fail('selected root already exists; choose a fresh slot')
  const otherRoots = pins.selections.map((entry) => {
    if (!statOrAbsent(entry.workspace)) return { workspace: entry.workspace, root: undefined }
    return {
      workspace: entry.workspace,
      root: workspacePluginRoot({ appData, workspaceRoot: entry.workspace, defaultRoot }),
    }
  })
  const nextPins = Pins.parse({ format: 1, selections: [...pins.selections, { workspace, slot }] })
  plannedPluginRoot(parent, workspace, nextPins.selections, slot)
  const marker = JSON.stringify({ format: 1, slot }, null, 2) + '\n'
  const pin = JSON.stringify(nextPins, null, 2) + '\n'
  if (Buffer.byteLength(pin) > 64 * 1024) fail('pin file would be too large')
  return {
    status: 'preview' as const,
    appData,
    workspace,
    slot,
    root,
    parent,
    pinPath,
    markerPath,
    pinsBefore,
    markerBefore,
    pins: nextPins,
    otherRoots,
    marker,
    pin,
  }
}

/** Offline operator tool. Never called by app startup, and never migrates plugin data. */
export async function createPluginRootSelection(options: Options, hooks: Hooks = {}) {
  const initial = plan(options)
  await checkCreationPrivacy(initial.parent)
  await checkCreationPrivacy(initial.workspace)
  if (!options.apply || initial.status === 'already selected') return publicPlan(initial)
  const lockPath = join(initial.parent, 'plugin-root-pins.lock')
  let lock: number
  try {
    lock = openSync(lockPath, 'wx', 0o600)
  } catch {
    return fail('creation lock is busy or left over; review before removing it')
  }
  const lockIdentity = lstatSync(lockPath, { bigint: true })
  const held: Array<{ path: string; pin: DirectoryPin; identity: BigIntStats }> = []
  try {
    await keepFileToThisUser(lockPath)
    writeFileSync(lock, 'Offline plugin setup creation in progress.\n')
    fsyncSync(lock)
    const current = plan(options)
    if (!same(current.parent, initial.parent) || !same(current.workspace, initial.workspace))
      fail('input directory identity changed')
    if (current.status === 'already selected') return publicPlan(current)
    for (const path of [current.parent, current.workspace]) {
      const pin = pinDirectory(path)
      held.push({ path, pin, identity: pin.held() })
    }
    const verifyDirectories = () => {
      if (
        !same(realpathSync.native(options.appData), current.appData) ||
        !same(realpathSync.native(options.workspace), current.workspace)
      )
        fail('input directory identity changed')
      for (const entry of held) {
        const now = lstatSync(entry.path, { bigint: true })
        if (
          now.isSymbolicLink() ||
          now.dev !== entry.identity.dev ||
          now.ino !== entry.identity.ino ||
          !same(realpathSync.native(entry.path), entry.path)
        )
          fail('directory identity changed')
      }
    }
    const temporary = async (directory: string, label: string, content: string) => {
      const path = join(directory, `.plugin-root-${label}-${randomUUID()}.tmp`)
      const fd = openSync(path, 'wx', 0o600)
      try {
        if (process.platform !== 'win32') fchmodSync(fd, 0o600)
        await keepFileToThisUser(path)
        writeFileSync(fd, content)
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      return path
    }
    const pinTemp = await temporary(current.parent, 'pins', current.pin)
    const markerTemp = await temporary(current.workspace, 'marker', current.marker)
    await hooks.beforePublish?.()
    verifyDirectories()
    agrees(current.pinPath, 64 * 1024, current.pinsBefore)
    agrees(current.markerPath, 1024, current.markerBefore)
    if (statOrAbsent(current.root)) fail('selected root appeared during creation')
    // Publish the expectation first. An interruption now refuses; it never selects shared data.
    renameSync(pinTemp, current.pinPath)
    held[0]!.pin.sync()
    const published = snapshot(current.pinPath, 64 * 1024)
    await hooks.afterPin?.()
    verifyDirectories()
    agrees(current.markerPath, 1024, current.markerBefore)
    agrees(current.pinPath, 64 * 1024, published)
    if (statOrAbsent(current.root)) fail('selected root appeared during creation')
    // Publishing a hard link refuses an existing name. Until the temp link is removed,
    // the reader's single-link check refuses the intermediate state.
    linkSync(markerTemp, current.markerPath)
    unlinkSync(markerTemp)
    held[1]!.pin.sync()
    verifyDirectories()
    if (
      workspacePluginRoot({
        appData: current.appData,
        workspaceRoot: current.workspace,
        defaultRoot: join(current.parent, 'plugins'),
      }) !== current.root
    )
      fail('reader did not confirm selection')
    for (const previous of current.otherRoots) {
      if (
        previous.root &&
        workspacePluginRoot({
          appData: current.appData,
          workspaceRoot: previous.workspace,
          defaultRoot: join(current.parent, 'plugins'),
        }) !== previous.root
      )
        fail('another selection changed')
    }
    return { ...publicPlan(current), status: 'created' }
  } finally {
    for (const entry of held.reverse()) entry.pin.close()
    closeSync(lock)
    const now = statOrAbsent(lockPath)
    if (now?.dev === lockIdentity.dev && now?.ino === lockIdentity.ino) unlinkSync(lockPath)
  }
}
function publicPlan(value: ReturnType<typeof plan>) {
  return {
    status: value.status,
    workspace: value.workspace,
    slot: value.slot,
    root: value.root,
    markerPath: value.markerPath,
    pinPath: value.pinPath,
    marker: value.status === 'preview' ? JSON.parse(value.marker) : undefined,
    pins: value.pins,
  }
}

export async function rootOptInCommand(args: string[]) {
  const values = new Map<string, string>(),
    allowed = ['--app-data', '--workspace', '--slot']
  let apply = false
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!
    if (flag === '--apply' && !apply) {
      apply = true
      continue
    }
    if (
      !allowed.includes(flag) ||
      values.has(flag) ||
      !args[i + 1] ||
      args[i + 1]!.startsWith('--')
    )
      fail('use --app-data <absolute> --workspace <absolute> --slot <name> [--apply]')
    values.set(flag, args[++i]!)
  }
  return createPluginRootSelection({
    appData: values.get('--app-data') ?? '',
    workspace: values.get('--workspace') ?? '',
    slot: values.get('--slot') ?? '',
    apply,
  })
}
