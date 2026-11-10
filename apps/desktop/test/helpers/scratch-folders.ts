import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

export function scratchFolders(): (name: string) => string {
  const folders: string[] = []
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })
  return (name) => {
    const folder = mkdtempSync(join(realpathSync(tmpdir()), `${name}-`))
    folders.push(folder)
    return folder
  }
}
