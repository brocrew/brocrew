// One real staging body, called by the hosted owner and bounded fake-boundary controls.
// Imports are pure. No Git/process/ACL operation exists without the explicit injected boundary.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { demand, readFile, hash } from './contract.mjs'

export async function stageSource({ temp, repository, observe, command, privateRoot, cleanup }) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(temp, 'plugin-v2-'))),
    records = []
  try {
    await privateRoot(root, records)
    const a = await observe(records, root)
    fs.writeFileSync(path.join(root, 'observed-source.json'), JSON.stringify(a), {
      flag: 'wx',
      mode: 0o600,
    })
    fs.writeFileSync(path.join(root, 'gate-token'), randomBytes(32).toString('hex'), {
      flag: 'wx',
      mode: 0o600,
    })
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
        a.routeCommit,
      ],
      root,
      records,
      { cwd: repo },
    )
    const source = (
      await command('git', ['rev-parse', 'HEAD'], root, records, { cwd: repo })
    ).trim()
    demand(source === a.routeCommit)
    const sourceVersion = JSON.parse(readFile(path.join(repo, 'apps/desktop/package.json'))).version
    // The app is built with the tested source's own version.
    demand(sourceVersion === a.appVersion)
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
