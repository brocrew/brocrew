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
