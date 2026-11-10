import { expect, it } from 'vitest'
import { WorkspacePluginAttachments } from '../src/main/plugins/attachments'
import type { RouteAdmissionEvent } from '../src/main/plugins/route-admission-trace'

it('keeps name-level unknown discovery without inventing inventory or a route', async () => {
  const events: RouteAdmissionEvent[] = []
  const source = new WorkspacePluginAttachments(
    {
      agentRoutes: async () => ({ format: 1 as const, value: [] }),
      recordTrace: (event) => {
        events.push(event)
      },
    },
    'fictional-workspace',
  ).agent([])
  source.observe!({
    launch: 'fictional-launch',
    provider: 'claude',
    stage: 'provider-discovery',
    outcome: 'unknown',
    servers: [],
    discovery: { server: 'plugin-fern', outcome: 'unknown', route: null },
  })
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    event: 'launch-discovery',
    server: 'plugin-fern',
    outcome: 'unknown',
  })
  for (const key of ['attachmentRoute', 'plugin', 'discoveredTools', 'discoveredCount'])
    expect(events[0]).not.toHaveProperty(key)
  source.observe!({
    launch: 'fictional-launch',
    provider: 'claude',
    stage: 'provider-discovery',
    outcome: 'discovered',
    servers: [{ name: 'plugin-fern', url: 'http://127.0.0.1:8123/mcp', pluginId: 'fern' }],
    discovery: { server: 'plugin-fern', outcome: 'discovered', tools: [] },
  })
  expect(events[1]).toMatchObject({
    attachmentRoute: 'http://127.0.0.1:8123/mcp',
    plugin: 'fern',
    discoveredTools: [],
    discoveredCount: 0,
  })
  await source.close()
  source.observe!({
    launch: 'fictional-launch',
    provider: 'claude',
    stage: 'provider-discovery',
    outcome: 'unknown',
    servers: [],
    discovery: { server: 'plugin-fern', outcome: 'unknown', route: null },
  })
  expect(events).toHaveLength(2)
})
