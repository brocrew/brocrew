import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ids = new Set(['chrome', 'whatsapp'])
const git = (root, args, encoding = 'utf8') =>
  execFileSync('git', ['-C', root, ...args], { encoding, maxBuffer: 64 * 1024 * 1024 }).trimEnd()
const pluginId = (id) => {
  if (!ids.has(id)) throw new Error('Unknown plugin source')
  return id
}
function entries(root, revision, folder) {
  return git(root, ['ls-tree', '-rz', revision, '--', `${folder}/`])
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [header, name] = entry.split('\t')
      const [mode, type, hash] = header.split(' ')
      if (!['100644', '100755'].includes(mode) || type !== 'blob')
        throw new Error('Only regular plugin source files are allowed')
      return { mode, hash, name: name.slice(folder.length + 1) }
    })
}
// The plugin's own tree, then shared runtime and UI files.
const sources = (root, revision, id) =>
  [`plugins/${pluginId(id)}`, 'plugins/shared'].map((folder) => ({
    folder,
    files: entries(root, revision, folder),
  }))

// Generated release tooling lives outside the exported source trees.
export function copyPluginSource(root, destination, id) {
  const trees = sources(root, 'HEAD', id)
  if (!trees[0].files.length) throw new Error('Missing plugin source tree')
  for (const { folder, files } of trees) {
    for (const file of files) {
      const from = path.join(root, folder, file.name)
      if (!fs.lstatSync(from).isFile() || fs.lstatSync(from).isSymbolicLink())
        throw new Error('No linked export inputs')
      const to = path.join(destination, folder, file.name)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
      fs.chmodSync(to, file.mode === '100755' ? 0o755 : 0o644)
    }
  }
}
