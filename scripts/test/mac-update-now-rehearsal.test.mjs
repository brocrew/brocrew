import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  interruptedContinuation,
  continuedEventsOnly,
  holdUpdateTurn,
  reopenedWorkspaceProcesses,
  restartRunningWorkspaces,
  quitAutomaticWorkspaces,
  UPDATE_NOW_PROMPT,
} from '../mac-update-now-rehearsal.mjs'

const fake = vi.hoisted(() => ({ snapshots: new Map(), drafts: new Map() }))
vi.mock('../lib/mac-update-test.mjs', async (load) => ({
  ...(await load()),
  databaseSnapshot: (file) => fake.snapshots.get(file),
  startLocalModelTurn: vi.fn(async () => 'conversation'),
  stateBytes: (folder) => ({
    'drafts.json': Buffer.from(JSON.stringify({ drafts: [{ text: fake.drafts.get(folder) }] })),
  }),
  waitFor: async (check, description) => {
    const result = await check()
    if (!result) throw new Error(description)
    return result
  },
}))

const folders = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  fake.snapshots.clear()
  fake.drafts.clear()
})

function histories() {
  const session = { id: 'conversation', external_ref: 'original-provider-session' }
  const row = (ordinal, turn_id, type, event) => ({
    id: String(ordinal),
    session_id: session.id,
    ordinal,
    turn_id,
    type,
    payload: JSON.stringify({ type, ...event }),
  })
  const before = {
    provider_session: [session],
    events: [row(0, 'original-turn', 'user_turn', { text: UPDATE_NOW_PROMPT })],
  }
  const after = {
    provider_session: [{ ...session }],
    events: [
      ...before.events,
      row(1, 'original-turn', 'turn', { state: 'interrupted' }),
      row(2, 'continuation-turn', 'user_turn', {
        text: 'continue',
        appNotice: 'a-turn-the-app-cut',
      }),
      row(3, 'continuation-turn', 'assistant_message', {
        text: 'update rehearsal resp_update_rehearsal_9',
      }),
      row(4, 'continuation-turn', 'turn', { state: 'completed' }),
    ],
  }
  return { before, after }
}

it('allows new events only in the conversation whose interrupted resume was proved', () => {
  const { before, after } = histories()
  expect(() => continuedEventsOnly(before, after, 'conversation')).not.toThrow()
  after.events.push({ id: 'foreign', session_id: 'another-conversation' })
  expect(() => continuedEventsOnly(before, after, 'conversation')).toThrow('another conversation')
})

it('binds automatic completion to the interrupted turn and original provider session', () => {
  const { before, after } = histories()
  expect(interruptedContinuation(before, after, 'conversation', UPDATE_NOW_PROMPT)).toEqual({
    sessionId: 'conversation',
    externalRef: 'original-provider-session',
    interruptedTurn: 'original-turn',
    continuedTurn: 'continuation-turn',
    responseId: 'resp_update_rehearsal_9',
  })
  after.provider_session[0].external_ref = 'replacement-session'
  expect(() => interruptedContinuation(before, after, 'conversation', UPDATE_NOW_PROMPT)).toThrow(
    'session identity',
  )
})

it.each([1, 2, 3, 4])(
  'cannot credit an unrelated or incomplete continuation when event %s is absent',
  (ordinal) => {
    const { before, after } = histories()
    after.events = after.events.filter((row) => row.ordinal !== ordinal)
    expect(interruptedContinuation(before, after, 'conversation', UPDATE_NOW_PROMPT)).toBeNull()
  },
)

it('requires distinct new processes for every exact captured workspace', () => {
  const workspaces = [
    { data: '/one', name: 'One' },
    { data: '/two', name: 'Two' },
  ]
  const peers = workspaces.map((one, index) => ({
    folder: one.data,
    pid: 10 + index,
    executable: '/BroCrew.app/Contents/MacOS/BroCrew',
  }))
  expect(reopenedWorkspaceProcesses(peers, '/BroCrew.app', workspaces, [1, 2])).toHaveLength(2)
  for (const changed of [
    peers.slice(1),
    [peers[0], { ...peers[1], pid: 10 }],
    [peers[0], { ...peers[1], folder: '/two-extra' }],
    [peers[0], { ...peers[1], executable: '/Other.app' }],
  ])
    expect(reopenedWorkspaceProcesses(changed, '/BroCrew.app', workspaces, [1, 2])).toBeNull()
  expect(reopenedWorkspaceProcesses(peers, '/BroCrew.app', workspaces, [10])).toBeNull()
})

it('holds an existing conversation only after the model request and working status agree', async () => {
  const { before } = histories()
  before.provider_session[0].status = 'working'
  const workspace = { data: '/held', conversations: ['conversation'], cdp: {} }
  fake.snapshots.set('/held/brobot2.sqlite', before)
  await holdUpdateTurn(workspace, { requests: [{ held: true, completed: false }] })
  expect(workspace.interrupted).toEqual({ sessionId: 'conversation', before })
  delete workspace.interrupted
  before.provider_session[0].status = 'idle'
  await expect(
    holdUpdateTurn(workspace, { requests: [{ held: true, completed: false }] }),
  ).rejects.toThrow('fake turn is running')
  expect(workspace.interrupted).toBeUndefined()
})

function rehearsal() {
  const folder = mkdtempSync(join(tmpdir(), 'update-now-rehearsal-'))
  folders.push(folder)
  const order = []
  const { before, after } = histories()
  const workspaces = [0, 1, 2].map((index) => {
    const data = join(folder, `workspace-${index}`),
      log = join(folder, `a-${index}.log`)
    writeFileSync(
      log,
      'BroCrew shut down in 10ms\nclose its sessions\nkeep its unsent drafts\ndrain its archive work\nclose its database',
    )
    fake.snapshots.set(join(data, 'brobot2.sqlite'), after)
    fake.drafts.set(data, `unsent draft ${index}`)
    return {
      name: `Workspace${index}`,
      data,
      draft: `unsent draft ${index}`,
      result: {},
      active: { pid: index + 1, log, browser: { close: vi.fn() } },
      cdp: { evaluate: async () => workspaces.map((one) => ({ path: one.data })), close: vi.fn() },
      baseline: { workspaceId: `uuid-${index}`, copiesBefore: [`old-${index}`] },
      ...(index === 1 ? { interrupted: { sessionId: 'conversation', before } } : {}),
    }
  })
  const app = '/BroCrew.app',
    executable = `${app}/Contents/MacOS/BroCrew`
  const summary = { replacementCount: 0 }
  const args = {
    origin: workspaces[0],
    workspaces,
    app,
    version: '0.0.99',
    source: 'candidate-source',
    summary,
    model: {
      requests: [
        { held: true, completed: false },
        { responseId: 'resp_update_rehearsal_9', completed: true },
      ],
    },
    run: vi.fn(),
    processInfo: async (pid) =>
      pid < 4 ? null : { pid, command: executable, started: `start-${pid}` },
    click: vi.fn(async (_cdp, selector) => order.push(selector)),
    observeReplacement: vi.fn(async () => {
      order.push('replacement')
      return { pid: 4, command: executable, started: 'start-4' }
    }),
    readReceipt: async (data) => ({
      workspaceId: workspaces.find((one) => one.data === data).baseline.workspaceId,
    }),
    completedCopy: async (data) => ({
      manifest: {
        id: `copy-${data}`,
        workspaceId: workspaces.find((one) => one.data === data).baseline.workspaceId,
        madeBy: { appVersion: '0.0.99', build: 'candidate-source' },
      },
    }),
    quitChild: vi.fn(async (child) => order.push(`quit-${child.pid}`)),
    bundleChecked: vi.fn(async () => ({ version: '0.0.99' })),
    workspaceDetails: async (data) => ({
      folder: data,
      executable,
      pid: workspaces.findIndex((one) => one.data === data) + 4,
    }),
    automaticChildren: [],
    onOldExit: vi.fn(),
  }
  return { args, order, folder }
}

it('presses Update now with peers running, proves all automatic reopens and resume, then quits B', async () => {
  const { args, order } = rehearsal()
  await restartRunningWorkspaces(args)
  expect(order).toEqual([
    '[data-cy=updates-restart]',
    '[data-cy=updates-confirm-now]',
    'replacement',
    'quit-4',
    'quit-5',
    'quit-6',
  ])
  expect(args.onOldExit).toHaveBeenCalledOnce()
  expect(args.summary.replacementCount).toBe(1)
  expect(args.summary.updateNow.reopened).toHaveLength(3)
  expect(args.workspaces.every((one) => one.result.nativeStartup)).toBe(true)
  expect(args.workspaces[1].result.interruptedResume.continuedTurn).toBe('continuation-turn')
  expect(args.automaticChildren).toEqual([])
})

it.each(['not-running', 'missing-peer', 'failed-drain', 'lost-draft', 'no-continuation'])(
  'retains a failed rehearsal: %s',
  async (failure) => {
    const { args } = rehearsal()
    if (failure === 'not-running') args.model.requests[0].completed = true
    if (failure === 'missing-peer') args.origin.cdp.evaluate = async () => []
    if (failure === 'failed-drain')
      writeFileSync(args.workspaces[2].active.log, 'BroCrew shut down in 10ms')
    if (failure === 'lost-draft') fake.drafts.set(args.workspaces[2].data, '')
    if (failure === 'no-continuation') {
      const snapshot = fake.snapshots.get(join(args.workspaces[1].data, 'brobot2.sqlite'))
      snapshot.events = snapshot.events.filter((row) => row.ordinal < 2)
    }
    await expect(restartRunningWorkspaces(args)).rejects.toThrow()
    expect(args.quitChild).not.toHaveBeenCalled()
    await quitAutomaticWorkspaces(args.automaticChildren, args.processInfo, args.quitChild)
    expect(args.automaticChildren).toEqual([])
  },
)
