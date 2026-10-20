import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '../../apps/desktop/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '../../apps/desktop/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'
import { createRepoAwarePluginVerifier } from '../../apps/desktop/src/main/plugins/package-verifier.ts'
import { preparePluginNodeRuntime } from '../../apps/desktop/src/main/plugins/node-runtime.ts'
import { createPluginNodeHost } from '../../apps/desktop/src/main/plugins/node-host.ts'
import { chromeBrokerBinding } from '../../apps/desktop/src/main/plugins/lifecycle/chrome-broker.ts'
import { createLifecycleAgentBridge } from '../../apps/desktop/src/main/plugins/lifecycle/agent-bridge.ts'
import { WorkspacePluginAttachments } from '../../apps/desktop/src/main/plugins/attachments.ts'
import {
  PackagedGateRuntime,
  openPrompt,
  closePrompt,
  scriptedHandle,
  brokerClient,
  preparePackagedGateHome,
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
import { fixtureTitle } from '../gates/plugin-packaged/fake-browser.mjs'
const cleanup = [],
  roots = []
const protocolInstalled = fs.existsSync(
  new URL('../../plugins/chrome/node_modules/playwright-core/package.json', import.meta.url),
)
afterEach(async () => {
  const ownedRoots = roots.splice(0)
  for (const close of cleanup.splice(0).reverse()) await close()
  for (const root of ownedRoots) fs.rmSync(root, { recursive: true, force: true })
})
function scratch() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fern-provider-')))
  roots.push(root)
  return root
}
describe.skipIf(process.platform === 'win32')(
  'a scripted provider using the installed Chrome tool protocol',
  () => {
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
      'delivers the built Chrome package full inventory through the real binding and agent bridge before its provider turn',
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
        const release = await buildChromePackage(built, 'a'.repeat(40))
        const catalogue = Buffer.from(JSON.stringify({ format: 1, entries: [release] }))
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
          browserExecutable: executable,
        })
        cleanup.push(async () => {
          // Scratch roots must survive if the owned plugin processes did not settle.
          expect(await host.stop()).toEqual({ exited: true })
        })
        const running = await host.start({
          package: verified,
          releaseDigest: release.archive.sha256,
        })
        const connection = await running.ready()
        const admin = connection.admin()
        for (const [suffix, body, status] of [
          ['/profiles', { name: 'fern' }, 201],
          ['/profiles/fern/flags', { enabled: true }, 200],
        ]) {
          const response = await fetch(admin.url + suffix, {
            method: 'POST',
            headers: { ...admin.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            redirect: 'error',
            signal: AbortSignal.timeout(1500),
          })
          await response.body?.cancel()
          expect(response.status).toBe(status)
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
        const advertised = await inventoryAt(connection.mcp())
        expect(advertised.length).toBeGreaterThan(0)
        const view = {
          installation: {
            pluginId: release.id,
            installId: 'fern-install',
            incarnation: randomUUID(),
            configRevision: 1,
          },
          package: verified,
          current: () => true,
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
            agentAttachments: () => [view],
          },
          binding: chromeBrokerBinding,
        })
        cleanup.push(() => bridge.close())
        let attachmentReads = 0
        const attachments = new WorkspacePluginAttachments(
          {
            agentRoutes: async (request) => {
              attachmentReads++
              return bridge.routes(lease, {
                ...request,
                kind: 'agent-routes',
                workspace: lease.workspace,
                generation: lease.generation,
                lease: 'b'.repeat(64),
                release: request.release === true,
              })
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
        const definitions = (tools) =>
          tools
            .map(({ name, inputSchema, description }) => ({
              name,
              inputSchema,
              description,
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
        expect(definitions(delivered)).toEqual(definitions(advertised))
        const runtime = withManagedPluginAttachments(
          new PackagedGateRuntime('claude', root),
          attachments,
        )
        const handle = await runtime.start({
          cwd: root,
          providerHome: path.join(root, 'fake-home'),
          approvalMode: 'auto',
        })
        cleanup.push(() => handle.close())
        const events = []
        const pump = (async () => {
          for await (const event of handle.events()) events.push(event)
        })()
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
