// Spawned only by shared-races.test.ts, with explicitly fictional roots.
import fs from 'node:fs'
import path from 'node:path'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
import { identity } from '../src/profiles/sharedLock.js'
const [command, home, shared, id, barrier, boundary] = process.argv.slice(2)
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
if (command === 'lock-crash') {
  const owner = identity()
  fs.mkdirSync(
    path.join(
      shared,
      'registry.lock',
      `${owner.pid}.${Buffer.from(owner.birth).toString('base64url')}.11111111-1111-4111-8111-111111111111`,
    ),
  )
  process.exit(42)
}
fs.mkdirSync(home, { recursive: true })
const store = createSharedProfileStore({
  home,
  shared,
  workspaceId: id,
  workspaceLabel: id,
  chromeState: () => 'ended',
  migrationApproved: command === 'crash',
  checkpoint: (phase) => {
    if (phase === boundary) process.exit(42)
  },
})
fs.writeFileSync(`${barrier}.${id}.${process.pid}.ready`, '')
fs.writeFileSync(`${barrier}.${id}.ready`, '')
while (!fs.existsSync(`${barrier}.go`)) pause()
try {
  if (command === 'lease') {
    const lease = store.shared.acquire('fern')
    fs.writeFileSync(`${barrier}.${id}.result`, 'acquired')
    process.stdout.write('acquired\n')
    while (!fs.existsSync(`${barrier}.release`)) pause()
    lease.release()
  } else if (command === 'delete') {
    store.shared.remove('fern', store.shared.confirmation('fern'))
    process.stdout.write('deleted\n')
  } else if (command === 'migrate') {
    // Start migration simultaneously, after both process owners are alive.
    createSharedProfileStore({
      home,
      shared,
      workspaceId: id,
      workspaceLabel: id,
      chromeState: () => 'ended',
      migrationApproved: true,
    })
    process.stdout.write('migrated\n')
  } else if (command === 'flags') {
    for (let i = 0; i < 5; i++) store.setFlags('fern', { enabled: true, keepRunning: true })
    process.stdout.write('updated\n')
  }
} catch (e) {
  fs.writeFileSync(`${barrier}.${id}.result`, 'refused')
  process.stdout.write(`refused:${e instanceof Error ? e.message : 'unknown'}\n`)
}
