import { statSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

export class WorkspaceUnavailable extends Error {
  constructor(path: string, cause: unknown) {
    super(
      `Could not open workspace path ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
}

/** A configured launch opens existing data, without recreating a missing workspace. */
export class ExistingWorkspace {
  constructor(private readonly root: string) {}

  assertDatabase(): void {
    const path = join(this.root, 'brobot2.sqlite')
    try {
      if (!statSync(path).isFile()) throw new Error('not a regular file')
    } catch (error) {
      throw new WorkspaceUnavailable(path, error)
    }
  }

  /** Create descendants without recursively recreating the workspace itself. */
  async mkdir(path: string, options?: { mode?: number; recursive?: boolean }): Promise<void> {
    const inside = relative(this.root, path)
    if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`))
      throw new WorkspaceUnavailable(path, new Error(`outside workspace ${this.root}`))
    if (!options?.recursive) {
      await mkdir(path, { mode: options?.mode })
      return
    }
    let at = this.root
    for (const part of inside.split(sep).filter(Boolean)) {
      at = join(at, part)
      try {
        await mkdir(at, { mode: options?.mode })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (!(await stat(at)).isDirectory())
          throw new Error(`${at}: not a directory`, { cause: error })
      }
    }
  }
}
