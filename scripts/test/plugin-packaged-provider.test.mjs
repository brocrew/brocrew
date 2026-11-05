import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '../../apps/desktop/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '../../apps/desktop/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'
import { createRepoAwarePluginVerifier } from '../../apps/desktop/src/main/plugins/package-verifier.ts'
import { preparePluginNodeRuntime } from '../../apps/desktop/src/main/plugins/node-runtime.ts'
import { createPluginNodeHost } from '../../apps/desktop/src/main/plugins/node-host.ts'
import { createLifecycleAgentBridge } from '../../apps/desktop/src/main/plugins/lifecycle/agent-bridge.ts'
import { WorkspacePluginAttachments } from '../../apps/desktop/src/main/plugins/attachments.ts'
import {
  PackagedGateRuntime,
  openPrompt,
  closePrompt,
  scriptedHandle,
  brokerClient,
  preparePackagedGateHome,
  withFixtureBrowser,
  closeFixtureResources,
} from '../gates/plugin-packaged/provider-fixture.mjs'
import {
  serveFixture,
  browserEvidence,
  observeTabs,
  waitTabs,
  safeTabs,
  createProviderTurn,
  providerErrorCategory,
} from '../gates/plugin-packaged/browser-journey.mjs'
import {
  providerState,
  safeProviderState,
  printProviderState,
  providerStateFrames,
  providerSteps,
} from '../gates/plugin-packaged/provider-state.mjs'
import { safeReport } from '../gates/plugin-packaged/contract.mjs'
import { withManagedPluginAttachments } from '../../packages/runtime/src/managed-plugin-session.ts'
import { fixtureTitle, fixtureText } from '../gates/plugin-packaged/fake-browser.mjs'
const definitions = (tools) =>
  tools.map((tool) => ({ ...tool })).sort((a, b) => a.name.localeCompare(b.name))
// Author documentation retains templates; this fixture's host supplies these private folders.
const expectedChromeRuntimeInventory = (authorInventory, pluginDataRoot) =>
  authorInventory.map((tool) =>
    typeof tool.description === 'string'
      ? {
          ...tool,
          description: tool.description
            .replace('{downloads}', () => path.join(pluginDataRoot, 'downloads'))
            .replace('{roots}', () => path.join(pluginDataRoot, 'files')),
        }
      : { ...tool },
  )
const cleanup = [],
  roots = []
const protocolInstalled = fs.existsSync(
  new URL('../../plugins/chrome/node_modules/playwright-core/package.json', import.meta.url),
)
afterEach(async () => {
  await closeFixtureResources(cleanup.splice(0), roots.splice(0))
})
function scratch() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fern-provider-')))
  roots.push(root)
  return root
}
describe.skipIf(process.platform === 'win32')(
  'a scripted provider using the installed Chrome tool protocol',
  () => {
    it('sends exact named-profile arguments through the scripted open, read and close sequence', async () => {
      const root = scratch(),
        url = 'http://127.0.0.1:1234/fern',
        calls = [],
        sent = []
      fs.writeFileSync(path.join(root, 'browser-fixture.json'), JSON.stringify({ url }))
      const handle = scriptedHandle(
        {
          send: async (text) => {
            sent.push(text)
          },
        },
        {},
        root,
        async () => ({
          close: async () => {},
          callTool: async (input) => {
            calls.push(input)
            const expected = [
              { name: 'open_tab', arguments: { profile: 'fern', url } },
              {
                name: 'snapshot',
                arguments: { profile: 'fern', tabId: 't1', mode: 'text', timeoutMs: 5000 },
              },
              { name: 'close_tab', arguments: { profile: 'fern', tabId: 't1' } },
            ][calls.length - 1]
            expect(input).toEqual(expected)
            return {
              content: [
                {
                  type: 'text',
                  text:
                    input.name === 'open_tab'
                      ? JSON.stringify({ tabId: 't1', url, title: fixtureTitle })
                      : input.name === 'snapshot'
                        ? `title: ${fixtureTitle}\n${fixtureText}`
                        : '{"ok":true}',
                },
              ],
            }
          },
        }),
      )
      await handle.send(openPrompt)
      await handle.send(`${closePrompt}\n\n${openPrompt}`)
      expect(calls).toHaveLength(3)
      expect(sent).toEqual([`Chrome title: ${fixtureTitle}`, 'Chrome fixture tab closed.'])
    })
    it('credits a returned isError as a broker response, never a successful action or title', async () => {
      const root = scratch()
      fs.writeFileSync(
        path.join(root, 'browser-fixture.json'),
        '{"url":"http://127.0.0.1:1234/fern"}',
      )
      let sent = false
      const handle = scriptedHandle(
        {
          send: async () => {
            sent = true
          },
        },
        {},
        root,
        async () => ({
          close: async () => {},
          callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'refused' }] }),
        }),
      )
      await expect(handle.send(openPrompt)).rejects.toThrow()
      expect(browserEvidence(root, fs.readFileSync)).toMatchObject({
        toolCalled: true,
        calls: 0,
        titleReturned: false,
      })
      expect(sent).toBe(false)
    })
    it('compares every definition including unexercised tools, descriptions and full schemas', () => {
      const inventory = [
        {
          name: 'open_tab',
          description: 'Open',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: false },
        },
        {
          name: 'unexercised',
          description: 'Discover',
          inputSchema: {
            type: 'object',
            properties: { profile: { type: 'string' } },
            required: ['profile'],
          },
        },
      ]
      expect(definitions(inventory.toReversed())).toEqual(definitions(inventory))
      for (const changed of [
        inventory.slice(0, 1),
        [...inventory, { name: 'extra', inputSchema: {} }],
        inventory.map((tool) =>
          tool.name === 'unexercised' ? { ...tool, description: 'changed' } : tool,
        ),
        inventory.map((tool) =>
          tool.name === 'unexercised' ? { ...tool, inputSchema: { type: 'object' } } : tool,
        ),
        inventory.map((tool) =>
          tool.name === 'open_tab' ? { ...tool, annotations: { readOnlyHint: true } } : tool,
        ),
      ])
        expect(definitions(changed)).not.toEqual(definitions(inventory))

      const authorInventory = [
        {
          name: 'unexercised',
          description: 'Save {downloads}; files {roots}; repeated {downloads} {roots}.',
          inputSchema: {
            type: 'object',
            properties: { file: { type: 'string', description: '{roots}' } },
          },
          annotations: { readOnlyHint: false },
          metadata: { template: '{downloads}' },
        },
        { name: 'without_description', inputSchema: {} },
        { name: 'nonstring_description', description: null, inputSchema: {} },
      ]
      const originalAuthorInventory = structuredClone(authorInventory)
      const expected = [
        {
          name: 'unexercised',
          description:
            'Save /fictional/$&/downloads; files /fictional/$&/files; repeated {downloads} {roots}.',
          inputSchema: {
            type: 'object',
            properties: { file: { type: 'string', description: '{roots}' } },
          },
          annotations: { readOnlyHint: false },
          metadata: { template: '{downloads}' },
        },
        { name: 'without_description', inputSchema: {} },
        { name: 'nonstring_description', description: null, inputSchema: {} },
      ]
      expect(expectedChromeRuntimeInventory(authorInventory, '/fictional/$&')).toEqual(expected)
      expect(authorInventory).toEqual(originalAuthorInventory)
      for (const description of [
        authorInventory[0].description,
        'Save {downloads}; files /fictional/$&/files; repeated {downloads} {roots}.',
        'Save /fictional/$&/downloads; files {roots}; repeated {downloads} {roots}.',
        'Save /fictional/wrong/downloads; files /fictional/$&/files; repeated {downloads} {roots}.',
        'Save /fictional/$&/downloads; files /fictional/wrong/files; repeated {downloads} {roots}.',
        'Changed /fictional/$&/downloads; files /fictional/$&/files; repeated {downloads} {roots}.',
      ])
        expect(definitions([{ ...expected[0], description }, ...expected.slice(1)])).not.toEqual(
          definitions(expected),
        )
      for (const changed of [
        expected.slice(1),
        [...expected, { name: 'extra', inputSchema: {} }],
        [{ ...expected[0], name: 'renamed' }, ...expected.slice(1)],
        [{ ...expected[0], inputSchema: { type: 'object' } }, ...expected.slice(1)],
        [{ ...expected[0], annotations: { readOnlyHint: true } }, ...expected.slice(1)],
        [{ ...expected[0], metadata: { template: '/fictional/$&/downloads' } }, ...expected.slice(1)],
      ])
        expect(definitions(changed)).not.toEqual(definitions(expected))
    })
    it('restores the browser environment value or absence after successful or rejected setup', async () => {
      const key = 'BROCREW_CHROME_EXECUTABLE',
        before = process.env[key]
      const had = Object.hasOwn(process.env, key)
      try {
        for (const previous of [undefined, '/fictional/previous'])
          for (const reject of [false, true]) {
            if (previous === undefined) delete process.env[key]
            else process.env[key] = previous
            const work = withFixtureBrowser('/fictional/owned-wrapper', async () => {
              await Promise.resolve()
              expect(process.env[key]).toBe('/fictional/owned-wrapper')
              if (reject) throw new Error('fictional setup failure')
              return true
            })
            if (reject) await expect(work).rejects.toThrow('fictional setup failure')
            else expect(await work).toBe(true)
            expect(Object.hasOwn(process.env, key)).toBe(previous !== undefined)
            expect(process.env[key]).toBe(previous)
          }
      } finally {
        if (had) process.env[key] = before
        else delete process.env[key]
      }
    })
    it('closes provider, attachments, bridge and host before deleting scratch, retaining it on unknown exit', async () => {
      for (const exit of [true, false]) {
        const order = []
        const closers = ['host', 'bridge', 'attachments', 'provider'].map((name) => async () => {
          order.push(name)
          if (name === 'host' && !exit) throw new Error('Physical exit unproven')
        })
        const work = closeFixtureResources(closers, ['/fictional/owned'], () =>
          order.push('remove'),
        )
        if (exit) {
          await work
          expect(order).toEqual(['provider', 'attachments', 'bridge', 'host', 'remove'])
        } else {
          await expect(work).rejects.toThrow('Fixture cleanup incomplete')
          expect(order).toEqual(['provider', 'attachments', 'bridge', 'host'])
        }
      }
    })
    it.each(providerSteps)(
      'reports the first missing %s witness, without paths or arbitrary fields',
      (step) => {
        const proof = {
          homePrepared: true,
          agentStarted: true,
          turnSent: true,
          routeReady: true,
          toolCalled: true,
          navigations: 1,
          toolRead: true,
          titleReturned: true,
        }
        const turn = { started: true, returned: true }
        const keys = [
          'agentStarted',
          'turnSent',
          'routeReady',
          'toolCalled',
          'navigations',
          'titleReturned',
        ]
        proof[keys[providerSteps.indexOf(step)]] = false
        const record = providerState(proof, turn, 'route-absent')
        expect(record).toEqual({ phase: 'provider-action', step, errorCategory: 'route-absent' })
        const lines = [],
          frames = []
        printProviderState(record, (line) => lines.push(line))
        const receive = providerStateFrames((value) => frames.push(value))
        receive(Buffer.from(lines[0].slice(0, 18)))
        receive(Buffer.from(lines[0].slice(18) + '\n'))
        for (const bad of [
          { ...record, path: '/fictional TOKEN=madeup' },
          { ...record, step: 'HOME=/fictional' },
          { ...record, errorCategory: 'argv=private' },
        ]) {
          expect(safeProviderState(bad)).toBe(false)
          expect(safeReport({ providerState: bad })).toBe(false)
          receive(Buffer.from('gate-provider-state ' + JSON.stringify(bad) + '\n'))
        }
        expect(frames).toEqual([record])
        expect(safeReport({ providerState: record })).toBe(true)
        expect(lines.join('')).not.toMatch(/fictional|TOKEN|HOME|argv|private/)
      },
    )
    it('does not credit a tool attempt or an unobserved transcript as a completed hop', async () => {
      const root = scratch()
      fs.writeFileSync(
        path.join(root, 'browser-fixture.json'),
        JSON.stringify({ url: 'http://127.0.0.1:1234/fern' }),
      )
      const handle = scriptedHandle({ send: async () => {} }, {}, root, async () => ({
        close: async () => {},
        callTool: async () => {
          throw new Error('HOME=/fictional TOKEN=madeup')
        },
      }))
      await expect(handle.send(openPrompt)).rejects.toThrow()
      const proof = browserEvidence(root, fs.readFileSync)
      expect(proof).toMatchObject({
        agentStarted: true,
        turnSent: true,
        routeReady: true,
        toolCalled: false,
      })
      expect(providerState({ ...proof, homePrepared: true }, { started: true }).step).toBe(
        'tool-called',
      )
      expect(
        providerState(
          {
            ...proof,
            homePrepared: true,
            toolCalled: true,
            navigations: 1,
            toolRead: true,
            titleReturned: true,
          },
          { started: true, returned: false },
        ).step,
      ).toBe('result-returned')
      expect(providerErrorCategory(root, fs.readFileSync)).toBe('tool')
    })
    it('persists a missing route before the IPC rejection can hide its origin', async () => {
      const root = scratch()
      const handle = scriptedHandle({ send: async () => {} }, {}, root)
      await expect(handle.send(openPrompt)).rejects.toThrow('Fixture provider refused')
      const proof = browserEvidence(root, fs.readFileSync)
      expect(providerErrorCategory(root, fs.readFileSync)).toBe('route-absent')
      expect(proof).toMatchObject({
        agentStarted: true,
        turnSent: true,
        routeReady: false,
        toolCalled: false,
      })
      expect(
        providerState(
          { ...proof, homePrepared: true },
          { started: true },
          providerErrorCategory(root, fs.readFileSync),
        ),
      ).toEqual({ phase: 'provider-action', step: 'mcp-attached', errorCategory: 'route-absent' })
      fs.writeFileSync(
        path.join(root, 'provider-proof.json'),
        JSON.stringify({ errorCategory: 'HOME=/fictional TOKEN=madeup' }),
      )
      expect(providerErrorCategory(root, fs.readFileSync)).toBe('other')
      fs.unlinkSync(path.join(root, 'provider-proof.json'))
      expect(providerErrorCategory(root, fs.readFileSync)).toBe('other')
    })
    it.each(['send', 'history', 'timeout'])(
      'keeps the closed hop when %s fails at the window door',
      async (kind) => {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
        const runtime = {
          createSession: async () => ({ sessionId: 'fern-session' }),
          send: async () => {
            if (kind === 'send') throw new Error('HOME=/fictional TOKEN=madeup')
          },
          latestHistory: async () => {
            throw new Error('HOME=/fictional TOKEN=madeup')
          },
        }
        const turn = await createProviderTurn(
          { cdp: { evaluate: (body) => new AsyncFunction('window', body)({ api: { runtime } }) } },
          '/fictional/fern',
          {
            wait: async (test) => {
              if (kind === 'timeout') throw new Error('Packaged gate timed out')
              await test()
            },
          },
        )
        await expect(turn.turn(openPrompt, 'unearned')).rejects.toThrow()
        const record = providerState(
          {
            homePrepared: true,
            agentStarted: true,
            turnSent: kind !== 'send',
            routeReady: true,
            toolCalled: true,
            navigations: 1,
            toolRead: true,
            titleReturned: true,
          },
          turn.progress,
          turn.progress.errorCategory,
        )
        expect(record).toEqual({
          phase: 'provider-action',
          step: kind === 'send' ? 'turn-sent' : 'result-returned',
          errorCategory: kind === 'timeout' ? 'timeout' : 'bridge',
        })
        expect(JSON.stringify(record)).not.toMatch(/fictional|HOME|TOKEN/)
      },
    )
    it('uses the window runtime door and requires the earned assistant response, with a bounded unresponsive bridge', async () => {
      const calls = [],
        AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
      const runtime = {
        createSession: async (input) => {
          calls.push(input)
          return { sessionId: 'fern-session' }
        },
        send: async (input) => {
          calls.push(input)
        },
        latestHistory: async (input) => {
          calls.push(input)
          return { entries: [{ event: { type: 'assistant_message', text: 'echo: earned title' } }] }
        },
        close: async (input) => {
          calls.push(input)
        },
      }
      const run = {
        cdp: { evaluate: (body) => new AsyncFunction('window', body)({ api: { runtime } }) },
      }
      const turn = await createProviderTurn(run, '/fictional/fern', {
        wait: async (test) => expect(await test()).toBe(true),
      })
      await turn.turn('fixture request', 'earned title')
      await turn.close()
      expect(calls).toEqual([
        {
          provider: 'claude',
          approvalMode: 'auto',
          model: 'fake-claude-a',
          cwd: '/fictional/fern',
        },
        { sessionId: 'fern-session', text: 'fixture request' },
        { sessionId: 'fern-session' },
        { sessionId: 'fern-session' },
      ])
      await expect(
        createProviderTurn({ cdp: { evaluate: () => new Promise(() => {}) } }, '/fictional/fern', {
          deadline: 1,
        }),
      ).rejects.toThrow('Owned process deadline')
    })
    it('creates only an empty private managed home under owned scratch, without sign-in or renewal', () => {
      const root = scratch(),
        userData = path.join(root, 'workspace')
      const home = preparePackagedGateHome(root, userData, 'claude', 'fern')
      expect(home.startsWith(userData + path.sep)).toBe(true)
      expect(fs.readdirSync(home)).toEqual([])
      expect(fs.statSync(home).mode & 0o777).toBe(0o700)
      expect(preparePackagedGateHome(root, userData, 'claude', 'fern')).toBe(home)
      expect(fs.readdirSync(home)).toEqual([])
      const outside = scratch()
      expect(() => preparePackagedGateHome(root, outside, 'claude', 'fern')).toThrow()
      expect(() => preparePackagedGateHome(root, userData, '../outside', 'fern')).toThrow()
      fs.symlinkSync(outside, path.join(root, 'linked'))
      expect(() =>
        preparePackagedGateHome(root, path.join(root, 'linked'), 'claude', 'fern'),
      ).toThrow()
      expect(fs.readdirSync(outside)).toEqual([])
    })
    it.skipIf(!protocolInstalled)(
      'delivers the built Chrome package full inventory through the retained client and generic agent bridge before its provider turn',
      async () => {
        const { buildChromePackage } = await import('../../plugins/chrome/build.mjs')
        const root = scratch(),
          source = await serveFixture(root)
        cleanup.push(() => source.close())
        const executable = path.join(root, 'browser')
        fs.writeFileSync(
          executable,
          `#!${process.execPath}\nimport {runBrowser} from ${JSON.stringify(new URL('../gates/plugin-packaged/fake-browser.mjs', import.meta.url).href)};runBrowser(${JSON.stringify(root)});`,
          { mode: 0o700 },
        )
        const built = path.join(root, 'built')
        const commit = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], {
          cwd: fileURLToPath(new URL('../..', import.meta.url)),
          encoding: 'utf8',
        }).trim()
        const release = await buildChromePackage(built, commit)
        const catalogue = Buffer.from(JSON.stringify({ format: 3, entries: [release] }))
        const verified = createRepoAwarePluginVerifier({
          pinnedPublicKey: null,
          repoCatalogueSha256: createHash('sha256').update(catalogue).digest('hex'),
          target: { os: process.platform, cpu: process.arch },
        })
          .verifyCatalogue(catalogue, new Uint8Array())
          .verifyPackage(
            release.id,
            release.version,
            fs.readFileSync(path.join(built, 'chrome.tar')),
          )
        const nodeRuntime = await preparePluginNodeRuntime({
          resourcesRoot: fileURLToPath(new URL('../../apps/desktop/resources', import.meta.url)),
          durableRoot: path.join(root, 'runtime'),
        })
        const host = createPluginNodeHost({
          root: path.join(root, 'host'),
          runtime: nodeRuntime,
        })
        let running
        cleanup.push(async () => {
          // Scratch roots must survive if the owned plugin processes did not settle.
          expect(await host.stop()).toEqual({ exited: true })
          if (running) {
            let timer
            try {
              expect(
                await Promise.race([
                  running.exited,
                  new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error('Physical exit unproven')), 15000)
                  }),
                ]),
              ).toEqual({ exited: true })
            } finally {
              clearTimeout(timer)
            }
          }
        })
        const connection = await withFixtureBrowser(executable, async () => {
          running = await host.start({ package: verified, releaseDigest: release.archive.sha256 })
          return running.ready()
        })
        expect(verified.manifest.format).toBe(3)
        expect(connection.client).toBeInstanceOf(Client)
        expect(Object.getOwnPropertyDescriptor(connection, 'client').enumerable).toBe(false)
        expect(connection.admin).toBeUndefined()
        expect(() => connection.mcp()).toThrow()
        const forwarded = [],
          actualCall = connection.client.callTool.bind(connection.client)
        connection.client.callTool = (input, ...rest) => {
          forwarded.push(structuredClone(input))
          return actualCall(input, ...rest)
        }
        const inventoryAt = async (endpoint) => {
          const client = new Client({ name: 'fictional-fern-inventory', version: '1' })
          client.onerror = () => {}
          try {
            await client.connect(
              new StreamableHTTPClientTransport(new URL(endpoint.url), {
                requestInit: { headers: endpoint.headers, redirect: 'error' },
                fetch: (url, init) =>
                  fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(1500) }),
              }),
            )
            const inventory = await client.listTools(undefined, { timeout: 1500 })
            expect(inventory.nextCursor).toBeUndefined()
            return inventory.tools
          } finally {
            await client.close()
          }
        }
        const pluginDataRoot = path.join(root, 'host', 'data', verified.manifest.id)
        const authorInventory = JSON.parse(
          Buffer.from(verified.readFile(verified.manifest.tools.inventory)).toString('utf8'),
        )
        expect(Array.isArray(authorInventory)).toBe(true)
        const expectedInventory = expectedChromeRuntimeInventory(authorInventory, pluginDataRoot)
        // The runner owns this client. Route inventory clients below own only their own sessions.
        const inventory = await connection.client.listTools(undefined, { timeout: 1500 })
        expect(inventory.nextCursor).toBeUndefined()
        const advertised = inventory.tools
        expect(advertised.length).toBeGreaterThan(0)
        expect(definitions(advertised)).toEqual(definitions(expectedInventory))
        let live = true,
          enabled = true
        const installation = {
          pluginId: release.id,
          installId: 'fern-install',
          incarnation: randomUUID(),
          configRevision: 1,
        }
        const captured = {
          pluginId: installation.pluginId,
          installId: installation.installId,
          incarnation: installation.incarnation,
          runId: running.runId,
        }
        const exited = running.exited.then(
          (result) => {
            live = false
            if (result.exited !== true) throw new Error('Physical exit unproven')
          },
          (error) => {
            live = false
            throw error
          },
        )
        void exited.catch(() => {})
        const view = {
          installation,
          package: verified,
          workspaceId: 'fern-workspace',
          runId: running.runId,
          exited,
          current: () =>
            live &&
            enabled &&
            installation.pluginId === captured.pluginId &&
            installation.installId === captured.installId &&
            installation.incarnation === captured.incarnation &&
            running.runId === captured.runId,
          connection: Promise.resolve(connection),
        }
        // Only lease/lifecycle admission is inert; inventory, binding, policy and transport are real.
        const lease = {
          id: randomUUID(),
          workspace: 'a'.repeat(64),
          generation: randomUUID(),
          epoch: randomUUID(),
          counter: 0,
          renewedAt: 0,
          minor: 0,
          features: [],
        }
        const bridge = createLifecycleAgentBridge({
          owner: { valid: (id, epoch) => id === lease.id && epoch === lease.epoch },
          controller: {
            attach: async () => Object.freeze({}),
            detach: async () => {},
            agentAttachments: (workspaceId) =>
              workspaceId === view.workspaceId && view.current() ? [view] : [],
            agentScope: (workspaceId) => ({
              workspaceId,
              revision: 0,
              entries:
                workspaceId === view.workspaceId && view.current()
                  ? [
                      {
                        pluginId: release.id,
                        enabled: true,
                        installId: 'fern-install',
                        runId: running.runId,
                        switchRevision: 0,
                        is: 'admitted',
                        view,
                      },
                    ]
                  : [],
            }),
            onHostChanged: () => () => {},
          },
        })
        cleanup.push(() => bridge.close())
        const scope = {
          workspaceId: view.workspaceId,
          pluginId: release.id,
          instanceId: running.runId,
        }
        const jsonResult = (result) => {
          expect(result.isError).not.toBe(true)
          expect(result.content).toHaveLength(1)
          expect(result.content[0].type).toBe('text')
          return JSON.parse(result.content[0].text)
        }
        const call = (name, args, origin = 'settings.page') =>
          bridge.callTool({
            ...scope,
            requestId: randomUUID(),
            origin,
            name,
            arguments: args,
          })
        for (const args of [
          { profile: 'fern', action: 'create-profile' },
          { profile: 'fern', action: 'set-enabled', enabled: true },
          { profile: 'birch', action: 'create-profile' },
        ])
          expect(jsonResult(await call('configure_profile', args))).toEqual({
            profile: args.profile,
            completed: true,
          })
        expect(forwarded.slice(0, 3).map((input) => input.arguments)).toEqual([
          { profile: 'fern', action: 'create-profile' },
          { profile: 'fern', action: 'set-enabled', enabled: true },
          { profile: 'birch', action: 'create-profile' },
        ])
        for (const input of forwarded.slice(0, 3)) {
          expect(input.name).toBe('configure_profile')
          expect(input._meta).toEqual({
            workspaceId: 'fern-workspace',
            requestId: expect.any(String),
            origin: 'settings.page',
          })
          expect(input.arguments).not.toHaveProperty('workspaceId')
          expect(input.arguments).not.toHaveProperty('requestId')
          expect(input.arguments).not.toHaveProperty('origin')
        }
        expect(new Set(forwarded.slice(0, 3).map((input) => input._meta.requestId)).size).toBe(3)
        const configured = jsonResult(await call('configuration_snapshot', {}))
        expect(configured.profiles.find((one) => one.name === 'fern').enabled).toBe(true)
        expect(configured.profiles.find((one) => one.name === 'birch').enabled).toBe(false)
        for (const args of [
          { action: 'set-enabled', enabled: false },
          { profile: '../fern', action: 'set-enabled', enabled: false },
          {
            profile: 'fern',
            action: 'set-enabled',
            enabled: false,
            _meta: { origin: 'settings.page' },
          },
        ])
          expect((await call('configure_profile', args)).isError).toBe(true)
        expect(
          (
            await call(
              'configure_profile',
              { profile: 'fern', action: 'set-enabled', enabled: false },
              'agent',
            )
          ).isError,
        ).toBe(true)
        expect(jsonResult(await call('configuration_snapshot', {}))).toEqual(configured)
        for (const other of [
          { workspaceId: 'other-workspace' },
          { pluginId: 'other-plugin' },
          { instanceId: randomUUID() },
        ])
          await expect(
            bridge.callTool({
              ...scope,
              ...other,
              requestId: randomUUID(),
              origin: 'settings.page',
              name: 'configure_profile',
              arguments: { profile: 'fern', action: 'set-enabled', enabled: false },
            }),
          ).rejects.toMatchObject({ code: 'disabled' })
        expect(jsonResult(await call('configuration_snapshot', {}))).toEqual(configured)
        let attachmentReads = 0
        const attachments = new WorkspacePluginAttachments(
          {
            agentRoutes: async (request) => {
              attachmentReads++
              return {
                format: 1,
                value: await bridge.routes(lease, {
                  ...request,
                  kind: 'agent-routes',
                  workspace: lease.workspace,
                  generation: lease.generation,
                  lease: 'b'.repeat(64),
                  release: request.release === true,
                }),
              }
            },
          },
          'fern-workspace',
        ).agent(['brobot'])
        cleanup.push(() => attachments.close())
        const attached = await attachments.read()
        expect(
          attached.servers.length,
          'The complete built inventory must admit an agent route',
        ).toBeGreaterThan(0)
        expect(attached.servers).toHaveLength(1)
        const route = attached.servers[0]
        const delivered = await inventoryAt({
          url: route.url,
          headers: { Authorization: `Bearer ${route.capability}` },
        })
        // Compare the full advertised definitions, without a tool-name allowlist or count pin.
        const projectedDefinitions = (tools) =>
          tools
            .map(({ name, inputSchema, description }) => ({
              name,
              inputSchema,
              description,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        expect(projectedDefinitions(delivered)).toEqual(projectedDefinitions(advertised))
        expect(definitions(delivered)).toEqual(definitions(advertised))
        expect(definitions(delivered)).toEqual(definitions(expectedInventory))
        const runtime = withManagedPluginAttachments(
          new PackagedGateRuntime('claude', root),
          attachments,
        )
        const handle = await runtime.start({
          cwd: root,
          providerHome: path.join(root, 'fake-home'),
          approvalMode: 'auto',
        })
        const events = []
        const pump = (async () => {
          for await (const event of handle.events()) events.push(event)
        })()
        cleanup.push(async () => {
          await handle.close()
          await pump
        })
        await handle.send(
          `Fictional factory instructions\n\n${openPrompt}\n\nThis app adds a fictional notice.`,
        )
        await new Promise((resolve) => setImmediate(resolve))
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'assistant_message',
            text: `echo: Chrome title: ${fixtureTitle}`,
          }),
        )
        expect(browserEvidence(root, (file) => fs.readFileSync(file))).toMatchObject({
          toolOpened: true,
          toolRead: true,
          titleReturned: true,
          calls: 2,
          navigations: 1,
        })
        await handle.send(`${closePrompt}\n\nFictional prior-task context:\n${openPrompt}`)
        expect(browserEvidence(root, (file) => fs.readFileSync(file))).toMatchObject({
          toolClosed: true,
          calls: 3,
          closedTabs: 1,
        })
        expect(attachmentReads).toBeGreaterThanOrEqual(3)
        const beforeRevocation = jsonResult(await call('configuration_snapshot', {}))
        enabled = false
        await expect(
          bridge.callTool({
            ...scope,
            requestId: randomUUID(),
            origin: 'settings.page',
            name: 'configuration_snapshot',
            arguments: {},
          }),
        ).rejects.toMatchObject({ code: 'disabled' })
        // A retained route loses authority with the same captured view, before another tool side effect.
        const stale = await fetch(route.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${route.capability}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'configure_profile',
              arguments: { profile: 'fern', action: 'set-enabled', enabled: false },
            },
          }),
          signal: AbortSignal.timeout(1500),
          redirect: 'error',
        })
        await stale.body?.cancel()
        expect(stale.status).toBe(401)
        enabled = true
        expect(jsonResult(await call('configuration_snapshot', {}))).toEqual(beforeRevocation)
        await handle.close()
        await pump
      },
      60000,
    )
    it.each(['missing-route', 'wrong-title', 'missing-read', 'refused-tool'])(
      'cannot fabricate a title after %s',
      async (kind) => {
        const root = scratch()
        fs.writeFileSync(
          path.join(root, 'browser-fixture.json'),
          JSON.stringify({ url: 'http://127.0.0.1:1234/fern' }),
        )
        let sent = false
        const handle = scriptedHandle(
          {
            send: async () => {
              sent = true
            },
          },
          {},
          root,
          async () => {
            if (kind === 'missing-route') throw new Error('/fictional/private TOKEN=madeup')
            return {
              close: async () => {},
              callTool: async ({ name }) => ({
                isError: kind === 'refused-tool',
                content: [
                  {
                    type: 'text',
                    text:
                      name === 'open_tab'
                        ? JSON.stringify({
                            tabId: 't1',
                            url: 'http://127.0.0.1:1234/fern',
                            title: kind === 'wrong-title' ? 'wrong' : fixtureTitle,
                          })
                        : 'missing text',
                  },
                ],
              }),
            }
          },
        )
        await expect(handle.send(openPrompt)).rejects.toThrow()
        expect(sent).toBe(false)
        if (fs.existsSync(path.join(root, 'provider-proof.json')))
          expect(
            JSON.parse(fs.readFileSync(path.join(root, 'provider-proof.json'))).titleReturned,
          ).toBe(false)
      },
    )
    it('refuses external routes before any HTTP connection', async () => {
      await expect(
        brokerClient([
          { name: 'plugin-chrome', url: 'https://example.invalid/mcp', capability: '0'.repeat(64) },
        ]),
      ).rejects.toThrow()
    })
    it('waits for the actual tab count and fixture title, then for none, returning no raw title', async () => {
      const observed = [
        { rowPresent: true, count: 0, titleCategory: 'none' },
        { rowPresent: true, count: 1, titleCategory: 'fixture' },
        { rowPresent: true, count: 1, titleCategory: 'fixture' },
      ]
      const view = { evaluate: async () => observed.shift() }
      const wait = async (test) => {
        expect(await test()).toBe(false)
        expect(await test()).toBe(true)
      }
      expect(await waitTabs(view, 1, wait)).toEqual({
        rowPresent: true,
        count: 1,
        titleCategory: 'fixture',
      })
      expect(
        await waitTabs(
          { evaluate: async () => ({ rowPresent: true, count: 0, titleCategory: 'none' }) },
          0,
          async (test) => expect(await test()).toBe(true),
        ),
      ).toEqual({ rowPresent: true, count: 0, titleCategory: 'none' })
      expect(safeTabs({ count: 1, titleCategory: '/fictional TOKEN=madeup' })).toBe(false)
      await expect(
        observeTabs({
          evaluate: async () => ({ count: 1, titleCategory: 'fixture', raw: '/private' }),
        }),
      ).rejects.toThrow('Unsafe')
    })
    it('does not mistake a missing profile row or wrong title for live-tabs proof', async () => {
      for (const value of [
        { rowPresent: false, count: 0, titleCategory: 'none' },
        { rowPresent: true, count: 1, titleCategory: 'other' },
      ]) {
        await expect(
          waitTabs({ evaluate: async () => value }, value.count, async (test) => {
            if (!(await test())) throw new Error('timeout')
          }),
        ).rejects.toThrow('timeout')
      }
    })
    it('reduces private provider/browser receipts to booleans and counts only', () => {
      const root = scratch()
      fs.writeFileSync(
        path.join(root, 'provider-proof.json'),
        JSON.stringify({
          routeReady: true,
          opened: true,
          calls: 2,
          url: '/fictional TOKEN=madeup',
          capability: 'private',
        }),
      )
      fs.writeFileSync(
        path.join(root, 'cdp-123.json'),
        JSON.stringify({
          navigations: 1,
          evaluations: 2,
          closedTabs: 0,
          rejectedNavigations: 0,
          unsupportedCommands: 0,
          expression: 'secret',
          title: 'private',
        }),
      )
      const proof = browserEvidence(root, (file) => fs.readFileSync(file))
      expect(proof).toMatchObject({
        routeReady: true,
        toolOpened: true,
        titleReturned: false,
        navigations: 1,
      })
      expect(
        Object.values(proof).every(
          (value) => typeof value === 'boolean' || Number.isSafeInteger(value),
        ),
      ).toBe(true)
      expect(JSON.stringify(proof)).not.toMatch(
        /fictional|TOKEN|madeup|private|secret|expression|capability/,
      )
    })
  },
)
