import { statSync, type Stats } from 'node:fs'
import { lstat, mkdir } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { PACKAGED_WORKSPACE_REFUSAL } from './workspace-routing'

export class WorkspaceUnavailable extends Error {
  constructor() {
    super(PACKAGED_WORKSPACE_REFUSAL)
  }
}

/** A configured launch opens existing data; none of its startup helpers may recreate the root. */
export class ExistingWorkspace {
  constructor(
    private readonly root: string,
    private readonly admitted: Pick<Stats, 'dev' | 'ino'>,
  ) {}

  private assertRoot(): void {
    try {
      const now = statSync(this.root)
      if (!now.isDirectory() || now.dev !== this.admitted.dev || now.ino !== this.admitted.ino)
        throw new WorkspaceUnavailable()
    } catch {
      throw new WorkspaceUnavailable()
    }
  }

  assertDatabase(): void {
    this.assertRoot()
    try {
      if (!statSync(join(this.root, 'brobot2.sqlite')).isFile()) throw new WorkspaceUnavailable()
    } catch {
      throw new WorkspaceUnavailable()
    }
  }

  /** Make recovery's descendants one at a time, without ever making their workspace parent. */
  async mkdir(path: string, options?: { mode?: number; recursive?: boolean }): Promise<void> {
    const inside = relative(this.root, path)
    if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`))
      throw new WorkspaceUnavailable()
    this.assertRoot()
    if (!options?.recursive) {
      await mkdir(path, { mode: options?.mode })
      this.assertRoot()
      return
    }
    let at = this.root
    for (const part of inside.split(sep).filter(Boolean)) {
      at = join(at, part)
      this.assertRoot()
      try {
        await mkdir(at, { mode: options?.mode })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new WorkspaceUnavailable()
      }
      const entry = await lstat(at)
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new WorkspaceUnavailable()
    }
    this.assertRoot()
  }
}
