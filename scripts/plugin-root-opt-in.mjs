// Explicit offline setup only. Compilation stays in memory, including preview mode.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

try {
  const req = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
  const { build } = req(req.resolve('esbuild', { paths: [req.resolve('vite')] }))
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL('../apps/desktop/src/main/plugins/root-opt-in-creator.ts', import.meta.url),
      ),
    ],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    write: false,
    logLevel: 'silent',
  })
  const { rootOptInCommand } = await import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64')
  )
  console.log(JSON.stringify(await rootOptInCommand(process.argv.slice(2)), null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Plugin setup creation refused')
  process.exitCode = 1
}
