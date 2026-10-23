// Explicit offline setup only. Compilation stays in memory, including preview mode.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

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
  const output = await rootOptInCommand(process.argv.slice(2))
  if (typeof output === 'string') console.log(output)
  else
    console.log(
      JSON.stringify(
        {
          ...output,
          toolSourceSha256: createHash('sha256')
            .update(result.outputFiles[0].contents)
            .digest('hex'),
        },
        null,
        2,
      ),
    )
} catch (error) {
  const reason = error instanceof Error ? error.message : 'Plugin setup creation refused'
  console.error(reason.replace(/\s*\r?\n\s*/g, ' '))
  process.exitCode = 1
}
