// Source-only controls, UNRUN. No runtime/SDK imports, process, app or network operation.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { authorizeReloadRequest } from './reload-authorize.mjs'
import { projectReload } from './reload-projection.mjs'
import { checkNormalPluginBuild } from '../../check-no-plugin-gate-inputs.mjs'
import { deliveryEvidence, assertBehavior } from './reload-source/contract.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const input = JSON.parse(fs.readFileSync(new URL('./reload-inputs.json', import.meta.url)))
test('actual embedded reload authorizer rejects other sender/frame/nonce/op/payload', () => {
  const frame = {},
    contents = { mainFrame: frame },
    window = { webContents: contents, isDestroyed: () => false }
  const event = { sender: contents, senderFrame: frame },
    token = 'a'.repeat(64)
  assert.deepEqual(authorizeReloadRequest(event, window, { op: 'arm', token }, token), {
    op: 'arm',
  })
  for (const [e, w, p, n] of [
    [{ ...event, sender: {} }, window, { op: 'arm', token }, token],
    [{ ...event, senderFrame: {} }, window, { op: 'arm', token }, token],
    [event, null, { op: 'arm', token }, token],
    [event, { ...window, isDestroyed: () => true }, { op: 'arm', token }, token],
    [event, window, { op: 'arm', token: 'b'.repeat(64) }, token],
    [event, window, { op: 'eval', token }, token],
    [event, window, { op: 'status', token, code: 'forbidden' }, token],
    [event, window, { op: 'arm', token }, null],
  ])
    assert.throws(() => authorizeReloadRequest(e, w, p, n), /plugin-reload-main-app-gate-only/)
})
test('real reload projection uses actual host/factory/preload and restores ordinary source', () => {
  const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-reload-projection-')),
    ),
    target = path.join(root, 'repo')
  try {
    for (const name of [
      'apps/desktop/src/main/index.ts',
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
    checkNormalPluginBuild(target)
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
    assert.ok(entry.includes('createReloadGateRuntime({ownedRoot:'))
    assert.ok(!entry.includes('fixtureSource:'))
    assert.ok(entry.includes('reload-native-db-closed.json'))
    assert.throws(() => checkNormalPluginBuild(target))
    projected.restore()
    checkNormalPluginBuild(target)
    for (const name of ['apps/desktop/out/main/index.js', 'apps/desktop/out/preload/index.js']) {
      const f = path.join(target, name)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, 'plugin-reload-main-app-gate-only __pluginReloadGate')
      assert.throws(() => checkNormalPluginBuild(target))
      fs.unlinkSync(f)
    }
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
    schema: 'brocrew.reload-behavior.v1',
    mode: 'controlled-queryFactory-and-child-witness',
    sourceSha: '8f1b63ef1d22a9c8603ab2da6be18b6e48a4dd3c',
    sourceTree: '17d79356fe29ec5b462185ca4828c7519bb7f1e7',
    sdkDeclaredVersion: '0.3.287',
    adapter: {
      timeoutMs: 10001,
      failedTerminals: 1,
      failedByApp: true,
      oldPushes: 0,
      oldReloads: 1,
      oldCloses: 1,
      oldReturns: 1,
      retiringAtTimeout: true,
      oldSendRefusals: 2,
      lateReloadReleased: true,
      lateResultAttempted: true,
      lateAddedTerminals: 0,
      retirementEnded: true,
      freshQueries: 1,
      freshResumeMatches: true,
      freshPushes: 1,
      freshReloads: 1,
      freshCompleted: 1,
    },
    hostQueue: {
      timeoutMs: 10001,
      failedTerminals: 1,
      failedByApp: true,
      oldPushes: 0,
      oldReloads: 1,
      oldCloses: 1,
      oldReturns: 1,
      failedAtTimeout: 1,
      queuedBeforeExit: 2,
      freshBeforeReturn: 0,
      freshBeforeExit: 0,
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
  for (const [key, bad] of [
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
    ['ledgerMessages', [...words].reverse()],
  ]) {
    assert.throws(() => assertBehavior({ ...value, hostQueue: { ...value.hostQueue, [key]: bad } }))
  }
})
