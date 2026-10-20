// Inert test adapter: execute the package's actual route with a fake browser, never Chrome.
import { createRequire } from 'node:module'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(resolve(root, 'apps/desktop/package.json'))
export async function chromeAdminRouteFixture(directory) {
  const { build } = require(require.resolve('esbuild', { paths: [require.resolve('vite')] }))
  const bundle = join(directory, 'fictional-admin-route.cjs')
  await build({
    entryPoints: [resolve(root, 'plugins/chrome/src/http/adminRoutes.ts')],
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    bundle: true,
  })
  const { registerAdminRoutes } = require(bundle)
  const routes = new Map(),
    reads = new Map(),
    launches = [],
    statuses = []
  let state = null
  const profile = { name: 'birch', temporary: false, enabled: true }
  const browser = {
    state: () => state,
    exclusive: (_name, action) => action(),
    async close() {
      state = null
    },
    async ensure(name, mode) {
      launches.push({ profile: name, mode })
      state = { mode, generation: 1 }
    },
  }
  registerAdminRoutes(
    {
      use() {},
      get(path, fn) {
        reads.set(path, fn)
      },
      post(path, fn) {
        routes.set(path, fn)
      },
    },
    {
      store: {
        get: (name) => (name === 'birch' ? profile : undefined),
        list: () => [profile],
        setFlags(name, flags) {
          if (name !== 'birch') throw new Error('unexpected fictional profile')
          Object.assign(profile, flags)
        },
      },
      browser,
      opener: { open: (name) => browser.ensure(name, 'visible') },
      logger: { info() {}, warn() {} },
    },
  )
  return {
    launches,
    statuses,
    snapshot() {
      let body
      const response = {
        status() {
          return response
        },
        json(value) {
          body = value
        },
      }
      reads.get('/v1/profiles')({}, response)
      return body.profiles[0]
    },
    async request(url, init) {
      if (
        !['/profiles/birch/open', '/profiles/birch/flags'].includes(
          new URL(url, 'http://127.0.0.1').pathname.replace(/^\/v1/, ''),
        ) ||
        init.method !== 'POST'
      )
        throw new Error('unexpected fictional route')
      let status, body
      const response = {
        status(value) {
          status = value
          return response
        },
        json(value) {
          body = value
        },
      }
      const kind = new URL(url, 'http://127.0.0.1').pathname.endsWith('/flags') ? 'flags' : 'open'
      await routes.get('/v1/profiles/:name/' + kind)(
        { params: { name: 'birch' }, body: JSON.parse(init.body) },
        response,
      )
      statuses.push(status)
      return new Response(JSON.stringify(body), { status })
    },
  }
}
