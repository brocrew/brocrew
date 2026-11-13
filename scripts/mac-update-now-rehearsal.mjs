import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  databaseSnapshot,
  requireEvidence,
  startLocalModelTurn,
  stateBytes,
  waitFor,
} from './lib/mac-update-test.mjs'
import { nativeWorkspaceStartup } from './mac-native-workspace.mjs'

export const UPDATE_NOW_PROMPT = 'Fictional work held across Update now'

export function continuedEventsOnly(before, after, sessionId) {
  const existing = new Set(before.events.map((row) => row.id))
  requireEvidence(
    after.events.every((row) => existing.has(row.id) || row.session_id === sessionId),
    'The interrupted-turn rehearsal appended events to another conversation.',
  )
}

const eventsFor = (snapshot, sessionId) =>
  snapshot.events
    .filter((row) => row.session_id === sessionId)
    .map((row) => ({
      ...row,
      event: JSON.parse(row.payload),
    }))

/** A completed continuation must follow the interrupted turn in the original provider session. */
export function interruptedContinuation(before, after, sessionId, prompt) {
  const original = before.provider_session.find((row) => row.id === sessionId)
  const current = after.provider_session.find((row) => row.id === sessionId)
  requireEvidence(
    original?.external_ref && current?.external_ref === original.external_ref,
    'Update now changed the interrupted provider session identity.',
  )
  const events = eventsFor(after, sessionId)
  const sent = events.find((row) => row.type === 'user_turn' && row.event.text === prompt)
  requireEvidence(sent?.turn_id, 'The interrupted fixture prompt is missing.')
  const interrupted = events.find(
    (row) =>
      row.turn_id === sent.turn_id && row.type === 'turn' && row.event.state === 'interrupted',
  )
  const continued = events.find(
    (row) =>
      row.ordinal > (interrupted?.ordinal ?? Infinity) &&
      row.type === 'user_turn' &&
      row.event.appNotice === 'a-turn-the-app-cut' &&
      row.turn_id !== sent.turn_id,
  )
  const reply = events.find(
    (row) =>
      row.turn_id === continued?.turn_id &&
      row.type === 'assistant_message' &&
      /^update rehearsal (resp_update_rehearsal_[0-9]+)$/.test(row.event.text),
  )
  const finished = events.find(
    (row) =>
      row.turn_id === continued?.turn_id &&
      row.ordinal > (reply?.ordinal ?? Infinity) &&
      row.type === 'turn' &&
      row.event.state === 'completed',
  )
  return interrupted && continued && reply && finished
    ? {
        sessionId,
        externalRef: original.external_ref,
        interruptedTurn: sent.turn_id,
        continuedTurn: continued.turn_id,
        responseId: reply.event.text.split(' ').at(-1),
      }
    : null
}

/** Match every automatic B process to a captured workspace, without launching any workspace. */
export function reopenedWorkspaceProcesses(peers, app, workspaces, previousPids) {
  const executable = `${app}/Contents/MacOS/BroCrew`
  const result = workspaces.map((workspace) => {
    const matches = peers.filter(
      (peer) =>
        peer?.folder === workspace.data &&
        peer.executable === executable &&
        !previousPids.includes(peer.pid),
    )
    return matches.length === 1
      ? { pid: matches[0].pid, name: workspace.name, path: workspace.data }
      : null
  })
  return result.every(Boolean) && new Set(result.map((one) => one.pid)).size === workspaces.length
    ? result
    : null
}

export async function quitAutomaticWorkspaces(children, processInfo, quitChild) {
  while (children.length) {
    const child = children[0]
    await quitChild(child, processInfo)
    children.shift()
  }
}

export async function holdUpdateTurn(workspace, model) {
  const sessionId = workspace.conversations[0]
  await startLocalModelTurn(workspace.cdp, UPDATE_NOW_PROMPT, { sessionId })
  const before = await waitFor(() => {
    const snapshot = databaseSnapshot(join(workspace.data, 'brobot2.sqlite'))
    return model.requests.some((one) => one.held && !one.completed) &&
      snapshot.provider_session.some((one) => one.id === sessionId && one.status === 'working') &&
      eventsFor(snapshot, sessionId).some(
        (one) => one.type === 'user_turn' && one.event.text === UPDATE_NOW_PROMPT,
      )
      ? snapshot
      : null
  }, 'the fake turn is running while the update is ready')
  workspace.interrupted = { sessionId, before }
}

export async function restartRunningWorkspaces({
  origin,
  workspaces,
  model,
  app,
  version,
  source,
  run,
  processInfo,
  click,
  observeReplacement,
  readReceipt,
  completedCopy,
  quitChild,
  bundleChecked,
  summary,
  workspaceDetails,
  automaticChildren,
  onOldExit,
}) {
  requireEvidence(
    workspaces.length >= 2 && model.requests.some((one) => one.held && !one.completed),
    'Update now needs another open workspace and a running fake turn.',
  )
  const previous = workspaces.map((one) => one.active)
  const plan = await origin.cdp.evaluate('return await window.api.updates.restartPlan()')
  requireEvidence(
    plan.length === workspaces.length &&
      workspaces.every((one) => plan.some((row) => row.path === one.data)),
    'Update now did not name all running workspaces.',
  )
  await click(origin.cdp, '[data-cy=updates-restart]')
  await click(origin.cdp, '[data-cy=updates-confirm-now]')
  await waitFor(
    async () =>
      (await Promise.all(previous.map((one) => processInfo(one.pid)))).every((one) => !one),
    'Update now quits every running A workspace normally',
    60_000,
  )
  onOldExit()
  for (const workspace of workspaces) {
    workspace.active.browser.close()
    workspace.cdp.close()
    workspace.active = null
  }
  summary.updateNow = { plan, previousPids: previous.map((one) => one.pid) }
  const restarted = await observeReplacement({
    app,
    version,
    previous: previous[0],
    run,
    processInfo,
  })
  automaticChildren.push(restarted)
  summary.installedCandidate = await bundleChecked(app, version)
  const reopened = await waitFor(async () => {
    const peers = await Promise.all(workspaces.map((one) => workspaceDetails(one.data)))
    for (const peer of peers) {
      if (
        !peer ||
        previous.some((one) => one.pid === peer.pid) ||
        peer.executable !== `${app}/Contents/MacOS/BroCrew` ||
        !workspaces.some((one) => one.data === peer.folder)
      )
        continue
      const identity = await processInfo(peer.pid)
      requireEvidence(
        identity?.command === `${app}/Contents/MacOS/BroCrew` ||
          identity?.command.startsWith(`${app}/Contents/MacOS/BroCrew `),
        'Automatically reopened workspace process differs from the installed app.',
      )
      if (!automaticChildren.some((one) => one.pid === peer.pid)) automaticChildren.push(identity)
    }
    return reopenedWorkspaceProcesses(
      peers,
      app,
      workspaces,
      previous.map((one) => one.pid),
    )
  }, 'B automatically reopens every captured workspace')
  summary.updateNow.restarted = restarted
  summary.updateNow.reopened = reopened
  for (const child of previous) {
    const log = await readFile(child.log, 'utf8')
    requireEvidence(
      /BroCrew shut down in \d+ms/.test(log) &&
        [
          'close its sessions',
          'keep its unsent drafts',
          'drain its archive work',
          'close its database',
        ].every((step) => log.includes(step) && !log.includes(`BroCrew failed to ${step}:`)),
      'Update now did not complete every normal workspace teardown step.',
    )
  }
  for (const workspace of workspaces) {
    const { startup, completed } = await nativeWorkspaceStartup(
      workspace,
      { version, source },
      {
        readReceipt,
        completedCopy,
        workspaces,
        diagnostic: summary.updateNow,
      },
    )
    workspace.result.nativeStartup = { ...startup, completedCheckpointId: completed.manifest.id }
    const snapshot = databaseSnapshot(join(workspace.data, 'brobot2.sqlite'), { movedState: true })
    const drafts = JSON.parse(stateBytes(workspace.data, snapshot)['drafts.json'].toString('utf8'))
    requireEvidence(
      drafts.drafts.some((one) => one.text === workspace.draft),
      'An automatically reopened workspace lost its unsent draft.',
    )
    if (workspace.interrupted) {
      const resumed = await waitFor(() => {
        const after = databaseSnapshot(join(workspace.data, 'brobot2.sqlite'))
        const facts = interruptedContinuation(
          workspace.interrupted.before,
          after,
          workspace.interrupted.sessionId,
          UPDATE_NOW_PROMPT,
        )
        return facts &&
          model.requests.some((one) => one.completed && one.responseId === facts.responseId)
          ? facts
          : null
      }, 'B automatically continues the interrupted turn in its saved session')
      workspace.result.interruptedResume = resumed
    }
  }
  summary.replacementCount++
  await quitAutomaticWorkspaces(automaticChildren, processInfo, quitChild)
  return summary.updateNow
}
