import { expect, it } from 'vitest'
import { managedPluginHttpServers, withManagedPluginMcp } from '../src/managed-plugin-mcp'
const route = { name: 'plugin-fern', url: 'http://127.0.0.1:8123/mcp', capability: 'a'.repeat(64) }
it('preserves absence and the registry overlay without alteration', () => {
  const config = { mcp_servers: { fictional: { url: 'http://127.0.0.1:8124/mcp' } } }
  expect(withManagedPluginMcp(config)).toBe(config)
  expect(managedPluginHttpServers()).toEqual({})
})
it.each([
  'https://fictional.invalid/mcp',
  'http://localhost:8123/mcp',
  'http://127.0.0.1:8123/mcp?token=x',
  'http://person:fictional@127.0.0.1:8123/mcp',
  'http://127.0.0.1:8123/admin',
])('rejects an unsafe managed endpoint %s', (url) => {
  expect(() => managedPluginHttpServers([{ ...route, url }])).toThrow('Plugin unavailable')
})
it('rejects empty auth and namespace collisions rather than replacing another route', () => {
  expect(() => managedPluginHttpServers([{ ...route, capability: '' }])).toThrow(
    'Plugin unavailable',
  )
  expect(() => managedPluginHttpServers([route, route])).toThrow('Plugin unavailable')
  expect(() =>
    withManagedPluginMcp({ mcp_servers: { 'PLUGIN-FERN': { url: 'http://127.0.0.1:8124/mcp' } } }, [
      route,
    ]),
  ).toThrow('Plugin unavailable')
})
