import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ownedRoot, requireCI } from './contract.mjs'
import { phaseStep } from './diagnostics.mjs'

/** Check only the declared public tools and the owned scratch paths; never change their modes. */
export async function preflight(root, tools, env = process.env) {
  ownedRoot(root)
  if (tools.length !== 3) throw new Error('Three declared tools required')
  for (const [index, tool] of tools.entries()) {
    await phaseStep(root, ['tool-node24', 'tool-node22', 'tool-pnpm'][index], () => {
      if (!path.isAbsolute(tool)) throw new Error('Invalid tool input')
      fs.accessSync(tool, fs.constants.R_OK | fs.constants.X_OK)
    })
  }
  await phaseStep(root, 'scratch-paths', () => {
    fs.accessSync(
      path.join(root, 'repo'),
      fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK,
    )
    for (const key of [
      'HOME',
      'TMPDIR',
      'npm_config_cache',
      'ELECTRON_CACHE',
      'ELECTRON_BUILDER_CACHE',
      'npm_config_store_dir',
    ]) {
      const folder = env[key]
      if (!folder?.startsWith(root + '/') || path.resolve(folder) !== folder)
        throw new Error('Invalid scratch cache')
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
      const file = path.join(folder, '.gate-write-check')
      const fd = fs.openSync(
        file,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        0o600,
      )
      fs.closeSync(fd)
      fs.unlinkSync(file)
    }
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  requireCI()
  const [root, ...tools] = process.argv.slice(2)
  await phaseStep(root, 'runner-preflight', () => preflight(root, tools)).catch(() => {
    process.exitCode = 1
  })
}
