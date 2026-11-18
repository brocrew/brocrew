import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { buildSync } = await import(pathToFileURL(path.resolve('plugins/chrome/node_modules/esbuild/lib/main.js')).href)
const out = path.resolve(process.argv[2])
fs.mkdirSync(path.join(out, 'bin'), { recursive: true })
fs.copyFileSync('plugins/chrome/src/profiles/bin/chrome-process-birth.exe', path.join(out, 'bin/chrome-process-birth.exe'))
buildSync({ entryPoints: ['plugins/chrome/src/profiles/sharedLock.ts'], outfile: path.join(out, 'lock.mjs'), bundle: true, platform: 'node', format: 'esm' })
console.log(JSON.stringify({ source: 'actual pinned sharedLock.ts', bundle: path.join(out, 'lock.mjs') }))
