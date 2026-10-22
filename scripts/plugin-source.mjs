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
function entries(root, revision, id) {
  return git(root, ['ls-tree', '-rz', revision, '--', `plugins/${pluginId(id)}/`])
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [header, name] = entry.split('\t')
      const [mode, type, hash] = header.split(' ')
      if (!['100644', '100755'].includes(mode) || type !== 'blob')
        throw new Error('Only regular plugin source files are allowed')
      return { mode, hash, name: name.slice(`plugins/${id}/`.length) }
    })
}

// Export every tracked plugin file unchanged. Generated release tooling lives outside this tree.
export function copyPluginSource(root, destination, id) {
  const source = path.join(root, 'plugins', pluginId(id))
  const files = entries(root, 'HEAD', id)
  if (!files.length) throw new Error('Missing plugin source tree')
  for (const file of files) {
    const from = path.join(source, file.name)
    if (!fs.lstatSync(from).isFile() || fs.lstatSync(from).isSymbolicLink())
      throw new Error('No linked export inputs')
    const to = path.join(destination, 'plugins', id, file.name)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    fs.chmodSync(to, file.mode === '100755' ? 0o755 : 0o644)
  }
}

export function verifyPluginSource({ root, canonicalRoot, id, sourceCommit }) {
  pluginId(id)
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? ''))
    throw new Error('An explicit full monorepo source commit is required')
  if (!canonicalRoot) throw new Error('The checked canonical monorepo is required')
  root = fs.realpathSync(root)
  canonicalRoot = fs.realpathSync(canonicalRoot)
  for (const folder of [root, canonicalRoot])
    if (fs.realpathSync(git(folder, ['rev-parse', '--show-toplevel'])) !== folder)
      throw new Error('Use the repository root')
  if (
    git(canonicalRoot, ['remote', 'get-url', 'origin']).replace(/\.git$/, '') !==
    'https://github.com/brocrew/brocrew'
  )
    throw new Error('The canonical source must be the public monorepo')
  if (git(canonicalRoot, ['rev-parse', 'HEAD']) !== sourceCommit)
    throw new Error('The canonical checkout does not match the explicit source pin')
  const repository = git(root, ['remote', 'get-url', 'origin'])
  const exported =
    repository.replace(/\.git$/, '') === `https://github.com/brocrew/brocrew-plugin-${id}`
  if (
    !exported &&
    (root !== canonicalRoot ||
      repository.replace(/\.git$/, '') !== 'https://github.com/brocrew/brocrew')
  )
    throw new Error('Use the exact public plugin or canonical repository')
  const expected = entries(canonicalRoot, sourceCommit, id)
  if (!expected.length) throw new Error('Missing canonical plugin tree')
  const folder = path.join(root, 'plugins', id)
  const actual = []
  const visit = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (prefix === '' && entry.name === 'node_modules') continue
      const name = prefix + entry.name
      if (entry.isSymbolicLink()) throw new Error('Linked plugin source refused')
      if (entry.isDirectory()) visit(path.join(dir, entry.name), name + '/')
      else if (entry.isFile()) actual.push(name)
      else throw new Error('Non-file plugin source refused')
    }
  }
  visit(folder)
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected.map((one) => one.name).sort()))
    throw new Error('The exported plugin file set differs from the canonical tree')
  for (const file of expected) {
    const current = path.join(folder, file.name)
    const bytes = execFileSync('git', ['-C', canonicalRoot, 'cat-file', 'blob', file.hash], {
      maxBuffer: 64 * 1024 * 1024,
    })
    if (!fs.readFileSync(current).equals(bytes))
      throw new Error('The exported plugin bytes differ from the canonical tree')
    if (
      process.platform !== 'win32' &&
      Boolean(fs.statSync(current).mode & 0o111) !== (file.mode === '100755')
    )
      throw new Error('The exported plugin file mode differs from the canonical tree')
  }
  return Object.freeze({
    sourceCommit,
    sourceTree: git(canonicalRoot, ['rev-parse', `${sourceCommit}:plugins/${id}`]),
    buildRepository: repository,
    buildCommit: git(root, ['rev-parse', 'HEAD']),
    exportCommit: exported ? git(root, ['rev-parse', 'HEAD']) : null,
  })
}
