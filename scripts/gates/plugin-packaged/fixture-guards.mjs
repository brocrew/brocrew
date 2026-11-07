import fs from 'node:fs'
import path from 'node:path'

/** The private repositories whose hosted runners may run the gate; each workflow also requires private. */
export const GATE_REPOSITORIES = ['brocrew/brocrew']
export function requireCI(env = process.env, platform = process.platform, arch = process.arch) {
  if (
    env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    env.GITHUB_ACTIONS !== 'true' ||
    !GATE_REPOSITORIES.includes(env.GITHUB_REPOSITORY) ||
    !env.GITHUB_REF?.startsWith('refs/heads/gate/plugin-packaged-') ||
    platform !== 'darwin' ||
    arch !== 'arm64'
  )
    throw new Error('Private Mac gate only')
}
export function ownedRoot(root) {
  const info = fs.lstatSync(root)
  if (
    !path.isAbsolute(root) ||
    fs.realpathSync(root) !== root ||
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077 ||
    fs.readFileSync(path.join(root, 'fixture-owned'), 'utf8') !== 'packaged-plugin-gate\n'
  )
    throw new Error('Not an owned gate fixture')
  return root
}
