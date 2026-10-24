import { createHash, randomUUID } from 'node:crypto'
import { watch, type Stats } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type {
  ThemeChanged,
  ThemeDeleted,
  ThemeReading,
  ThemeRefused,
  ThemeRow,
  ThemeSaveInput,
  ThemeSaved,
  ThemeSet,
  ThemeSnapshot,
  ThemeSource,
} from '../../shared/theme-library'
import { assetPathProblem, LIMITS } from '../../shared/themes/assets'
import { colourCss, over, parseColour } from '../../shared/themes/colour'
import type { Theme, ThemeProblem } from '../../shared/themes/theme'
import type { AdmittedThemeAsset, ThemeAssetRegistry } from './asset-protocol'
import { readOfferedThemeAsset, readThemeFile, THEME_ID, THEME_JSON_BYTES } from './files'
import { CLASSIC_THEME, DEFAULT_THEME_BACKGROUND } from './defaults'
import { retrying } from '../recovery/files'
import {
  inspectThemeAsset,
  loadThemeFolder,
  THEME_ASSET_DEPTH,
  validateThemeBytes,
  type LoadedTheme,
  type ThemeAssetBytes,
  type ThemeHostProblem,
  type ThemeLoad,
  type ThemeLoader,
  type UnreadBases,
} from './load'
import {
  ACTIVE_THEME_FILE,
  readThemeChoice,
  saysAbsent,
  themeDirectory,
  themeFolderState,
  themeWriteLock,
  writeActiveTheme,
  type ThemeCommitFiles,
} from './state'
import { themeFileSizeProblem, themeFilesProblem, themeSizeProblem } from './words'

export type ThemeStoreProblem =
  | ThemeHostProblem
  | 'duplicate-asset'
  | 'asset-input'
  | 'absolute-path'
  | 'base64'
  | 'save'
  | 'busy'
  | 'choice'
  | 'trash'
  | 'open-folder'
  | 'fallback'

export interface ThemeStoreOptions {
  readonly builtIns: string
  readonly library: string
  readonly userData: string
  readonly defaultTheme: string
  readonly builtInIds: readonly string[]
  /** Built-ins loaded only as a base: not listed, and not chosen. */
  readonly hiddenBases?: readonly string[]
  readonly forceDefault?: boolean
  /**
   * A workspace with no choice file is given {@link startingTheme} as its choice, written once, so the
   * look it starts in never depends on judging the workspace again.
   */
  readonly writesItsDefault?: boolean
  /** The look a workspace with no choice file starts in; {@link defaultTheme} unless given. */
  readonly startingTheme?: string
  /** Where a write the store could do without is reported: the app's log. */
  readonly warn?: (line: string) => void
  readonly loader: Omit<ThemeLoader, 'problem'>
  readonly problem: (kind: ThemeStoreProblem) => string
  readonly trash: (path: string) => Promise<void>
  readonly openFolder: (path: string) => Promise<void>
  readonly files?: ThemeCommitFiles
  readonly watch?: (path: string, recursive: boolean, changed: () => void) => () => void
  readonly assertWorkspace?: () => void
}

interface ThemeEntry {
  readonly row: ThemeRow
  readonly loaded?: LoadedTheme
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A theme set aside by a save that could not finish: `.theme-<id>.<uuid>.previous`. */
const SET_ASIDE = /^\.theme-([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)\.[0-9a-f-]{36}\.previous$/

const refused = (
  rail: ThemeRefused['rail'],
  problems: readonly ThemeProblem[] = [],
): ThemeRefused => ({
  outcome: 'refused',
  rail,
  problems,
})

const fileWatcher = (path: string, recursive: boolean, changed: () => void): (() => void) => {
  const watcher = watch(path, { recursive }, changed)
  watcher.on('error', changed)
  return () => watcher.close()
}

export class ThemeStore implements ThemeAssetRegistry {
  private readonly registry = new Map<string, ThemeEntry>()
  private readonly bases = new Map<string, LoadedTheme>()
  private readonly hidden = new Map<string, LoadedTheme>()
  private unread: UnreadBases = { has: () => false }
  private readonly reserved: Set<string>
  private readonly listeners = new Set<(change: ThemeChanged) => void>()
  private readonly watchers: (() => void)[] = []
  private readonly loader: ThemeLoader
  private readonly files: ThemeCommitFiles
  private active: string
  private requested: string | null = null
  private reason: string | undefined
  private libraryRoot: string | null = null
  private forceDefault: boolean
  private closed = false
  private wroteTheDefault = false
  private startJob: Promise<ThemeSnapshot> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private tail: Promise<void> = Promise.resolve()
  private announcements = 0

  constructor(private readonly options: ThemeStoreOptions) {
    this.reserved = new Set(['classic', ...options.builtInIds])
    this.active = options.defaultTheme
    this.forceDefault = options.forceDefault === true
    this.loader = {
      ...options.loader,
      problem: options.problem,
      hiddenBases: new Set(options.hiddenBases ?? []),
    }
    this.files = options.files ?? { rename }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const job = this.tail.then(async () => {
      if (this.closed) throw new Error('theme store is closed')
      const before = JSON.stringify(this.snapshot())
      const announced = this.announcements
      try {
        return await work()
      } finally {
        if (announced === this.announcements && before !== JSON.stringify(this.snapshot()))
          this.announce()
      }
    })
    this.tail = job.then(
      () => undefined,
      () => undefined,
    )
    return job
  }

  start(): Promise<ThemeSnapshot> {
    return (this.startJob ??= this.startInside())
  }

  private async startInside(): Promise<ThemeSnapshot> {
    await this.refresh()
    const changed = (): void => {
      if (this.closed) return
      clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined
        void this.refresh().catch(() => undefined)
      }, 300)
      this.timer.unref()
    }
    const observe = this.options.watch ?? fileWatcher
    const userRoot = await themeDirectory(this.options.userData)
    if (this.closed) return this.snapshot()
    for (const [path, recursive] of [
      [this.libraryRoot, true],
      [userRoot, false],
    ] as const) {
      if (path === null) continue
      try {
        this.watchers.push(observe(path, recursive, changed))
      } catch {
        changed()
      }
    }
    return this.snapshot()
  }

  async close(): Promise<void> {
    this.closed = true
    clearTimeout(this.timer)
    for (const close of this.watchers.splice(0)) close()
    this.listeners.clear()
    await this.startJob?.catch(() => undefined)
    await this.tail
  }

  onChanged(listener: (change: ThemeChanged) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private announce(previous?: string, actor?: string): void {
    this.announcements++
    const change: ThemeChanged = {
      ...this.snapshot(),
      ...(previous !== undefined ? { previous } : {}),
      ...(actor !== undefined ? { actor } : {}),
    }
    for (const listener of this.listeners) {
      try {
        listener(change)
      } catch {
        // A window listener cannot prevent the committed choice from standing.
      }
    }
  }

  snapshot(): ThemeSnapshot {
    return {
      active: this.active,
      requested: this.requested,
      themes: [...this.registry.values()].map((entry) => entry.row),
      ...(this.reason ? { reason: this.reason } : {}),
    }
  }

  asset(id: string, path: string): AdmittedThemeAsset | null {
    return (this.registry.get(id)?.loaded ?? this.hidden.get(id))?.assets.get(path) ?? null
  }

  raw(id: string): Theme | null {
    return id === 'classic' ? CLASSIC_THEME : (this.registry.get(id)?.loaded?.theme ?? null)
  }

  private available(id: string): boolean {
    return id === 'classic' || this.registry.get(id)?.loaded !== undefined
  }

  reading(id = this.active): ThemeReading | ThemeRefused {
    const loaded = this.registry.get(id)?.loaded
    if (!this.available(id)) return refused('theme-unknown', this.registry.get(id)?.row.problems)
    return {
      active: this.active,
      theme: loaded?.resolved ?? null,
      version: loaded?.version ?? null,
      assetVersions: Object.fromEntries([
        ...[...this.hidden].map(([key, base]) => [key, base.version]),
        ...[...this.registry].flatMap(([key, entry]) =>
          entry.loaded ? [[key, entry.loaded.version]] : [],
        ),
      ]),
      ...(this.reason ? { reason: this.reason } : {}),
    }
  }

  background(): string {
    const paper = parseColour(this.registry.get(this.active)?.loaded?.resolved.frame?.paper)
    return paper
      ? colourCss(over(paper, parseColour(DEFAULT_THEME_BACKGROUND)!))
      : DEFAULT_THEME_BACKGROUND
  }

  refresh(): Promise<ThemeSnapshot> {
    return this.serial(async () => {
      const before = JSON.stringify(this.snapshot())
      await this.reload()
      if (before !== JSON.stringify(this.snapshot())) this.announce()
      return this.snapshot()
    })
  }

  /**
   * A folder's names, waiting out a brief hold. A folder the system says is not there lists
   * nothing; one it won't list answers null.
   */
  private async names(path: string): Promise<readonly string[] | null> {
    try {
      return await retrying(() => (this.files.readdir ?? readdir)(path))
    } catch (error) {
      return saysAbsent(error) ? [] : null
    }
  }

  /**
   * A theme folder's load, tried again while the system refuses a read it needed. A refusal that
   * outlasts the waits answers that refused load, so the theme is listed as one that can't be used.
   */
  private async settledLoad(
    path: string,
    id: string,
    bases: ReadonlyMap<string, LoadedTheme>,
    unread: UnreadBases,
    builtIn = false,
    readability: 'refuse' | 'note' = 'refuse',
  ): Promise<ThemeLoad> {
    let last: ThemeLoad | undefined
    try {
      return await retrying(async () => {
        const load = await loadThemeFolder(
          path,
          id,
          bases,
          this.loader,
          builtIn,
          readability,
          unread,
        )
        if (!load.ok && load.refused !== undefined) {
          last = load
          throw load.refused
        }
        return load
      })
    } catch (error) {
      return (
        last ?? {
          ok: false,
          problems: [{ at: 'theme.json', says: this.options.problem('unreadable') }],
          refused: error,
        }
      )
    }
  }

  /**
   * Puts back a theme a save set aside and could not return: one whose folder is missing while a
   * `.previous` copy of it is there. Every look and read waits out a brief hold, and only the
   * system saying a path does not exist counts as missing. The newest copy that reads and checks
   * as a complete theme is moved back under the theme's own name. A partial or broken copy is
   * left on disk as it is and not shown. A copy that can't be looked at or read, or that extends a
   * built-in that can't be read, a theme folder that can't be looked at, or a move that stays
   * refused moves nothing more, puts no older copy back past a newer one, and leaves the theme
   * listed as one that can't be used. Answers the ids listed so.
   */
  private async putBackSetAside(
    root: string,
    bases: ReadonlyMap<string, LoadedTheme>,
    unread: UnreadBases,
    names: readonly string[],
  ): Promise<string[]> {
    const copies = new Map<string, { path: string; at: number }[]>()
    // Themes with a copy the system won't let the app look at: its age is unknown, so no other
    // copy of the theme is put back past it.
    const unseen = new Set<string>()
    for (const name of names) {
      const id = SET_ASIDE.exec(name)?.[1]
      if (!id || this.reserved.has(id)) continue
      const path = join(root, name)
      let stat: Stats
      try {
        stat = await retrying(() => (this.files.lstat ?? lstat)(path))
      } catch (error) {
        if (!saysAbsent(error)) {
          unseen.add(id)
          copies.set(id, copies.get(id) ?? [])
        }
        continue
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue
      copies.set(id, [...(copies.get(id) ?? []), { path, at: stat.mtimeMs }])
    }
    const unrecovered: string[] = []
    for (const [id, found] of copies) {
      const target = join(root, id)
      let missing: boolean
      try {
        await retrying(() => (this.files.lstat ?? lstat)(target))
        continue
      } catch (error) {
        missing = saysAbsent(error)
      }
      if (!missing || unseen.has(id)) {
        unrecovered.push(id)
        continue
      }
      let complete: string | undefined
      let refused = false
      for (const copy of [...found].sort((a, b) => b.at - a.at)) {
        // Judged as the theme will be once it is back: a copy that fails only a readability check
        // is complete, and loads with notes.
        const loaded = await this.settledLoad(copy.path, id, bases, unread, false, 'note')
        if (loaded.ok) {
          complete = copy.path
          break
        }
        if (loaded.refused !== undefined) {
          refused = true
          break
        }
      }
      if (refused) {
        unrecovered.push(id)
        continue
      }
      if (!complete) continue
      const from = complete
      try {
        await retrying(() => this.files.rename(from, target))
      } catch {
        unrecovered.push(id)
      }
    }
    return unrecovered
  }

  private async reload(): Promise<void> {
    this.options.assertWorkspace?.()
    // The library may be new; its parent must already exist.
    await mkdir(this.options.library).catch((error: unknown) => {
      if (saysAbsent(error)) throw error
    })
    this.options.assertWorkspace?.()
    const library = await themeFolderState(this.options.library, this.files.lstat)
    this.libraryRoot = library.kind === 'here' ? library.root : null
    // Where a folder of themes couldn't be looked at or listed, the themes known from the last
    // load (and the workspace's choice) stay listed as ones that can't be used.
    const unlisted = new Set<ThemeSource>(library.kind === 'unresolved' ? ['mine'] : [])
    const next = new Map<string, ThemeEntry>()
    const bases = new Map<string, LoadedTheme>()
    const hiddenIds = new Set(this.options.hiddenBases ?? [])
    const hidden = new Map<string, LoadedTheme>()
    next.set('classic', {
      row: { id: 'classic', name: CLASSIC_THEME.name, source: 'built-in', status: 'ok' },
    })
    bases.set('classic', {
      theme: CLASSIC_THEME,
      resolved: CLASSIC_THEME,
      root: '',
      version: createHash('sha256').update(JSON.stringify(CLASSIC_THEME)).digest('hex'),
      assets: new Map(),
      pictures: new Map(),
    })
    const built = await themeFolderState(this.options.builtIns, this.files.lstat)
    const builtRoot = built.kind === 'here' ? built.root : null
    if (built.kind === 'unresolved') unlisted.add('built-in')
    const builtNames = builtRoot ? await this.names(builtRoot) : []
    if (builtNames === null) unlisted.add('built-in')
    const builtIds = (builtNames ?? []).filter((name) => THEME_ID.test(name)).sort()
    for (const id of builtIds) this.reserved.add(id)
    // Built-ins that couldn't be read on this load: each one whose read stayed refused, and, when
    // the built-in folder couldn't be looked at or listed, every built-in the app knows of. A
    // theme that extends one is listed as one that can't be used, never judged invalid.
    const refusedBuiltIns = new Set<string>()
    const builtInsUnknown = unlisted.has('built-in')
    const reserved = this.reserved
    const unread: UnreadBases = {
      has: (id) =>
        !bases.has(id) && (refusedBuiltIns.has(id) || (builtInsUnknown && reserved.has(id))),
    }
    const pending = new Set(builtIds.filter((id) => id !== 'classic'))
    for (let pass = 0; pass <= builtIds.length && pending.size; pass++) {
      let progress = false
      for (const id of pending) {
        const result = await this.settledLoad(join(builtRoot!, id), id, bases, unread, true)
        if (!result.ok && result.refused !== undefined) {
          refusedBuiltIns.add(id)
          pending.delete(id)
          progress = true
        }
        if (result.ok && hiddenIds.has(id)) {
          bases.set(id, result.loaded)
          hidden.set(id, result.loaded)
          pending.delete(id)
          progress = true
        } else if (result.ok) {
          bases.set(id, result.loaded)
          next.set(id, {
            row: {
              id,
              name: result.loaded.theme.name,
              source: 'built-in',
              status: 'ok',
              version: result.loaded.version,
            },
            loaded: result.loaded,
          })
          pending.delete(id)
          progress = true
        } else if (!hiddenIds.has(id)) {
          next.set(id, {
            row: {
              id,
              name: id,
              source: 'built-in',
              status: 'refused',
              problems: result.problems,
              reason: result.problems[0]?.says,
            },
          })
        }
      }
      if (!progress) break
    }
    let unrecovered: string[] = []
    let libraryIds: readonly string[] = []
    if (this.libraryRoot) {
      const before = await this.names(this.libraryRoot)
      if (before !== null)
        unrecovered = await this.putBackSetAside(this.libraryRoot, bases, unread, before)
      // Listed again after putting copies back, so a theme put back is listed under its name.
      const after = before === null ? null : await this.names(this.libraryRoot)
      if (after === null) unlisted.add('mine')
      libraryIds = (after ?? []).filter((name) => THEME_ID.test(name)).sort()
    }
    if (this.libraryRoot) {
      for (const id of libraryIds) {
        if (this.reserved.has(id)) continue
        // A person's own theme was accepted when it was saved. If a stricter readability check
        // has come since, it still loads, and what the check now says is kept as its notes; only
        // a broken or unsafe theme is refused, and a read the system refused leaves it unresolved.
        const result = await this.settledLoad(
          join(this.libraryRoot, id),
          id,
          bases,
          unread,
          false,
          'note',
        )
        const notes = result.ok ? result.loaded.notes : undefined
        next.set(
          id,
          result.ok
            ? {
                row: {
                  id,
                  name: result.loaded.theme.name,
                  source: 'mine',
                  status: 'ok',
                  version: result.loaded.version,
                  ...(notes?.length ? { problems: notes, reason: notes[0]!.says } : {}),
                },
                loaded: result.loaded,
              }
            : {
                row: {
                  id,
                  name: id,
                  source: 'mine',
                  status: 'refused',
                  problems: result.problems,
                  reason: result.problems[0]?.says,
                },
              },
        )
      }
    }
    // A theme whose folder could not be put back is still listed, as one that can't be used.
    for (const id of unrecovered) {
      if (next.has(id)) continue
      const problems = [{ at: 'theme.json', says: this.options.problem('unreadable') }]
      next.set(id, {
        row: {
          id,
          name: id,
          source: 'mine',
          status: 'refused',
          problems,
          reason: problems[0]!.says,
        },
      })
    }
    // The choice file is only read here; a choice that can't be read leaves the last one standing.
    const choice = await readThemeChoice(
      this.options.userData,
      this.loader.readFiles,
      this.files.lstat,
    )
    // A starting look this store gave but could not write stands until a choice is written.
    if (choice.kind === 'chosen' && (choice.id !== null || !this.wroteTheDefault))
      this.requested = choice.id
    if (
      this.options.writesItsDefault === true &&
      !this.wroteTheDefault &&
      choice.kind === 'chosen' &&
      choice.id === null &&
      (await this.noChoiceFile())
    ) {
      this.wroteTheDefault = true
      const starting = this.options.startingTheme ?? this.options.defaultTheme
      this.requested = starting
      try {
        await writeActiveTheme(this.options.userData, starting, this.files)
      } catch (error) {
        // It still shows this launch. A later start judges the workspace again, and by then a new
        // workspace may hold data and be given classic.
        this.options.warn?.(
          `BroCrew could not keep this workspace's starting look: ${(error as Error).message}`,
        )
      }
    }
    const choiceUnknown = choice.kind === 'unresolved' && this.requested === null
    if (unlisted.size > 0) {
      const unavailable = (id: string, source: ThemeSource): void => {
        if (next.has(id) || hiddenIds.has(id)) return
        const problems = [{ at: 'theme.json', says: this.options.problem('unreadable') }]
        next.set(id, {
          row: { id, name: id, source, status: 'refused', problems, reason: problems[0]!.says },
        })
      }
      for (const [id, entry] of this.registry) {
        if (unlisted.has(entry.row.source)) unavailable(id, entry.row.source)
      }
      if (builtInsUnknown)
        for (const id of this.options.builtInIds) if (id !== 'classic') unavailable(id, 'built-in')
      const chosen = this.requested
      if (chosen && chosen !== 'classic') {
        const source: ThemeSource = this.reserved.has(chosen) ? 'built-in' : 'mine'
        if (unlisted.has(source)) unavailable(chosen, source)
      }
    }
    this.registry.clear()
    this.bases.clear()
    this.hidden.clear()
    for (const [id, loaded] of hidden) this.hidden.set(id, loaded)
    for (const [id, entry] of next) this.registry.set(id, entry)
    for (const [id, loaded] of bases) this.bases.set(id, loaded)
    this.unread = unread
    const desired = this.forceDefault
      ? this.options.defaultTheme
      : (this.requested ?? this.options.defaultTheme)
    this.active = this.available(desired) ? desired : this.options.defaultTheme
    if (!this.available(this.active)) this.active = 'classic'
    this.reason =
      !this.available(desired) || choiceUnknown ? this.options.problem('fallback') : undefined
  }

  /** Whether the workspace has no choice file at all: not one that can't be read or makes no sense. */
  private async noChoiceFile(): Promise<boolean> {
    try {
      await (this.files.lstat ?? lstat)(join(this.options.userData, ACTIVE_THEME_FILE))
      return false
    } catch (error) {
      return saysAbsent(error)
    }
  }

  private problem(rail: ThemeRefused['rail'], at: string, kind: ThemeStoreProblem): ThemeRefused {
    return refused(rail, [{ at, says: this.options.problem(kind) }])
  }

  private async choose(id: string, actor?: string): Promise<ThemeSet | ThemeRefused> {
    if (!this.available(id)) return refused('theme-unknown', this.registry.get(id)?.row.problems)
    const previous = this.active
    try {
      await writeActiveTheme(this.options.userData, id, this.files)
    } catch {
      return this.problem('theme-invalid', ACTIVE_THEME_FILE, 'choice')
    }
    this.forceDefault = false
    this.requested = id
    this.active = id
    this.reason = undefined
    this.announce(previous, actor)
    return { outcome: 'ok', active: id, previous }
  }

  set(id: string, actor?: string): Promise<ThemeSet | ThemeRefused> {
    return this.serial(async () => {
      await this.reload()
      return this.choose(id, actor)
    })
  }

  // The escape hatch still changes the window when its choice file cannot be written.
  showDefault(): Promise<ThemeSnapshot> {
    return this.serial(async () => {
      await this.reload()
      const previous = this.active
      const id = this.available(this.options.defaultTheme) ? this.options.defaultTheme : 'classic'
      this.forceDefault = true
      this.active = id
      this.reason = undefined
      try {
        await writeActiveTheme(this.options.userData, id, this.files)
        this.requested = id
        this.forceDefault = false
      } catch {
        this.reason = this.options.problem('choice')
      }
      this.announce(previous)
      return this.snapshot()
    })
  }

  private async offeredAssets(
    input: ThemeSaveInput,
  ): Promise<readonly ThemeAssetBytes[] | ThemeRefused> {
    const assets = input.assets ?? []
    if (assets.length > LIMITS.files)
      return refused('theme-too-large', [
        { at: 'assets', says: themeFilesProblem(assets.length, LIMITS.files) },
      ])
    const names = new Set<string>()
    const result: ThemeAssetBytes[] = []
    let total = 0
    for (const [i, asset] of assets.entries()) {
      const at = `assets[${i}]`
      const name = asset.name.startsWith('assets/') ? asset.name : `assets/${asset.name}`
      const pathProblem = assetPathProblem(name)
      if (pathProblem) return refused('theme-invalid', [{ at, says: pathProblem }])
      if (name.split('/').length - 2 > THEME_ASSET_DEPTH)
        return this.problem('theme-invalid', at, 'files')
      const folded = name.toLowerCase()
      if (
        [...names].some(
          (old) => old === folded || old.startsWith(`${folded}/`) || folded.startsWith(`${old}/`),
        )
      ) {
        return this.problem('theme-invalid', at, 'duplicate-asset')
      }
      names.add(folded)
      if ((asset.path === undefined) === (asset.base64 === undefined))
        return this.problem('theme-invalid', at, 'asset-input')
      let bytes: Buffer
      if (asset.path !== undefined) {
        if (!isAbsolute(asset.path)) return this.problem('theme-invalid', at, 'absolute-path')
        const read = await readOfferedThemeAsset(asset.path, LIMITS.pictureBytes)
        if (!read.ok)
          return read.failure === 'too-large'
            ? refused('theme-too-large', [
                { at, says: themeFileSizeProblem(asset.path, read.size, read.maximum) },
              ])
            : this.problem('theme-invalid', at, read.failure)
        bytes = read.bytes
      } else {
        const text = asset.base64!
        if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
          return this.problem('theme-invalid', at, 'base64')
        const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
        const last = padding ? alphabet.indexOf(text[text.length - padding - 1]!) : 0
        if (padding && (last < 0 || (last & (padding === 2 ? 15 : 3)) !== 0))
          return this.problem('theme-invalid', at, 'base64')
        const size = (text.length / 4) * 3 - padding
        if (size > LIMITS.pictureBytes)
          return refused('theme-too-large', [
            { at, says: themeFileSizeProblem(name, size, LIMITS.pictureBytes) },
          ])
        bytes = Buffer.from(text, 'base64')
        if (bytes.toString('base64') !== text) return this.problem('theme-invalid', at, 'base64')
      }
      total += bytes.length
      if (total > LIMITS.themeBytes)
        return refused('theme-too-large', [
          { at: 'assets', says: themeSizeProblem(total, LIMITS.themeBytes, false) },
        ])
      const inspected = inspectThemeAsset(name, bytes)
      if (!inspected.ok)
        return refused(inspected.tooLarge ? 'theme-too-large' : 'theme-invalid', inspected.problems)
      result.push({ path: name, bytes, facts: inspected.facts })
    }
    return result
  }

  save(input: ThemeSaveInput, actor?: string): Promise<ThemeSaved | ThemeRefused> {
    return this.serial(() => this.saveInside(input, actor))
  }

  private async saveInside(
    input: ThemeSaveInput,
    actor?: string,
  ): Promise<ThemeSaved | ThemeRefused> {
    let document: string
    try {
      document = JSON.stringify(input.theme)
      if (typeof document !== 'string') return this.problem('theme-invalid', 'theme.json', 'json')
    } catch {
      return this.problem('theme-invalid', 'theme.json', 'json')
    }
    if (Buffer.byteLength(document) > THEME_JSON_BYTES)
      return refused('theme-too-large', [
        {
          at: 'theme.json',
          says: themeFileSizeProblem('theme.json', Buffer.byteLength(document), THEME_JSON_BYTES),
        },
      ])
    await this.reload()
    const raw = input.theme
    const id = object(raw) && typeof raw.id === 'string' ? raw.id : ''
    if (!THEME_ID.test(id))
      return refused('theme-invalid', [
        {
          at: 'id',
          says: '`id` should be 1 to 40 lowercase letters, digits and hyphens, starting and ending with a letter or digit.',
        },
      ])
    if (this.reserved.has(id)) return refused('theme-is-built-in')
    const offered = await this.offeredAssets(input)
    if ('outcome' in offered) return offered
    if (
      Buffer.byteLength(document) +
        offered.reduce((total, asset) => total + asset.bytes.length, 0) >
      LIMITS.themeBytes
    )
      return refused('theme-too-large', [
        {
          at: 'theme.json',
          says: themeSizeProblem(
            Buffer.byteLength(document) +
              offered.reduce((total, asset) => total + asset.bytes.length, 0),
            LIMITS.themeBytes,
          ),
        },
      ])
    const checked = validateThemeBytes(
      raw,
      offered,
      this.bases,
      this.loader,
      false,
      'refuse',
      this.unread,
    )
    if (!checked.ok)
      return refused(checked.tooLarge ? 'theme-too-large' : 'theme-invalid', checked.problems)
    const savedDocument = `${JSON.stringify(checked.theme, null, 2)}\n`
    const savedSize = Buffer.byteLength(savedDocument)
    if (savedSize > THEME_JSON_BYTES)
      return refused('theme-too-large', [
        { at: 'theme.json', says: themeFileSizeProblem('theme.json', savedSize, THEME_JSON_BYTES) },
      ])
    const savedTotal = savedSize + offered.reduce((total, asset) => total + asset.bytes.length, 0)
    if (savedTotal > LIMITS.themeBytes)
      return refused('theme-too-large', [
        { at: 'theme.json', says: themeSizeProblem(savedTotal, LIMITS.themeBytes) },
      ])
    const root = this.libraryRoot
    if (!root) return this.problem('theme-invalid', 'theme.json', 'save')
    const release = await themeWriteLock(root, id)
    if (!release) return this.problem('theme-invalid', 'theme.json', 'busy')
    let stage: string | undefined
    let previous: string | undefined
    let published = false
    try {
      if ((await themeDirectory(this.options.library)) !== root)
        return this.problem('theme-invalid', 'theme.json', 'changed')
      const target = join(root, id)
      const old = await lstat(target).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
        throw error
      })
      if (old?.isSymbolicLink()) return this.problem('theme-invalid', 'theme.json', 'link')
      if (old && !old.isDirectory()) return this.problem('theme-invalid', 'theme.json', 'save')
      if (old && !input.replace) return refused('theme-exists')
      stage = await mkdtemp(join(root, `.theme-${id}-`))
      const write = async (path: string, bytes: string | Buffer): Promise<void> => {
        await mkdir(dirname(path), { recursive: true })
        const file = await open(path, 'wx', 0o600)
        try {
          await file.writeFile(bytes)
          await file.sync()
        } finally {
          await file.close()
        }
      }
      await write(join(stage, 'theme.json'), savedDocument)
      for (const asset of offered) await write(join(stage, asset.path), asset.bytes)
      if (old) {
        const history = await this.names(join(target, '.history'))
        if (history === null) throw new Error('unlisted theme history')
        const versions = history
          .filter((name) => /^[0-9]{1,16}-[a-f0-9-]{36}\.json$/.test(name))
          .sort((a, b) => Number(a.split('-')[0]) - Number(b.split('-')[0]) || a.localeCompare(b))
        for (const name of versions.slice(-9)) {
          const read = await readThemeFile(target, `.history/${name}`, THEME_JSON_BYTES)
          if (!read.ok) throw new Error('unreadable theme history')
          await write(join(stage, '.history', name), read.bytes)
        }
        const read = await readThemeFile(target, 'theme.json', THEME_JSON_BYTES)
        if (!read.ok) throw new Error('unreadable previous theme')
        const last = Number(versions.at(-1)?.split('-')[0] ?? 0)
        await write(
          join(stage, '.history', `${Math.max(Date.now(), last + 1)}-${randomUUID()}.json`),
          read.bytes,
        )
        const current = await lstat(target)
        if (current.isSymbolicLink() || current.dev !== old.dev || current.ino !== old.ino)
          throw new Error('changed theme folder')
        previous = join(root, `.theme-${id}.${randomUUID()}.previous`)
        // A file another program holds for a moment (antivirus, an indexer) is tried again, so a
        // save neither fails nor loses the theme for a lock that clears by itself.
        const kept = previous
        await retrying(() => this.files.rename(target, kept))
      }
      try {
        const staged = stage
        await retrying(() => this.files.rename(staged, target))
      } catch (error) {
        if (previous) {
          const kept = previous
          await retrying(() => this.files.rename(kept, target))
          previous = undefined
        }
        throw error
      }
      stage = undefined
      published = true
      await this.reload()
      const warnings: string[] = []
      if (input.activate) {
        const set = await this.choose(id, actor)
        if (set.outcome === 'refused') {
          warnings.push(...set.problems.map((problem) => problem.says))
          this.announce()
        }
      } else this.announce()
      return { outcome: 'ok', id, version: checked.version, active: this.active, warnings }
    } catch {
      return this.problem('theme-invalid', 'theme.json', 'save')
    } finally {
      if (stage) await rm(stage, { recursive: true, force: true }).catch(() => undefined)
      if (published && previous)
        await rm(previous, { recursive: true, force: true }).catch(() => undefined)
      await release().catch(() => undefined)
    }
  }

  duplicate(id: string, name: string): Promise<ThemeSaved | ThemeRefused> {
    return this.serial(async () => {
      await this.reload()
      if (id === 'classic') {
        const seed =
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 30)
            .replace(/-$/, '') || 'theme'
        let next = seed
        for (let i = 2; this.registry.has(next) || this.reserved.has(next); i++)
          next = `${seed}-${i}`
        return this.saveInside({ theme: { ...CLASSIC_THEME, id: next, name } })
      }
      const source = this.registry.get(id)?.loaded
      if (!source) return refused('theme-unknown', this.registry.get(id)?.row.problems)
      const seed =
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 30)
          .replace(/-$/, '') || 'theme'
      let next = seed
      for (let i = 2; this.registry.has(next) || this.reserved.has(next); i++) next = `${seed}-${i}`
      if (this.reserved.has(id)) {
        return this.saveInside({ theme: { format: 1, id: next, name, extends: id } })
      }
      const assets: { name: string; base64: string }[] = []
      for (const asset of source.assets.values()) {
        const read = await readThemeFile(source.root, asset.path, asset.facts.bytes)
        if (!read.ok) return this.problem('theme-invalid', asset.path, read.failure)
        if (createHash('sha256').update(read.bytes).digest('hex') !== asset.digest)
          return this.problem('theme-invalid', asset.path, 'changed')
        assets.push({ name: asset.path, base64: read.bytes.toString('base64') })
      }
      return this.saveInside({ theme: { ...source.theme, id: next, name }, assets })
    })
  }

  delete(id: string): Promise<ThemeDeleted | ThemeRefused> {
    return this.serial(async () => {
      await this.reload()
      if (this.reserved.has(id)) return refused('theme-is-built-in')
      if (!this.registry.has(id) || !this.libraryRoot) return refused('theme-unknown')
      const release = await themeWriteLock(this.libraryRoot, id)
      if (!release) return this.problem('theme-invalid', 'theme.json', 'busy')
      try {
        const target = join(this.libraryRoot, id)
        if (!(await themeDirectory(target)))
          return this.problem('theme-invalid', 'theme.json', 'link')
        try {
          await this.options.trash(target)
        } catch {
          return this.problem('theme-invalid', 'theme.json', 'trash')
        }
        const previous = this.active
        if (this.requested === id) {
          await writeActiveTheme(
            this.options.userData,
            this.options.defaultTheme,
            this.files,
          ).catch(() => undefined)
        }
        await this.reload()
        this.announce(previous)
        return { outcome: 'ok', id, active: this.active }
      } finally {
        await release().catch(() => undefined)
      }
    })
  }

  openFolder(): Promise<{ readonly outcome: 'ok' } | ThemeRefused> {
    return this.serial(async () => {
      await this.reload()
      if (!this.libraryRoot) return this.problem('theme-invalid', 'themes', 'open-folder')
      try {
        await this.options.openFolder(this.libraryRoot)
        return { outcome: 'ok' }
      } catch {
        return this.problem('theme-invalid', 'themes', 'open-folder')
      }
    })
  }
}
