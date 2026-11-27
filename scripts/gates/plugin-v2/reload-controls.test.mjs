// Source-only controls, UNRUN. No runtime/SDK imports, process, app or network operation.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { authorizeReloadRequest } from './reload-authorize.mjs'
import { projectReload } from './reload-projection.mjs'
import {
  deliveryEvidence,
  assertBehavior,
  lifecycleEvidence,
  RELOAD_HELD_MS,
  RELOAD_JOURNEY_WAIT_MS,
} from './reload-source/contract.mjs'

test('reload lifecycle requires one initial launch and one ordered launch for every resume', () => {
  const observe = (types) => lifecycleEvidence(types.map((type) => ({ type })))
  assert.deepEqual(observe(['launched']), { starts: 1, resumes: 0 })
  assert.deepEqual(observe(['launched', 'turn', 'reopened', 'launched', 'user_turn']), {
    starts: 1,
    resumes: 1,
  })
  assert.deepEqual(observe(['launched', 'reopened', 'launched', 'reopened', 'launched']), {
    starts: 1,
    resumes: 2,
  })
  for (const types of [
    [],
    ['reopened'],
    ['reopened', 'launched'],
    ['launched', 'launched'],
    ['launched', 'reopened'],
    ['launched', 'launched', 'reopened'],
    ['launched', 'reopened', 'reopened'],
    ['launched', 'reopened', 'launched', 'launched'],
    ['launched', 'reopened', 'launched', 'reopened'],
  ])
    assert.throws(() => observe(types))
})

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const input = JSON.parse(fs.readFileSync(new URL('./reload-inputs.json', import.meta.url)))
test('reload observation follows the product: no reload clock, held past the removed limit', () => {
  const runtime = fs
    .readdirSync(path.join(repo, 'packages/runtime/src/claude'))
    .filter((leaf) => leaf.endsWith('.ts'))
    .map((leaf) => fs.readFileSync(path.join(repo, 'packages/runtime/src/claude', leaf), 'utf8'))
    .join('\n')
  // Card 197: the reload is awaited with no clock; only the CLI's exit or an answer ends it.
  assert.equal([...runtime.matchAll(/await this\.query\.reloadPlugins\(\)/g)].length, 1)
  assert.equal([...runtime.matchAll(/'reloadPlugins'/g)].length, 0)
  assert.ok(RELOAD_HELD_MS > 60_000)
  assert.equal(RELOAD_JOURNEY_WAIT_MS, RELOAD_HELD_MS + 20000)
  const journey = fs.readFileSync(new URL('./reload-journey.mjs', import.meta.url), 'utf8')
  assert.match(journey, /}, RELOAD_JOURNEY_WAIT_MS\)/)
  assert.match(journey, /control\('exitCli'\)/)
})

test('actual embedded reload authorizer runs only known gate operations', () => {
  const token = 'a'.repeat(64)
  assert.deepEqual(authorizeReloadRequest({ op: 'arm', token }), { op: 'arm' })
  for (const payload of [{ op: 'eval', token }, {}, null, 'arm'])
    assert.throws(() => authorizeReloadRequest(payload), /plugin-reload-main-app-gate-only/)
})
test('real reload projection uses actual host/factory/preload and restores ordinary source', () => {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-reload-projection-')),
    ),
    target = path.join(root, 'repo')
  try {
    for (const name of [
      'apps/desktop/src/main/index.ts',
      'apps/desktop/src/main/runtime-host-composition.ts',
      'apps/desktop/src/preload/index.ts',
      'apps/desktop/electron.vite.config.ts',
      'apps/desktop/src/main/plugins/catalogue/build-config.ts',
      'apps/desktop/src/main/plugins/catalogue/dev-source.ts',
    ]) {
      const to = path.join(target, name)
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.writeFileSync(to, fs.readFileSync(path.join(repo, name)), { flag: 'wx', mode: 0o600 })
    }
    fs.mkdirSync(path.join(target, 'scripts/gates'), { recursive: true, mode: 0o700 })
    const modules = input.modules.map((m) => ({
      ...m,
      source: fileURLToPath(new URL('./reload-source/' + m.name, import.meta.url)),
    }))
    assert.throws(() =>
      projectReload(target, {
        root,
        token: 'a'.repeat(64),
        appData: path.join(root, 'a'),
        browser: path.join(root, 'missing.exe'),
        modules: modules.slice(1),
      }),
    )
    const projected = projectReload(target, {
      root,
      token: 'a'.repeat(64),
      appData: path.join(root, 'a'),
      browser: path.join(root, 'missing.exe'),
      modules,
    })
    const entry = fs.readFileSync(path.join(target, 'apps/desktop/src/main/index.ts'), 'utf8')
    assert.ok(entry.includes('bindReloadGateHost(runtimeHost)'))
    assert.ok(entry.includes('reloadGateCommand(authorizeReloadRequest('))
    const composition = fs.readFileSync(
      path.join(target, 'apps/desktop/src/main/runtime-host-composition.ts'),
      'utf8',
    )
    assert.ok(composition.includes('createReloadGateRuntime({ownedRoot:'))
    assert.ok(!entry.includes('fixtureSource:'))
    assert.ok(entry.includes('reload-native-db-closed.json'))
    const start = entry.indexOf('    const reloadHeldDb=db;')
    const end = entry.indexOf('\n    db = null', start)
    assert.ok(start >= 0 && end > start)
    const closeProjected = new Function(
      'db',
      'closeDatabase',
      'reloadGateFs',
      'reloadGateToken',
      entry.slice(start, end) + '\n    db = null;\nreturn db;',
    )
    const held = {},
      events = []
    const files = { writeFileSync: () => events.push('marker') }
    const close = (actual) => {
      assert.equal(actual, held)
      events.push('closed')
    }
    assert.equal(closeProjected(held, close, files, 'a'.repeat(64)), null)
    assert.deepEqual(events, ['closed', 'marker'])
    events.length = 0
    assert.throws(() => closeProjected(null, close, files, 'a'.repeat(64)))
    assert.deepEqual(events, [])
    const failure = new Error('fictional checked close failed')
    assert.throws(
      () =>
        closeProjected(
          held,
          () => {
            throw failure
          },
          files,
          'a'.repeat(64),
        ),
      (error) => error === failure,
    )
    assert.deepEqual(events, [])
    projected.restore()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('reload delivery requires all messages exactly once in order across batching boundaries', () => {
  const words = ['reload original fern', 'reload queued birch', 'reload queued cedar']
  const observed = (groups) => ({
    pushes: groups.map((group) => ({
      message: { content: 'person frame\n' + group.join('\n\n') + '\napp frame' },
    })),
    turns: groups.map((group) => ({
      text: group.join('\n\n'),
      ...(group.length > 1 ? { parts: group.map((text) => ({ text })) } : {}),
    })),
  })
  for (const groups of [
    [words],
    [[words[0]], words.slice(1)],
    [words.slice(0, 2), [words[2]]],
    words.map((word) => [word]),
  ]) {
    const { pushes, turns } = observed(groups)
    assert.deepEqual(deliveryEvidence(pushes, turns), {
      deliveredMessages: words,
      ledgerMessages: words,
    })
  }
  for (const groups of [
    [words.slice(1)],
    [[...words, words[1]]],
    [[words[1], words[0], words[2]]],
  ]) {
    const { pushes, turns } = observed(groups)
    assert.throws(() => deliveryEvidence(pushes, turns))
  }
  const { pushes, turns } = observed([[words[0]], words.slice(1)])
  assert.throws(() =>
    deliveryEvidence([...pushes, { message: { content: 'extra delivery' } }], turns),
  )
  assert.throws(() => deliveryEvidence(pushes, [...turns, { text: words[2] }]))
  assert.throws(() => deliveryEvidence(pushes, observed([words.slice(0, 2), [words[2]]]).turns))
  assert.throws(() =>
    deliveryEvidence(pushes, [turns[0], { ...turns[1], text: 'wrong ledger text' }]),
  )
})

test('reload receipt binds actual prompt, UUID, reload and completed-turn counts without losing strict message evidence', () => {
  const words = ['reload original fern', 'reload queued birch', 'reload queued cedar']
  const value = {
    schema: 'brocrew.reload-behavior.v2',
    mode: 'controlled-queryFactory-and-child-witness',
    sourceSha: '8f1b63ef1d22a9c8603ab2da6be18b6e48a4dd3c',
    sourceTree: '17d79356fe29ec5b462185ca4828c7519bb7f1e7',
    sdkDeclaredVersion: '0.3.287',
    adapter: {
      heldMs: RELOAD_HELD_MS + 1,
      heldWithoutFailure: true,
      failedTerminals: 1,
      failedByApp: true,
      exitRejected: true,
      oldPushes: 0,
      oldReloads: 1,
      oldSendRefusals: 2,
      lateAddedTerminals: 0,
      exitObserved: true,
      freshQueries: 1,
      freshResumeMatches: true,
      freshPushes: 1,
      freshReloads: 1,
      freshCompleted: 1,
    },
    hostQueue: {
      heldMs: RELOAD_HELD_MS + 1,
      heldWithoutFailure: true,
      failedTerminals: 1,
      failedByApp: true,
      oldPushes: 0,
      oldReloads: 1,
      queuedWhileHeld: 2,
      freshBeforeReturn: 0,
      starts: 1,
      resumes: 1,
      freshQueries: 1,
      freshResumeMatches: true,
      freshReloads: 2,
      freshPushes: 2,
      uniqueUserUuids: 2,
      originalOnce: true,
      secondOnce: true,
      thirdOnce: true,
      ledgerUserTurns: 2,
      freshCompleted: 2,
      lateAddedPushes: 0,
      lateAddedTerminals: 0,
      deliveredMessages: words,
      ledgerMessages: words,
    },
    cleanup: {
      handles: 4,
      endedHandles: 4,
      queries: 4,
      closedQueries: 4,
      returnedQueries: 4,
      settledReturns: 4,
      drainedPromptReaders: 4,
      exitedChildren: 4,
      closedPipes: 12,
      registeredHandles: 0,
      allHandlesClosed: true,
      controlledChildrenExited: true,
      databaseClosed: true,
    },
  }
  assert.equal(assertBehavior(value), value)
  // A reload that ended before the removed limit had passed proves nothing about the clock.
  for (const heldMs of [10001, RELOAD_HELD_MS - 1]) {
    assert.throws(() => assertBehavior({ ...value, adapter: { ...value.adapter, heldMs } }))
    assert.throws(() => assertBehavior({ ...value, hostQueue: { ...value.hostQueue, heldMs } }))
  }
  for (const key of ['heldWithoutFailure', 'exitRejected', 'exitObserved'])
    assert.throws(() => assertBehavior({ ...value, adapter: { ...value.adapter, [key]: false } }))

  for (const [key, bad] of [
    ['starts', 0],
    ['starts', 2],
    ['resumes', 0],
    ['resumes', 2],
    ['queuedWhileHeld', 1],
    ['freshBeforeReturn', 1],
    ['freshCompleted', 1],
    ['freshCompleted', 3],
    ['uniqueUserUuids', 1],
    ['freshReloads', 3],
    ['ledgerUserTurns', 3],
    ['freshPushes', 0],
    ['lateAddedPushes', 1],
    ['lateAddedTerminals', 1],
    ['deliveredMessages', words.slice(1)],
    ['deliveredMessages', [...words, words[0]]],
    ['deliveredMessages', [words[1], words[2], words[0]]],
    ['ledgerMessages', [...words].reverse()],
  ]) {
    assert.throws(() => assertBehavior({ ...value, hostQueue: { ...value.hostQueue, [key]: bad } }))
  }
})
