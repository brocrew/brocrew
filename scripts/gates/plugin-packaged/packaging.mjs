import { requireCI } from './contract.mjs'
// Builder owns packaging and signing, as in the normal hosted Mac job.
export function directoryPackageArguments() {
  return [
    '--filter',
    '@brobot2/desktop',
    'exec',
    'electron-builder',
    '--mac',
    '--arm64',
    '--dir',
    '--config',
    'electron-builder.yml',
    '-c.mac.identity=-',
    '-c.mac.signIgnore=/Contents/Resources/plugin-node/node$',
    '--publish',
    'never',
  ]
}

// Normal Builder signing may query the disposable runner's certificate identities.
// The earlier local build-only seam must stop before it can reach a person's Keychain.
export async function hostedBuilder(work) {
  requireCI()
  return work()
}

// Read-only build rehearsal only; never an alternate hosted packaging policy.
export function requireLocalRehearsal(
  env = process.env,
  platform = process.platform,
  arch = process.arch,
) {
  if (
    env.GITHUB_ACTIONS !== undefined ||
    env.RUNNER_ENVIRONMENT !== undefined ||
    env.CI === 'true' ||
    platform !== 'darwin' ||
    arch !== 'arm64'
  )
    throw new Error('Local Mac build rehearsal only')
}
export function localDirectoryPackageArguments() {
  requireLocalRehearsal()
  return directoryPackageArguments().map((arg) =>
    arg === '-c.mac.identity=-' ? '-c.mac.identity=null' : arg,
  )
}
