import { assertSkillPathsAreReal } from './skill-paths'
import { watch, type FSWatcher } from 'node:fs'
import { lstat, mkdir, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { constants } from 'node:fs'
import type { ProfileSkillMetadata, SharedSkill, SkillsWindow } from '../../shared/skills-window'
import { SkillsRequest } from '../../shared/skills-window'
import { SharedSkillLibrary } from './shared-library'
import type { VerifiedBuiltInSkills } from './built-in-catalogue'
import { nodeFs, writeAtomically } from '../recovery/files'
import { creationAllowedSkills } from './built-in-catalogue'
import { foldProfileName } from '../db/identity'
import type { SessionStore } from '../db/session-store'
import { DEFAULT_PROFILE_ID } from '../runtime/provider-homes'

export interface ProfileSkillAccess {
  readonly profileId: string
  readonly canCreateAgents: boolean
  readonly isCoordinator: boolean
}

/** Read existing grants without creating an identity or accepting grants from a window. */
export function profileSkillAccess(
  store: Pick<SessionStore, 'capabilitiesOf'>,
  profileId: string,
): ProfileSkillAccess | null {
  const profile = foldProfileName(profileId)
  const grants = store.capabilitiesOf(profile)
  return grants === null
    ? null
    : {
        profileId: profile,
        canCreateAgents: grants.canCreateAgents === 'any',
        isCoordinator: profile === DEFAULT_PROFILE_ID,
      }
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
  }
  async root(): Promise<string> {
    await this.ready
    if (this.closed) throw new Error('Skills could not be read.')
    const root = this.library.active
    if (!this.manifestReady) {
      await assertSkillPathsAreReal(
        this.userData,
        [root, join(root, '.claude-plugin'), join(root, '.claude-plugin/plugin.json')],
        nodeFs,
      )
      await mkdir(join(root, '.claude-plugin'), { recursive: true, mode: 0o700 })
      await writeAtomically(
        join(root, '.claude-plugin/plugin.json'),
        JSON.stringify({ name: 'shared-skills', version: '1.0.0', skills: ['./'] }) + '\n',
        nodeFs,
      )
      this.manifestReady = true
    }
    if (this.closed) throw new Error('Skills could not be read.')
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
      this.invalidate()
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
    this.invalidate()
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
        if (folder.name.startsWith('.') || !folder.isDirectory() || folder.isSymbolicLink())
          continue
        let file
        try {
          file = await open(
            join(root, folder.name, 'SKILL.md'),
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
          )
          const stat = await file.stat()
          if (!stat.isFile()) continue
          if (stat.size > 1024 * 1024) {
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
          const bytes = Buffer.alloc(Math.min(stat.size, 1024 * 1024))
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
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            console.warn(`BroCrew skipped the shared skill ${folder.name}: ${String(error)}`)
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
  private async profileMetadata(
    access: ProfileSkillAccess,
  ): Promise<readonly ProfileSkillMetadata[]> {
    await this.ready
    if (this.closed) throw new Error('Skills could not be read.')
    const bundle = this.shipped()
    const selected = new Set(
      creationAllowedSkills(bundle.catalogue, access.canCreateAgents, access.isCoordinator).map(
        (one) => one.name,
      ),
    )
    const skills: ProfileSkillMetadata[] = bundle.catalogue.skills.map((one) => ({
      folder: one.name,
      name: one.name,
      description: one.description,
      builtIn: true,
      enabled: true,
      given: selected.has(one.name),
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
        // One skill that cannot be read is left out, with a line saying so; the rest are listed.
        if (folder.isSymbolicLink()) {
          console.warn(`BroCrew skipped the shared skill ${folder.name}: it is a link`)
          continue
        }
        if (!folder.isDirectory()) continue
        const path = join(root, folder.name, 'SKILL.md')
        let file
        try {
          await assertSkillPathsAreReal(this.userData, [path], nodeFs)
          file = await open(
            path,
            constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
          )
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            console.warn(`BroCrew skipped the shared skill ${folder.name}: ${String(error)}`)
          continue
        }
        try {
          const stat = await file.stat()
          if (!stat.isFile()) throw new Error('Skills could not be read.')
          const bytes = Buffer.alloc(Math.min(stat.size, 16 * 1024))
          let count = 0
          while (count < bytes.length) {
            const next = await file.read(bytes, count, bytes.length - count, count)
            if (next.bytesRead === 0) break
            count += next.bytesRead
          }
          await assertSkillPathsAreReal(this.userData, [path], nodeFs)
          const atPath = await lstat(path)
          const after = await file.stat()
          if (
            !atPath.isFile() ||
            atPath.isSymbolicLink() ||
            atPath.dev !== stat.dev ||
            atPath.ino !== stat.ino ||
            after.size !== stat.size ||
            after.mtimeMs !== stat.mtimeMs
          )
            throw new Error('Skills could not be read.')
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
          console.warn(`BroCrew skipped the shared skill ${folder.name}: ${String(error)}`)
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
      const skills = await this.profileMetadata(access)
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
