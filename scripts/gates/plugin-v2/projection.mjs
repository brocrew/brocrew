import fs from 'node:fs'
import path from 'node:path'
import { projectBuild } from '../plugin-packaged/contract.mjs'
import { demand, once } from './contract.mjs'
import { projectDiagnostics } from './diagnostics.mjs'

export function project(repo, options) {
  const main = path.join(repo, 'apps/desktop/src/main/index.ts')
  const composition = path.join(repo, 'apps/desktop/src/main/runtime-host-composition.ts')
  const config = fs.readFileSync(
    path.join(repo, 'apps/desktop/src/main/plugins/catalogue/build-config.ts'),
    'utf8',
  )
  const original = {
    main: fs.readFileSync(main, 'utf8'),
    // A staged source from before card 74 has no composition file.
    composition: fs.existsSync(composition) ? fs.readFileSync(composition, 'utf8') : null,
  }
  const together = original.composition === null
  const p = projectBuild(
    config,
    original.main,
    together ? null : original.composition,
    options.appData,
    options.browser,
  )
  const fixture = `            /* packaged-plugin-gate-only */ fixtureSource: ${JSON.stringify(path.join(options.appData, 'repo-fixture'))},\n`
  // Drive-qualified ESM imports must use forward slashes in the Windows Vite build.
  const provider = path.join(
    path.dirname(options.appData),
    'repo/scripts/gates/plugin-packaged/provider-fixture.mjs',
  )
  const forwardSlashes = (source) =>
    source.replace(JSON.stringify(provider), JSON.stringify(provider.replaceAll('\\', '/')))
  const entry = together ? forwardSlashes(once(p.entry, fixture, '')) : once(p.entry, fixture, '')
  const composed = together ? null : forwardSlashes(p.composition)
  demand(!entry.includes('fixtureSource:') && !entry.includes('repo-fixture'))
  fs.writeFileSync(main, entry)
  if (!together) fs.writeFileSync(composition, composed)
  const diagnostics = options.diagnostics ? projectDiagnostics(repo, options.root) : null
  return {
    restore() {
      diagnostics?.restore()
      fs.writeFileSync(main, original.main)
      if (!together) fs.writeFileSync(composition, original.composition)
      demand(
        fs.readFileSync(main, 'utf8') === original.main &&
          (together || fs.readFileSync(composition, 'utf8') === original.composition),
      )
    },
  }
}
