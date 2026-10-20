import { assertSkillPathsAreReal } from './skill-paths'
import { flushSkillTree } from './flush-skill-tree'
import { createHash, randomUUID } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import {
  errorCode,
  nodeFs,
  privateDir,
  syncFolder,
  writeAtomically,
  type RecoveryFs,
} from '../recovery/files'
import { copySkillTree, readSkillTree } from '../recovery/trees'
import { deriveProviderHome, HOME_FOLDER, providerHomesRoot } from '../runtime/provider-homes'
import { OFF_SKILLS_DIRNAME, SHARED_SKILLS_DIRNAME, SKILLS_CONVERSION_FILE } from './shared-paths'
import { RECENT_ACTIVITY_LINES, type SkillImportNotice } from '../../shared/recent-activity'

export interface SavedPersonalSkill {
  id: string
  name: string
  body: string
}
interface Receipt {
  source: string
  target: string | null
  stage: string | null
  done: boolean
  name?: string
  keptBoth?: SkillImportNotice
  retained?: boolean
  sha256?: string
  startId?: string
  quarantine?: string
}
interface Conversion {
  version: 1
  catalogueDone: boolean
  receipts: Receipt[]
}
const failure = () => new Error('Skills could not be read.')
const segment = (name: string) =>
  name !== '' && name !== '.' && name !== '..' && !/[\\/\0]/.test(name)
const folderName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'skill'
const appStartId = randomUUID()
const lanes = new Map<string, Promise<unknown>>()
async function serialized<T>(root: string, run: () => Promise<T>): Promise<T> {
  const prior = lanes.get(root) ?? Promise.resolve()
  const next = prior.catch(() => undefined).then(run)
  lanes.set(root, next)
  try {
    return await next
  } finally {
    if (lanes.get(root) === next) lanes.delete(root)
  }
}

async function exists(path: string, fs: RecoveryFs): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

/** Plain writable folders; receipts record imports and interrupted personal publications. */
export class SharedSkillLibrary {
  readonly active: string
  readonly off: string
  private readonly marker: string
  private activityCache?: { stamp: string; lines: readonly SkillImportNotice[] }
  constructor(
    readonly userData: string,
    private readonly fs: RecoveryFs = nodeFs,
    private readonly now = Date.now,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly startId: string = appStartId,
  ) {
    this.active = join(userData, SHARED_SKILLS_DIRNAME)
    this.off = join(userData, OFF_SKILLS_DIRNAME)
    this.marker = join(userData, SKILLS_CONVERSION_FILE)
  }
  private async folders(): Promise<void> {
    for (const path of [this.active, this.off]) {
      await assertSkillPathsAreReal(this.userData, [path], this.fs)
      await privateDir(path, this.fs)
    }
  }
  async save(path: string, body: string | Uint8Array): Promise<void> {
    return serialized(resolve(this.userData), async () => {
      const parts = path.split('/')
      if (parts.length < 2 || parts.some((part) => !segment(part)) || parts[0]!.startsWith('.'))
        throw failure()
      await this.folders()
      let parent = this.active
      for (const part of parts.slice(0, -1)) {
        parent = join(parent, part)
        await assertSkillPathsAreReal(this.userData, [parent], this.fs)
        await privateDir(parent, this.fs)
      }
      const target = join(parent, parts.at(-1)!)
      await assertSkillPathsAreReal(this.userData, [target], this.fs)
      await writeAtomically(target, body, this.fs)
    })
  }
  async setEnabled(name: string, enabled: boolean): Promise<void> {
    return serialized(resolve(this.userData), async () => {
      if (!segment(name) || name.startsWith('.')) throw failure()
      await this.folders()
      const from = join(enabled ? this.off : this.active, name)
      const to = join(enabled ? this.active : this.off, name)
      await assertSkillPathsAreReal(this.userData, [from, to], this.fs)
      if (await exists(to, this.fs)) throw failure()
      const stat = await this.fs.lstat(from)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure()
      await this.fs.rename(from, to)
      await syncFolder(this.active, this.fs, this.platform)
      await syncFolder(this.off, this.fs, this.platform)
    })
  }
  /** Try to hide retained originals whose shared copies are turned off. */
  async beforeOffer(): Promise<void> {
    return serialized(resolve(this.userData), async () => {
      await this.folders()
      await assertSkillPathsAreReal(this.userData, [this.marker], this.fs)
      await this.hideRetained(await this.readConversion())
    })
  }
  private async hideRetained(state: Conversion): Promise<void> {
    const commit = () => writeAtomically(this.marker, `${JSON.stringify(state)}\n`, this.fs)
    for (const receipt of state.receipts) {
      if (!receipt.retained) continue
      const parts = receipt.source.split('/')
      if (
        parts.length !== 4 ||
        parts[0] !== 'moved' ||
        !segment(parts[2]!) ||
        parts[2]!.startsWith('.')
      )
        throw failure()
      // Derive the home from a managed profile id, never from a receipt-supplied path.
      const home = deriveProviderHome(this.userData, { profileId: parts[1]!, provider: 'codex' })
      const original = join(home, 'skills', parts[2]!)
      if (!receipt.quarantine && !(await exists(join(this.off, receipt.target!), this.fs))) continue
      const parent = join(home, 'skills-retained')
      await assertSkillPathsAreReal(this.userData, [original, parent], this.fs)
      if (!receipt.quarantine) {
        receipt.quarantine = randomUUID()
        receipt.startId = this.startId
        await commit()
      }
      const hidden = join(parent, receipt.quarantine)
      await assertSkillPathsAreReal(this.userData, [hidden], this.fs)
      if (!(await exists(hidden, this.fs)) && (await exists(original, this.fs))) {
        if ((await readSkillTree(original, this.fs)).sha256 !== receipt.sha256) {
          // This name now belongs to a different skill. It is imported independently.
          receipt.retained = false
          await commit()
          continue
        }
        await privateDir(parent, this.fs)
        // Stamp a retried intent before renaming, even if a prior app recorded it.
        if (receipt.startId !== this.startId) {
          receipt.startId = this.startId
          await commit()
        }
        // Keep the original and retry next turn if this same-volume move fails.
        try {
          await this.fs.rename(original, hidden)
        } catch {
          console.warn('Could not hide a turned-off skill; trying again next turn.')
          continue
        }
        await syncFolder(join(home, 'skills'), this.fs, this.platform)
        await syncFolder(parent, this.fs, this.platform)
      }
      if (!(await exists(hidden, this.fs))) {
        receipt.retained = false
        await commit()
        continue
      }
      if ((await readSkillTree(hidden, this.fs)).sha256 !== receipt.sha256) throw failure()
      // A later process must observe the published destination before deleting this copy.
      if (receipt.startId === undefined || receipt.startId === this.startId) continue
      const targets = [join(this.active, receipt.target!), join(this.off, receipt.target!)]
      for (const target of targets) {
        await assertSkillPathsAreReal(this.userData, [target], this.fs)
        if (!(await exists(target, this.fs))) continue
        if ((await readSkillTree(target, this.fs)).sha256 !== receipt.sha256) continue
        await flushSkillTree(target, this.fs, this.platform, this.userData)
        if ((await readSkillTree(target, this.fs)).sha256 !== receipt.sha256) throw failure()
        await this.fs.rm(hidden, { recursive: true })
        await syncFolder(parent, this.fs, this.platform)
        receipt.retained = false
        await commit()
        break
      }
    }
  }
  async convert(personal: () => Promise<readonly SavedPersonalSkill[]>): Promise<void> {
    return serialized(resolve(this.userData), async () => {
      await this.folders()
      await assertSkillPathsAreReal(this.userData, [this.marker], this.fs)
      const state = await this.readConversion()
      await this.hideRetained(state)
      const retainedAtStart = state.receipts.filter(
        (one) => one.retained && one.startId !== undefined && one.startId !== this.startId,
      )
      const commit = () => writeAtomically(this.marker, `${JSON.stringify(state)}\n`, this.fs)
      const imports = join(this.off, '.imports')
      await assertSkillPathsAreReal(this.userData, [imports], this.fs)
      await privateDir(imports, this.fs)
      const available = async (preferred: string) => {
        const base = folderName(preferred)
        for (let n = 1; ; n++) {
          const name = n === 1 ? base : `${base}-${n}`
          if (
            !(await exists(join(this.active, name), this.fs)) &&
            !(await exists(join(this.off, name), this.fs))
          )
            return name
        }
      }
      const collision = (source: string, name: string, imported: string): SkillImportNotice => ({
        id: `skill-import:${createHash('sha256').update(source).digest('hex')}`,
        at: this.now(),
        name,
        existing: folderName(name),
        imported,
      })
      const publish = async (receipt: Receipt) => {
        if (receipt.done) return
        const stage = join(imports, receipt.stage!)
        if (await exists(stage, this.fs)) {
          await assertSkillPathsAreReal(this.userData, [stage], this.fs)
          const staged = await readSkillTree(stage, this.fs)
          if (
            (await exists(join(this.active, receipt.target!), this.fs)) ||
            (await exists(join(this.off, receipt.target!), this.fs))
          ) {
            for (const root of [this.active, this.off]) {
              const target = join(root, receipt.target!)
              if (await exists(target, this.fs)) {
                const stat = await this.fs.lstat(target)
                if (
                  stat.isDirectory() &&
                  !stat.isSymbolicLink() &&
                  (await readSkillTree(target, this.fs)).sha256 === staged.sha256
                ) {
                  await this.fs.rm(stage, { recursive: true, force: true })
                  await syncFolder(imports, this.fs)
                  receipt.done = true
                  await commit()
                  return
                }
              }
            }
            receipt.target = await available(receipt.name ?? receipt.target!)
            receipt.keptBoth = collision(
              receipt.source,
              receipt.name ?? receipt.target!,
              receipt.target,
            )
            await commit()
          }
          await assertSkillPathsAreReal(
            this.userData,
            [join(this.active, receipt.target!)],
            this.fs,
          )
          await this.fs.rename(stage, join(this.active, receipt.target!))
          await syncFolder(imports, this.fs)
          await syncFolder(this.active, this.fs, this.platform)
        }
        // An absent stage was already renamed, even if its published folder was later deleted.
        receipt.done = true
        await commit()
      }
      for (const receipt of state.receipts) await publish(receipt)
      const importOne = async (
        source: string,
        preferred: string,
        make: (stage: string) => Promise<void>,
      ) => {
        if (state.receipts.some((receipt) => receipt.source === source)) return
        const stageName = randomUUID()
        const stage = join(imports, stageName)
        try {
          await make(stage)
          await syncFolder(imports, this.fs)
          const digest = (await readSkillTree(stage, this.fs)).sha256
          let identical = false
          for (const root of [this.active, this.off]) {
            for (const name of (await this.fs.readdir(root)).sort()) {
              if (name.startsWith('.')) continue
              const candidate = join(root, name)
              const stat = await this.fs.lstat(candidate)
              if (
                stat.isDirectory() &&
                !stat.isSymbolicLink() &&
                (await readSkillTree(candidate, this.fs)).sha256 === digest
              )
                identical = true
            }
          }
          const receipt: Receipt = {
            source,
            name: preferred,
            target: identical ? null : await available(preferred),
            stage: identical ? null : stageName,
            done: identical,
          }
          if (receipt.target !== null && receipt.target !== folderName(preferred))
            receipt.keptBoth = collision(source, preferred, receipt.target)
          state.receipts.push(receipt)
          await commit()
          if (identical) await this.fs.rm(stage, { recursive: true, force: true })
          else await publish(receipt)
        } catch (error) {
          if (!state.receipts.some((receipt) => receipt.stage === stageName))
            await this.fs.rm(stage, { recursive: true, force: true })
          throw error
        }
      }
      if (!state.catalogueDone) {
        for (const skill of await personal()) {
          await importOne(`catalogue/${skill.id}`, skill.name, async (stage) => {
            await this.fs.mkdir(stage, { mode: 0o700 })
            await writeAtomically(join(stage, 'SKILL.md'), skill.body, this.fs)
          })
        }
        state.catalogueDone = true
        await commit()
      }
      const homes = join(providerHomesRoot(this.userData), HOME_FOLDER)
      await assertSkillPathsAreReal(this.userData, [homes], this.fs)
      if (!(await exists(homes, this.fs))) return
      for (const profile of (await this.fs.readdir(homes)).sort()) {
        if (!segment(profile)) continue
        const profileStats = await this.fs.lstat(join(homes, profile))
        if (profileStats.isSymbolicLink()) throw failure()
        if (!profileStats.isDirectory()) continue
        const sourceRoot = join(homes, profile, 'codex', 'skills')
        await assertSkillPathsAreReal(this.userData, [sourceRoot], this.fs)
        if (!(await exists(sourceRoot, this.fs))) continue
        for (const name of (await this.fs.readdir(sourceRoot)).sort()) {
          if (name.startsWith('.') || !segment(name)) continue
          const source = join(sourceRoot, name)
          const stat = await this.fs.lstat(source)
          if (stat.isSymbolicLink()) throw failure()
          if (!stat.isDirectory() || !(await exists(join(source, 'SKILL.md'), this.fs))) continue
          const before = await readSkillTree(source, this.fs)
          let target: string | undefined
          for (const root of [this.active, this.off]) {
            for (const existing of (await this.fs.readdir(root)).sort()) {
              if (existing.startsWith('.')) continue
              const candidate = join(root, existing)
              const stat = await this.fs.lstat(candidate)
              if (
                stat.isDirectory() &&
                !stat.isSymbolicLink() &&
                (await readSkillTree(candidate, this.fs)).sha256 === before.sha256
              )
                target = candidate
            }
          }
          const identical = target !== undefined
          const chosen = target ? basename(target) : await available(name)
          target ??= join(this.active, chosen)
          await assertSkillPathsAreReal(this.userData, [source, target], this.fs)
          if (!identical) {
            const copy = async () => {
              const stage = join(imports, randomUUID())
              try {
                const copied = await copySkillTree(source, stage, this.fs)
                if (copied.sha256 !== before.sha256) throw failure()
                await this.fs.rename(stage, target!)
              } finally {
                await this.fs.rm(stage, { recursive: true, force: true })
              }
            }
            if (this.platform === 'win32') await copy()
            else {
              await flushSkillTree(source, this.fs, this.platform, this.userData)
              try {
                await this.fs.rename(source, target)
              } catch (error) {
                if (errorCode(error) !== 'EXDEV') throw error
                await copy()
              }
            }
          }
          const directoriesFlushed = await flushSkillTree(
            target,
            this.fs,
            this.platform,
            this.userData,
          )
          let retained = false
          if (await exists(source, this.fs)) {
            await assertSkillPathsAreReal(this.userData, [source], this.fs)
            if (
              (await readSkillTree(source, this.fs)).sha256 !== before.sha256 ||
              (await readSkillTree(target, this.fs)).sha256 !== before.sha256
            )
              throw failure()
            const confirmed = retainedAtStart.find(
              (one) =>
                one.source.startsWith(`moved/${profile}/${name}/`) &&
                one.target === chosen &&
                one.sha256 === before.sha256,
            )
            const sameRunRetention = state.receipts.some(
              (one) =>
                one.retained &&
                one.source.startsWith(`moved/${profile}/${name}/`) &&
                one.sha256 === before.sha256 &&
                (one.startId === undefined || one.startId === this.startId),
            )
            if ((!sameRunRetention && directoriesFlushed) || confirmed) {
              await this.fs.rm(source, { recursive: true })
              if (confirmed) confirmed.retained = false
            } else retained = true
          }
          await syncFolder(sourceRoot, this.fs)
          for (const previous of state.receipts) {
            if (
              previous.source.startsWith(`moved/${profile}/${name}/`) &&
              previous.retained &&
              !previous.quarantine
            )
              previous.retained = false
          }
          const key = `moved/${profile}/${name}/${randomUUID()}`
          state.receipts.push({
            source: key,
            target: chosen,
            stage: null,
            done: true,
            ...(retained ? { retained: true, sha256: before.sha256, startId: this.startId } : {}),
            ...(chosen !== folderName(name) && !identical
              ? { keptBoth: collision(key, name, chosen) }
              : {}),
          })
          await commit()
        }
      }
    })
  }
  async recentImports(from: number, to: number): Promise<readonly SkillImportNotice[]> {
    await assertSkillPathsAreReal(this.userData, [this.marker], this.fs)
    if (!(await exists(this.marker, this.fs))) return []
    const stat = await this.fs.lstat(this.marker)
    const stamp = `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.size}`
    if (this.activityCache?.stamp !== stamp) {
      const state = await this.readConversion()
      this.activityCache = {
        stamp,
        lines: state.receipts.flatMap((r) => (r.done && r.keptBoth ? [r.keptBoth] : [])),
      }
    }
    return this.activityCache.lines
      .filter((line) => line.at >= from && line.at < to)
      .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
      .slice(0, RECENT_ACTIVITY_LINES)
      .map((line) => ({ ...line }))
  }
  private async readConversion(): Promise<Conversion> {
    if (!(await exists(this.marker, this.fs)))
      return { version: 1, catalogueDone: false, receipts: [] }
    const value: unknown = JSON.parse(await this.fs.readFile(this.marker))
    const state = value as Conversion
    if (
      !state ||
      state.version !== 1 ||
      typeof state.catalogueDone !== 'boolean' ||
      !Array.isArray(state.receipts) ||
      state.receipts.some(
        (r) =>
          !r ||
          typeof r.source !== 'string' ||
          typeof r.done !== 'boolean' ||
          (r.retained !== undefined && typeof r.retained !== 'boolean') ||
          (r.startId !== undefined &&
            (typeof r.startId !== 'string' || r.startId.length === 0 || r.startId.length > 128)) ||
          (r.quarantine !== undefined &&
            (typeof r.quarantine !== 'string' || !/^[0-9a-f-]{36}$/.test(r.quarantine))) ||
          (r.sha256 !== undefined &&
            (typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256))) ||
          (r.retained === true &&
            (!r.done ||
              !r.source.startsWith('moved/') ||
              r.target === null ||
              r.sha256 === undefined)) ||
          (r.name !== undefined && typeof r.name !== 'string') ||
          (r.keptBoth !== undefined &&
            (!r.keptBoth ||
              typeof r.keptBoth.id !== 'string' ||
              !Number.isFinite(r.keptBoth.at) ||
              typeof r.keptBoth.name !== 'string' ||
              typeof r.keptBoth.existing !== 'string' ||
              typeof r.keptBoth.imported !== 'string')) ||
          (r.target !== null &&
            (typeof r.target !== 'string' || !segment(r.target) || r.target.startsWith('.'))) ||
          (r.stage !== null && (typeof r.stage !== 'string' || !/^[0-9a-f-]{36}$/.test(r.stage))) ||
          (!r.done && (r.target === null || r.stage === null)),
      ) ||
      new Set(state.receipts.map((r) => r.source)).size !== state.receipts.length
    )
      throw failure()
    return state
  }
}
