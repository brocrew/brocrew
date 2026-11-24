import { providerKnowledge } from '../providers'
import { SUPPORTED_PROVIDERS } from '@brobot2/shared'
import { assertSkillPathsAreReal } from './skill-paths'
import { watch, type FSWatcher } from 'node:fs'
import { stat, mkdir, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import type { ProfileSkillMetadata, SharedSkill, SkillsWindow } from '../../shared/skills-window'
import { SkillsRequest } from '../../shared/skills-window'
import { SharedSkillLibrary } from './shared-library'
import type { VerifiedBuiltInSkills } from './built-in-catalogue'
import { nodeFs, writeAtomically } from '../recovery/files'
import { foldProfileName } from '../db/identity'
import type { SessionStore } from '../db/session-store'

export interface ProfileSkillAccess {
  readonly profileId: string
}

export interface PromptSkillsReading {
  readonly root: string
  readonly entries: readonly { id: string; name: string; revision: string }[]
}

/** Resolve an existing profile without creating an identity from a window request. */
export function profileSkillAccess(
  store: Pick<SessionStore, 'agentIdentityOf'>,
  profileId: string,
): ProfileSkillAccess | null {
  const profile = foldProfileName(profileId)
  return store.agentIdentityOf(profile) === null ? null : { profileId: profile }
}

const oneLine = (text: string, limit: number): string =>
  text.replace(/\s+/gu, ' ').trim().slice(0, limit)

function metadata(body: string, key: string): string {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)?.[1] ?? ''
  const lines = header.split(/\r?\n/)
  const at = lines.findIndex((line) => line.startsWith(`${key}:`))
  if (at < 0) return ''
  const value = lines[at]!.slice(key.length + 1).trim()
  if (/^[|>][-+]?$/.test(value)) {
    const block: string[] = []
    for (const line of lines.slice(at + 1)) {
      if (line !== '' && !/^\s/.test(line)) break
      block.push(line.trim())
    }
    return block.join(value.startsWith('>') ? ' ' : '\n').trim()
  }
  if (value.startsWith('"')) {
    try {
      const text: unknown = JSON.parse(value)
      return typeof text === 'string' ? text : value
    } catch {
      return value
    }
  }
  if (value.startsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  return value.replace(/\s+#.*$/, '')
}

/** One editable tree. Watching invalidates the page; native readers reload at each turn boundary. */
export class SharedSkillDiscovery {
  readonly library: SharedSkillLibrary
  private watcher?: FSWatcher
  private offWatcher?: FSWatcher
  private parentWatcher?: FSWatcher
  private manifestReady = false
  private generation = 0
  private cached?: { generation: number; skills: readonly SharedSkill[] }
  private promptSkills?: PromptSkillsReading
  private refreshingPromptSkills = false
  private closed = false
  constructor(
    readonly userData: string,
    private readonly ready: Promise<void>,
    private readonly shipped: () => VerifiedBuiltInSkills,
    library?: SharedSkillLibrary,
    private readonly access?: (profileId: string) => ProfileSkillAccess | null,
  ) {
    this.library = library ?? new SharedSkillLibrary(userData)
  }
  private invalidate = () => {
    this.generation++
    this.cached = undefined
    void this.refreshPromptSkills()
  }

  promptSkillsAtHand(): PromptSkillsReading | undefined {
    return this.promptSkills
  }

  private async refreshPromptSkills(): Promise<void> {
    if (this.closed || this.refreshingPromptSkills) return
    this.refreshingPromptSkills = true
    try {
      let generation: number
      do {
        generation = this.generation
        const skills = await this.list()
        if (!this.closed && generation === this.generation) {
          this.promptSkills = {
            root: this.library.active,
            entries: skills
              .filter((skill) => skill.enabled)
              .map((skill) => ({
                id: `${skill.builtIn ? 'built-in' : 'shared'}:${skill.folder}`,
                name: oneLine(skill.name, 120),
                revision: createHash('sha256').update(skill.body).digest('hex'),
              })),
          }
        }
      } while (!this.closed && generation !== this.generation)
    } catch (error) {
      if (!this.closed) console.warn(`BroCrew could not refresh shared skills: ${String(error)}`)
    } finally {
      this.refreshingPromptSkills = false
    }
  }
  async root(): Promise<string> {
    await this.ready
    if (this.closed)
      throw new Error(`${this.library.active}: shared skill discovery is closed or unavailable`)
    const root = this.library.active
    if (!this.manifestReady) {
      const files = new Map<string, string>()
      for (const provider of SUPPORTED_PROVIDERS) {
        const policy = providerKnowledge[provider].skills
        for (const [path, text] of policy.sharedFiles?.() ?? []) files.set(path, text)
      }
      const directories = new Set<string>()
      for (const path of files.keys()) {
        const parts = path.split('/')
        for (let end = 1; end < parts.length; end++) directories.add(parts.slice(0, end).join('/'))
      }
      await assertSkillPathsAreReal(
        this.userData,
        [root, ...[...directories, ...files.keys()].map((path) => join(root, path))],
        nodeFs,
      )
      for (const path of directories)
        await mkdir(join(root, path), { recursive: true, mode: 0o700 })
      for (const [path, text] of files) await writeAtomically(join(root, path), text, nodeFs)
      this.manifestReady = true
    }
    if (this.closed)
      throw new Error(`${this.library.active}: shared skill discovery is closed or unavailable`)
    if (!this.watcher) this.watchTree()
    if (!this.parentWatcher) {
      this.parentWatcher = watch(this.userData, (event, name) => {
        if (event === 'rename' && (name === 'skills' || name === 'skills-off')) {
          this.invalidate()
          this.manifestReady = false
          this.watchTree()
        }
      })
      this.parentWatcher.on('error', () => {
        this.parentWatcher?.close()
        this.parentWatcher = undefined
        this.invalidate()
      })
      this.parentWatcher.unref()
    }
    return root
  }
  private watchTree(): void {
    this.watcher?.close()
    this.offWatcher?.close()
    this.watcher = undefined
    this.offWatcher = undefined
    if (this.closed) return
    try {
      this.watcher = watch(this.library.active, { recursive: true }, this.invalidate)
      this.offWatcher = watch(this.library.off, { recursive: true }, this.invalidate)
      for (const watcher of [this.watcher, this.offWatcher]) {
        watcher.on('error', () => {
          watcher.close()
          if (this.watcher === watcher) this.watcher = undefined
          if (this.offWatcher === watcher) this.offWatcher = undefined
          this.invalidate()
        })
        watcher.unref()
      }
    } catch {
      this.cached = undefined
    }
  }
  close(): void {
    this.closed = true
    this.watcher?.close()
    this.offWatcher?.close()
    this.parentWatcher?.close()
  }
  async prepareLaunch(): Promise<void> {
    await this.root()
    await this.library.convert(async () => [])
    this.generation++
    this.cached = undefined
    await this.refreshPromptSkills()
  }
  async list(): Promise<readonly SharedSkill[]> {
    await this.root()
    if (this.watcher && this.offWatcher && this.cached?.generation === this.generation)
      return this.cached.skills
    const stamp = this.generation
    const bundle = this.shipped()
    const skills: SharedSkill[] = bundle.catalogue.skills.map((one) => ({
      folder: one.name,
      name: one.name,
      description: one.description,
      body: bundle.bodies.get(one.name)!,
      builtIn: true,
      enabled: true,
    }))
    for (const [root, enabled] of [
      [this.library.active, true],
      [this.library.off, false],
    ] as const) {
      for (const folder of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (folder.name.startsWith('.')) continue
        let file
        try {
          if (!(await stat(join(root, folder.name))).isDirectory()) continue
          file = await open(
            join(root, folder.name, 'SKILL.md'),
            constants.O_RDONLY | (constants.O_NONBLOCK ?? 0),
          )
          const fileInfo = await file.stat()
          if (!fileInfo.isFile()) continue
          if (fileInfo.size > 1024 * 1024) {
            skills.push({
              folder: folder.name,
              name: folder.name,
              description: '',
              body: 'Skill text unavailable.',
              builtIn: false,
              enabled,
            })
            continue
          }
          const bytes = Buffer.alloc(Math.min(fileInfo.size, 1024 * 1024))
          let count = 0
          while (count < bytes.length) {
            const next = await file.read(bytes, count, bytes.length - count, null)
            if (next.bytesRead === 0) break
            count += next.bytesRead
          }
          const body = bytes.subarray(0, count).toString('utf8')
          skills.push({
            folder: folder.name,
            name: metadata(body, 'name') || folder.name,
            description: metadata(body, 'description'),
            body,
            builtIn: false,
            enabled,
          })
        } catch (error) {
          console.warn(`BroCrew skipped ${join(root, folder.name, 'SKILL.md')}: ${String(error)}`)
        } finally {
          await file?.close()
        }
      }
    }
    if (this.watcher && this.offWatcher && stamp === this.generation)
      this.cached = { generation: stamp, skills }
    return skills
  }
  /** A read-only page uses bounded headers, never the full-body or conversion paths. */
  private async profileMetadata(): Promise<readonly ProfileSkillMetadata[]> {
    await this.ready
    if (this.closed)
      throw new Error(`${this.library.active}: shared skill discovery is closed or unavailable`)
    const bundle = this.shipped()
    const skills: ProfileSkillMetadata[] = bundle.catalogue.skills.map((one) => ({
      folder: one.name,
      name: one.name,
      description: one.description,
      builtIn: true,
      enabled: true,
      given: true,
    }))
    for (const [root, enabled] of [
      [this.library.active, true],
      [this.library.off, false],
    ] as const) {
      await assertSkillPathsAreReal(this.userData, [root], nodeFs)
      for (const folder of (await readdir(root, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (folder.name.startsWith('.')) continue
        const path = join(root, folder.name, 'SKILL.md')
        let file
        try {
          if (!(await stat(join(root, folder.name))).isDirectory()) continue
          await assertSkillPathsAreReal(this.userData, [path], nodeFs)
          file = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
        } catch (error) {
          console.warn(`BroCrew skipped ${join(root, folder.name, 'SKILL.md')}: ${String(error)}`)
          continue
        }
        try {
          const stat = await file.stat()
          if (!stat.isFile()) throw new Error(`${path}: not a regular skill file`)
          const bytes = Buffer.alloc(Math.min(stat.size, 16 * 1024))
          let count = 0
          while (count < bytes.length) {
            const next = await file.read(bytes, count, bytes.length - count, count)
            if (next.bytesRead === 0) break
            count += next.bytesRead
          }
          const header = bytes.subarray(0, count).toString('utf8')
          skills.push({
            folder: folder.name,
            name: oneLine(metadata(header, 'name'), 256) || folder.name,
            description: oneLine(metadata(header, 'description'), 500),
            builtIn: false,
            enabled,
            given: enabled,
          })
        } catch (error) {
          console.warn(`BroCrew skipped ${join(root, folder.name, 'SKILL.md')}: ${String(error)}`)
        } finally {
          await file.close()
        }
      }
    }
    return skills
  }
  readonly window: SkillsWindow = async (request) => {
    const parsed = SkillsRequest.safeParse(request)
    if (!parsed.success) return { operation: 'refused', reason: 'invalid' }
    if (parsed.data.operation === 'profile-list') {
      if (!this.access) return { operation: 'refused', reason: 'source-unavailable' }
      const access = this.access(parsed.data.profileId)
      if (!access) return { operation: 'refused', reason: 'identity' }
      const skills = await this.profileMetadata()
      const offset = parsed.data.offset ?? 0
      return {
        operation: 'profile-list',
        profileId: access.profileId,
        skills: skills.slice(offset, offset + 50),
        nextOffset: offset + 50 < skills.length ? offset + 50 : null,
        readAt: Date.now(),
      }
    }
    if (parsed.data.operation === 'shared-list')
      return { operation: 'shared-list', skills: await this.list() }
    if (parsed.data.operation === 'shared-toggle') {
      await this.root()
      await this.library.setEnabled(parsed.data.folder, parsed.data.enabled)
      this.invalidate()
      return { operation: 'shared-toggle' }
    }
    return { operation: 'refused', reason: 'invalid' }
  }
}
