#!/usr/bin/env node
import { registerHooks } from 'node:module'
import { isAbsolute, join } from 'node:path'

const args = process.argv.slice(2)
if (
  args[0] !== '--app-data' ||
  !args[1] ||
  !isAbsolute(args[1]) ||
  args.length > 3 ||
  (args[2] !== undefined && args[2] !== '--require-policy')
) {
  console.error(
    'Usage: node scripts/check-workspace-routing.mjs --app-data <absolute folder> [--require-policy]',
  )
  process.exitCode = 2
} else {
  // Node strips TypeScript; these source modules use the bundler's extensionless imports.
  const source = new URL('../apps/desktop/src/main/', import.meta.url).href
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        context.parentURL?.startsWith(source) &&
        /^\.\/(workspace-routing-store|same-folder)$/.test(specifier)
      )
        return nextResolve(`${specifier}.ts`, context)
      return nextResolve(specifier, context)
    },
  })
  try {
    const { workspaceRouting, workspaceLaunchMessage } =
      await import('../apps/desktop/src/main/workspace-routing.ts')
    for (const packaged of [true, false]) {
      const mode = packaged ? 'packaged' : 'development'
      try {
        const routing = workspaceRouting(args[1], packaged, args[2] === '--require-policy', {
          readOnly: true,
        })
        const first = packaged ? routing.first : join(args[1], '@brobot2', 'desktop')
        console.log(`${mode}: first workspace: ${first ?? join(args[1], '@brobot2', 'desktop')}`)
        if (routing.diagnostics.length) process.exitCode = 1
        if (first && routing.refusal(first)) {
          console.error(`${mode}: first workspace is reserved: ${first}`)
          process.exitCode = 1
        }
      } catch (error) {
        console.error(`${mode}: ${workspaceLaunchMessage(error)}`)
        process.exitCode = 1
      }
    }
  } finally {
    hooks.deregister()
  }
}
