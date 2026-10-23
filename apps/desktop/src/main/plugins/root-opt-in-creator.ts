import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  readdirSync,
  renameSync,
  linkSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { ZodError } from 'zod'
import {
  Marker,
  Pins,
  plannedPluginRoot,
  readRootSelectionBytes,
  workspacePluginRoot,
  validatedRootPins,
} from './root-selection'
import { isPrivateEntry, isWithinOrSame, pinDirectory, type DirectoryPin } from './private-files'
import {
  keepFileToThisUser,
  verifyFileToThisUser,
  windowsAccessLists,
  type FileAccessLists,
} from '../recovery/windows-privacy'

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

function selectionPaths(options: Options, readOnly = false) {
  if (!options || !isAbsolute(options.appData ?? '') || !isAbsolute(options.workspace ?? ''))
    fail('supply absolute --app-data and --workspace paths')
  if (options.apply !== undefined && typeof options.apply !== 'boolean')
    fail('invalid apply option')
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
  if (!readOnly && isWithinOrSame(parent, workspace))
    fail('internal or default workspace is not eligible')
  const pinPath = join(parent, 'plugin-root-pins.json'),
    markerPath = join(workspace, 'plugin-root.json')
  return { appData, workspace, parent, pinPath, markerPath, defaultRoot: join(parent, 'plugins') }
}

function plan(options: Options) {
  const { appData, workspace, parent, pinPath, markerPath, defaultRoot } = selectionPaths(options)
  const parsed = Marker.safeParse({ format: 1, slot: options.slot })
  if (!parsed.success)
    return fail(
      'slot must start with a lowercase letter and contain at most six lowercase letters or digits',
    )
  const slot = parsed.data.slot
  const pinsBefore = snapshot(pinPath, 64 * 1024),
    markerBefore = snapshot(markerPath, 1024)
  const pins = pinsBefore.bytes
    ? Pins.parse(JSON.parse(pinsBefore.bytes.toString('utf8')))
    : { format: 1 as const, selections: [] }
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
  if (options.mode === 'shared') return removePluginRootSelection(options, hooks)
  if (options.mode !== undefined && options.mode !== 'own') fail('mode must be own or shared')
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
    return { ...publicPlan(current), status: 'created', state: 'own' }
  } finally {
    for (const entry of held.reverse()) entry.pin.close()
    closeSync(lock)
    const now = statOrAbsent(lockPath)
    if (now?.dev === lockIdentity.dev && now?.ino === lockIdentity.ino) unlinkSync(lockPath)
  }
}
function removalPlan(options: Options) {
  const paths = selectionPaths(options)
  const beforePin = snapshot(paths.pinPath, 64 * 1024)
  const pins = validatedRootPins(
    beforePin.bytes ? JSON.parse(beforePin.bytes.toString('utf8')) : undefined,
  )
  const marker = statOrAbsent(paths.markerPath)
  if (marker && (!marker.isFile() || marker.isSymbolicLink() || !isPrivateEntry(marker)))
    fail('marker is not a private regular file; review it before removal')
  const entry = pins.selections.find((entry) => same(entry.workspace, paths.workspace))
  let markerRecord: ReturnType<typeof checkedRemovalMarker> | undefined
  if (marker || entry) {
    const expected = Marker.safeParse({ format: 1, slot: options.slot })
    if (!expected.success) return fail('shared requires --slot matching this workspace selection')
    if (entry && expected.data.slot !== entry.slot) fail('workspace selects a different slot')
    if (marker) markerRecord = checkedRemovalMarker(paths.workspace, expected.data.slot)
  }
  const remaining = {
    format: 1 as const,
    selections: pins.selections.filter((entry) => !same(entry.workspace, paths.workspace)),
  }
  const views = remaining.selections.map((entry) => ({
    workspace: entry.workspace,
    root: selectionView(paths.appData, entry.workspace, paths.defaultRoot),
  }))
  return {
    ...paths,
    beforePin,
    marker: markerRecord?.stat,
    markerRecord,
    entry,
    remaining,
    views,
    status: !marker && !entry ? ('already shared' as const) : ('preview' as const),
  }
}

/** The reader stays single-link-only; rollback permits two only for a proven tool temp. */
function checkedRemovalMarker(workspace: string, slot: string) {
  const path = join(workspace, 'plugin-root.json'),
    stat = lstatSync(path, { bigint: true })
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !isPrivateEntry(stat) ||
    (stat.nlink !== 1n && stat.nlink !== 2n)
  )
    return fail('marker is not a private regular file with expected links')
  let temporary: string | undefined
  if (stat.nlink === 2n) {
    const candidates = readdirSync(workspace)
      .filter((name) =>
        /^\.plugin-root-marker-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/.test(
          name,
        ),
      )
      .map((name) => join(workspace, name))
      .filter((candidate) => {
        const other = statOrAbsent(candidate)
        return (
          other?.isFile() &&
          !other.isSymbolicLink() &&
          isPrivateEntry(other) &&
          other.dev === stat.dev &&
          other.ino === stat.ino &&
          other.nlink === 2n
        )
      })
    if (candidates.length !== 1) return fail('marker has an unknown extra link')
    temporary = candidates[0]!
  }
  const bytes = readRootSelectionBytes(path, 1024, stat.nlink === 2n ? 2 : 1)
  if (!bytes || !unchanged(stat, lstatSync(path, { bigint: true })))
    return fail('marker changed while reading')
  const parsed = Marker.parse(JSON.parse(bytes.toString('utf8')))
  if (parsed.slot !== slot) fail('marker selects a different slot')
  return { stat, bytes, temporary }
}
function selectionView(appData: string, workspaceRoot: string, defaultRoot: string) {
  try {
    return workspacePluginRoot({ appData, workspaceRoot, defaultRoot })
  } catch {
    return null
  }
}
function removalPreview(value: ReturnType<typeof removalPlan>) {
  const view = selectionView(value.appData, value.workspace, value.defaultRoot)
  return {
    status: value.status,
    mode: 'shared',
    state: view === null ? 'partial' : same(view, value.defaultRoot) ? 'shared' : 'own',
    appData: value.appData,
    parent: value.parent,
    workspace: value.workspace,
    root: value.defaultRoot,
    markerPath: value.markerPath,
    pinPath: value.pinPath,
    removeMarker: !!value.marker,
    removeMarkerTemp: value.markerRecord?.temporary ?? null,
    removePinEntry: value.entry ?? null,
    warning:
      "After restart this workspace's agents use the shared plugins, including the daily Chrome profiles/sign-ins and the WhatsApp account with its read/group settings.",
    pins: value.remaining,
  }
}

/** Explicit operator rollback. Removes selection metadata only, never either setup's data. */
async function removePluginRootSelection(options: Options, hooks: Hooks) {
  const initial = removalPlan(options)
  await checkCreationPrivacy(initial.parent)
  await checkCreationPrivacy(initial.workspace)
  if (!options.apply || initial.status === 'already shared') return removalPreview(initial)
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
    writeFileSync(lock, 'Offline shared plugin setup selection in progress.\n')
    fsyncSync(lock)
    const current = removalPlan(options)
    if (!same(current.parent, initial.parent) || !same(current.workspace, initial.workspace))
      fail('input directory identity changed')
    if (current.status === 'already shared') return removalPreview(current)
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
    let pinTemp: string | undefined
    if (current.entry) {
      pinTemp = join(current.parent, `.plugin-root-pins-${randomUUID()}.tmp`)
      const fd = openSync(pinTemp, 'wx', 0o600)
      try {
        if (process.platform !== 'win32') fchmodSync(fd, 0o600)
        await keepFileToThisUser(pinTemp)
        writeFileSync(fd, JSON.stringify(current.remaining, null, 2) + '\n')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
    }
    await hooks.beforePublish?.()
    verifyDirectories()
    agrees(current.pinPath, 64 * 1024, current.beforePin)
    const marker = statOrAbsent(current.markerPath)
    if (current.markerRecord) {
      const checked = checkedRemovalMarker(current.workspace, options.slot!)
      if (
        !unchanged(current.markerRecord.stat, checked.stat) ||
        !current.markerRecord.bytes.equals(checked.bytes) ||
        current.markerRecord.temporary !== checked.temporary
      )
        fail('marker changed; nothing was removed')
      if (checked.temporary) {
        const temp = lstatSync(checked.temporary, { bigint: true })
        if (
          !temp.isFile() ||
          temp.isSymbolicLink() ||
          temp.dev !== checked.stat.dev ||
          temp.ino !== checked.stat.ino ||
          temp.nlink !== 2n
        )
          fail('marker temp changed; nothing was removed')
        unlinkSync(checked.temporary)
        const bytes = readRootSelectionBytes(current.markerPath, 1024)
        const after = lstatSync(current.markerPath, { bigint: true })
        if (
          !bytes?.equals(checked.bytes) ||
          after.dev !== checked.stat.dev ||
          after.ino !== checked.stat.ino
        )
          fail('marker changed after temp cleanup')
      }
    } else if (marker !== undefined) fail('marker appeared; nothing was removed')
    // Marker first: if interrupted, an outstanding pin still makes the reader refuse.
    if (current.marker) {
      unlinkSync(current.markerPath)
      held[1]!.pin.sync()
    }
    await hooks.afterMarker?.()
    verifyDirectories()
    agrees(current.pinPath, 64 * 1024, current.beforePin)
    if (statOrAbsent(current.markerPath)) fail('marker reappeared during removal')
    if (pinTemp) {
      renameSync(pinTemp, current.pinPath)
      held[0]!.pin.sync()
    }
    verifyDirectories()
    if (
      workspacePluginRoot({
        appData: current.appData,
        workspaceRoot: current.workspace,
        defaultRoot: current.defaultRoot,
      }) !== current.defaultRoot
    )
      fail('reader did not confirm shared selection')
    for (const view of current.views) {
      if (selectionView(current.appData, view.workspace, current.defaultRoot) !== view.root)
        fail('another selection changed')
    }
    return { ...removalPreview(current), status: 'shared', state: 'shared' }
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
    mode: 'own',
    state: value.status === 'already selected' ? 'own' : 'shared',
    appData: value.appData,
    parent: value.parent,
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
    allowed = ['--app-data', '--workspace', '--slot', '--mode']
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
      fail(
        'use --app-data <absolute> --workspace <absolute> [--mode own|shared|state] [--slot <name>] [--apply]',
      )
    values.set(flag, args[++i]!)
  }
  const mode = values.get('--mode') ?? 'own'
  const options = {
    appData: values.get('--app-data') ?? '',
    workspace: values.get('--workspace') ?? '',
    slot: values.get('--slot'),
    mode: mode as Options['mode'],
    apply,
  }
  const result = mode === 'state' ? pluginRootState(options) : createPluginRootSelection(options)
  return result.catch((error: unknown) => {
    if (error instanceof ZodError || error instanceof SyntaxError)
      fail('marker or pin configuration is invalid; review it before changing selection')
    throw error
  })
}

async function pluginRootState(options: Options): Promise<'own' | 'shared'> {
  if (options.apply) return fail('state is read-only; omit --apply')
  const paths = selectionPaths(options, true)
  await checkCreationPrivacy(paths.parent)
  await checkCreationPrivacy(paths.workspace)
  const root = workspacePluginRoot({
    appData: paths.appData,
    workspaceRoot: paths.workspace,
    defaultRoot: paths.defaultRoot,
  })
  return same(root, paths.defaultRoot) ? 'shared' : 'own'
}
