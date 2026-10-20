import fs from 'node:fs'
import path from 'node:path'

const unavailable = (): Error => new Error('Plugin unavailable. Try again.')
function within(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  )
}

// The host owns the supplied root and its parents. Every child must remain a real directory.
export function privateFolder(root: string, target: string, create = false): string {
  root = path.resolve(root)
  target = path.resolve(target)
  if (!within(root, target)) throw unavailable()
  const rootStat = fs.lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw unavailable()
  const realRoot = fs.realpathSync(root)
  const parts = path.relative(root, target).split(path.sep).filter(Boolean)
  let current = root
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i])
    let stat
    try {
      stat = fs.lstatSync(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (!create) return target
      try {
        fs.mkdirSync(current, { mode: 0o700 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      stat = fs.lstatSync(current)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw unavailable()
    const real = fs.realpathSync(current)
    if (
      !within(realRoot, real) ||
      path.relative(realRoot, real) !== parts.slice(0, i + 1).join(path.sep)
    )
      throw unavailable()
  }
  return target
}
