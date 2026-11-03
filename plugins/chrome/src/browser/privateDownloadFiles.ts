import fs from 'node:fs'
import path from 'node:path'
import { privateFolder } from '../privatePaths.js'

const unavailable = () => new Error('Plugin unavailable. Try again.')
const within = (root: string, file: string) => {
  const relative = path.relative(root, file)
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  )
}
/** A launch-time real root, never a filename or a newly adopted symlink target. */
export class PrivateDownloadFiles {
  private readonly real: string
  private readonly dev: bigint
  private readonly ino: bigint
  constructor(readonly root: string) {
    root = path.resolve(root)
    this.root = root
    const stat = fs.lstatSync(root, { bigint: true })
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw unavailable()
    this.real = fs.realpathSync(root)
    this.dev = stat.dev
    this.ino = stat.ino
  }
  private validRoot(): boolean {
    try {
      const stat = fs.lstatSync(this.root, { bigint: true })
      return (
        stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        stat.dev === this.dev &&
        stat.ino === this.ino &&
        fs.realpathSync(this.root) === this.real
      )
    } catch {
      return false
    }
  }
  private checked(file: string, directory: boolean): boolean {
    try {
      if (!this.validRoot() || !within(this.root, path.resolve(file))) return false
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) return false
      return within(this.real, fs.realpathSync(file))
    } catch {
      return false
    }
  }
  file(file: string): boolean {
    return this.checked(file, false)
  }
  directory(dir: string): boolean {
    return this.checked(dir, true)
  }
  requireFile(file: string): void {
    if (!this.file(file)) throw unavailable()
  }
  prepare(dir: string): void {
    if (!this.validRoot() || !within(this.root, path.resolve(dir))) throw unavailable()
    privateFolder(this.root, dir, true)
    if (!this.directory(dir)) throw unavailable()
  }
  remove(file: string): boolean {
    if (!this.file(file)) return false
    try {
      fs.rmSync(file, { force: true })
      return true
    } catch {
      return false
    }
  }
  removeEmpty(dir: string): void {
    if (path.resolve(dir) === this.root || !this.directory(dir)) return
    try {
      fs.rmdirSync(dir)
    } catch {
      /* Preserve an uncertain/nonempty directory. */
    }
  }
}
