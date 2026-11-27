import {
  installRuntimeScreenFixture,
  disposeRuntimeScreenFixture,
  runtime,
  walk,
} from './runtime-screen-fixture'
import type { McpServerRequestForAPerson } from '../../src/shared/conversation-events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import type { WaitingOnWhoWrote } from '../../src/shared/waiting-on-who-wrote'
import { mount } from './harness'

const { default: RuntimeScreen } =
  await import('../../src/renderer/src/components/RuntimeScreen.vue')

let owed: WaitingOnWhoWrote[] = []
let requests: McpServerRequestForAPerson[] = []
const request = (n: number): McpServerRequestForAPerson => ({
  conversation: `fictional-writer-${n}`,
  at: n,
  askerCalled: 'Fictional Writer',
  requested: {
    type: 'mcp_server_requested',
    requestId: `fictional-request-${n}`,
    name: `fictional-notes-${n}`,
    url: `http://127.0.0.1:8765/mcp/${n}`,
    reaches: 'Read fictional notes.',
    whoGetsIt: 'everyone',
    requestedBy: 'editor',
  },
})
const decideMcpServerRequest = vi.fn(
  async ({ requestId }: { requestId: string; approve: boolean }) => {
    requests = requests.filter((one) => one.requested.requestId !== requestId)
    return { outcome: 'taken' as const, reason: 'Registered. It offers: read_notes.' }
  },
)

beforeEach(() => {
  requests = []
  owed = []
  installRuntimeScreenFixture()
  runtime.waitingOnWhoWroteForAPerson.mockImplementation(
    async () =>
      ({
        ...walk(),
        walk: 'every-conversation-that-was-given-work' as const,
        rows: owed,
      }) as never,
  )
  runtime.mcpServerRequestsForAPerson.mockImplementation(async () => requests as never)
  Object.assign(window.api.runtime, { decideMcpServerRequest })
})
afterEach(() => {
  usePersonsQueue().forget()
  disposeRuntimeScreenFixture()
})

it('one MCP request appears on Waiting, its rail badge and the overlay corner exactly once', async () => {
  requests = [request(1)]
  const m = mount(RuntimeScreen, {}, { width: 1200, height: 900 })
  await expect.poll(() => m.all('waiting-badge')[0]?.textContent?.trim()).toBe('1')
  m.q('rail-waiting').click()
  await expect
    .poll(() => m.all('waiting-server-request-approve-fictional-request-1').length)
    .toBe(1)
  expect(m.q('waiting-pill-count-approvals').textContent).toBe('1')
  expect(m.host.textContent).not.toContain('The person approved')
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-workspace').length).toBe(1)
  m.q('team-tab-roster').click()
  await nextTick()
  m.q('team-open-editor').click()
  await expect.poll(() => m.all('overlay-host').length).toBe(1)
  expect(m.q('persons-queue-count').textContent).toBe('1')
  expect(m.all('persons-queue-server-request-approve-fictional-request-1')).toHaveLength(1)
  expect(m.host.querySelector('.request-url')?.textContent).toBe(request(1).requested.url)
})

it('the actual screen sends only id and approve and removes the count before its next poll', async () => {
  requests = [request(1), request(2)]
  const m = mount(RuntimeScreen, {})
  await expect.poll(() => m.all('waiting-badge')[0]?.textContent?.trim()).toBe('2')
  m.q('rail-waiting').click()
  await expect
    .poll(() => m.all('waiting-server-request-approve-fictional-request-1').length)
    .toBe(1)
  m.q('waiting-server-request-approve-fictional-request-1').click()
  await expect.poll(() => decideMcpServerRequest.mock.calls.length).toBe(1)
  expect(decideMcpServerRequest).toHaveBeenCalledWith({
    requestId: 'fictional-request-1',
    approve: true,
  })
  expect(Object.keys(decideMcpServerRequest.mock.calls[0]![0]).sort()).toEqual([
    'approve',
    'requestId',
  ])
  await expect
    .poll(() => m.all('waiting-server-request-settled-fictional-request-1').length)
    .toBe(1)
  expect(m.q('waiting-badge').textContent?.trim()).toBe('1')
  expect(m.q('waiting-pill-count-approvals').textContent).toBe('1')
  expect(m.q('waiting-server-request-settled-fictional-request-1').textContent).toBe(
    'Registered. It offers: read_notes.',
  )
  expect(m.all('waiting-server-request-approve-fictional-request-1')).toHaveLength(0)
  expect(m.all('waiting-server-request-approve-fictional-request-2')).toHaveLength(1)
})

it('the healthy empty screen has no MCP group, badge or floating request count', async () => {
  const m = mount(RuntimeScreen, {})
  await expect.poll(() => runtime.personsQueue.mock.calls.length).toBeGreaterThan(0)
  m.q('rail-waiting').click()
  await nextTick()
  expect(m.all('waiting-badge')).toHaveLength(0)
  expect(m.all('waiting-server-requests')).toHaveLength(0)
  expect(m.q('waiting-pill-count-approvals').textContent?.trim()).not.toMatch(/[1-9]/)
  expect(m.all('persons-queue-count')).toHaveLength(0)
})

it('an MCP request and a reply owed to a person count once each across distinct groups', async () => {
  requests = [request(1)]
  owed = [
    {
      piece: 'fictional-work',
      label: 'W99.1',
      title: 'Draft fictional pages',
      owner: 'fictional-other',
      ownerName: 'Fictional Editor',
      answeredAt: 100,
    },
  ]
  const m = mount(RuntimeScreen, {}, { width: 1200, height: 900 })
  await expect.poll(() => m.all('waiting-badge')[0]?.textContent?.trim()).toBe('2')
  m.q('rail-waiting').click()
  await expect
    .poll(() => m.all('waiting-server-request-approve-fictional-request-1').length)
    .toBe(1)
  expect(m.q('waiting-pill-count-approvals').textContent).toBe('1')
  expect(m.all('waiting-server-request-fictional-request-1')).toHaveLength(1)
  expect(m.q('waiting-pill-count-reply').textContent).toBe('1')
  m.q('waiting-pill-reply').click()
  await nextTick()
  expect(m.host.textContent).toContain('Draft fictional pages')
  m.q('rail-team').click()
  await expect.poll(() => m.all('team-workspace').length).toBe(1)
  m.q('team-tab-roster').click()
  await nextTick()
  m.q('team-open-editor').click()
  await expect.poll(() => m.all('overlay-host').length).toBe(1)
  expect(m.q('persons-queue-count').textContent).toBe('2')
  expect(m.all('persons-queue-server-request-fictional-request-1')).toHaveLength(1)
  expect(m.host.textContent).toContain('Draft fictional pages')
})
