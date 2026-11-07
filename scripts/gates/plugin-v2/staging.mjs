// One real staging body, called by the hosted owner and bounded fake-boundary controls.
// Imports are pure. No Git/process/ACL operation exists without the explicit injected boundary.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { demand, readFile, hash, appSourceFor } from './contract.mjs'

export async function stageSource(
  version,
  { temp, repository, observe, command, privateRoot, checkNormalPluginBuild, cleanup },
) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(temp, 'plugin-v2-'))),
    records = []
  try {
    await privateRoot(root, records)
    const a = await observe(version, records, root)
    demand(a.appVersion === version && a.appSource === appSourceFor(version, a.routeCommit))
    projectedVersionArguments(version)
    fs.writeFileSync(path.join(root, 'observed-source.json'), JSON.stringify(a), {
      flag: 'wx',
      mode: 0o600,
    })
    fs.writeFileSync(path.join(root, 'gate-token'), randomBytes(32).toString('hex'), {
      flag: 'wx',
      mode: 0o600,
    })
    fs.writeFileSync(path.join(root, 'list-mode'), 'candidate', { flag: 'wx', mode: 0o600 })
    const repo = path.join(root, 'repo')
    await command(
      'git',
      ['clone', '--shared', '--no-checkout', '--template=', repository, repo],
      root,
      records,
    )
    await command(
      'git',
      [
        '-c',
        `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
        'checkout',
        '--detach',
        a.appSource,
      ],
      root,
      records,
      { cwd: repo },
    )
    // Overlay the gate from the tested checkout while keeping the selected app source.
    const files = (
      await command(
        'git',
        ['ls-files', '-z', 'scripts/gates/plugin-v2', 'scripts/check-no-plugin-gate-inputs.mjs'],
        root,
        records,
        { cwd: repository },
      )
    )
      .split('\0')
      .filter(Boolean)
    for (const file of files) {
      const to = path.join(repo, file)
      fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 })
      fs.writeFileSync(to, readFile(path.join(repository, file)), { mode: 0o600 })
    }
    const source = (
      await command('git', ['rev-parse', 'HEAD'], root, records, { cwd: repo })
    ).trim()
    demand(source === a.appSource)
    const sourceVersion = JSON.parse(readFile(path.join(repo, 'apps/desktop/package.json'))).version
    // Both reviewed release sources keep0.0.0 in package.json; Builder stamps the chosen test version.
    demand(sourceVersion === '0.0.0')
    checkNormalPluginBuild(repo)
    fs.writeFileSync(path.join(root, 'staged'), hash(Buffer.from(JSON.stringify(a))), {
      flag: 'wx',
      mode: 0o600,
    })
    return root
  } catch (error) {
    await cleanup(root, records)
    throw error
  }
}
export function projectedVersionArguments(version) {
  demand(['0.1.7', '0.1.8'].includes(version))
  return [`-c.extraMetadata.version=${version}`]
}
