#!/usr/bin/env node
/**
 * Render a design scene headlessly to a PNG with the real stylesheet and fixture data.
 *
 *   pnpm run look:capture -- <scene> <out.png> [--width 1200] [--height 800]
 *   pnpm run look:capture -- --list
 *
 * Scenes live in `apps/desktop/look/scenes/<scene>.look.ts` and use `vitest.look.config.ts`'s
 * own Chromium. No app, app port or data is touched. This is outside `test`, `test:dom` and `ci`.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const scenesDir = join(root, 'apps/desktop/look/scenes')
const scenes = readdirSync(scenesDir)
  .filter((name) => name.endsWith('.look.ts'))
  .map((name) => name.replace(/\.look\.ts$/, ''))
  .sort()

const args = process.argv.slice(2).filter((arg) => arg !== '--')
const usage = () => {
  console.log('usage: pnpm run look:capture -- <scene> <out.png> [--width 1200] [--height 800]')
  console.log(`scenes: ${scenes.join(', ')}`)
}
if (args.includes('--list')) {
  usage()
  process.exit(0)
}

const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  if (at === -1) return fallback
  const value = Number(args[at + 1])
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`--${name} needs a number of pixels`)
    process.exit(2)
  }
  args.splice(at, 2)
  return value
}
const width = flag('width', 1200)
const height = flag('height', 800)
const [scene, out] = args

if (!scene || !out) {
  usage()
  process.exit(2)
}
if (!scenes.includes(scene)) {
  console.error(`No scene named "${scene}". Scenes: ${scenes.join(', ')}`)
  process.exit(2)
}

const outPath = resolve(process.cwd(), out)
const run = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'vitest',
    'run',
    '--config',
    'apps/desktop/vitest.look.config.ts',
    `look/scenes/${scene}.look.ts`,
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      LOOK_OUT: outPath,
      LOOK_WIDTH: String(width),
      LOOK_HEIGHT: String(height),
    },
  },
)
if (run.status === 0) console.log(`saved ${outPath} (${width}×${height})`)
process.exit(run.status ?? 1)
