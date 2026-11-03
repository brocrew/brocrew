import fs from 'node:fs'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
const [home, shared, profile, barrier] = process.argv.slice(2)
fs.mkdirSync(home, { recursive: true })
const store = createSharedProfileStore({
  home,
  shared,
  workspaceId: profile,
  workspaceLabel: profile,
  chromeState: () => 'ended',
})
process.stdout.write('ready\n')
const end = Date.now() + 8000
while (!fs.existsSync(barrier)) {
  if (Date.now() > end) throw new Error('fictional barrier timeout')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
}
try {
  store.rename(profile, 'Garden')
  process.stdout.write('renamed\n')
} catch (error) {
  process.stdout.write('refused:' + (error as Error).message + '\n')
}
