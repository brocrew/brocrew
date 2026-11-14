// 695-visible: drives and observes the existing hosted Mac rehearsal; it issues no app launch.
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

/** Interruption preserves the turn and provider identity; API-key fixtures do not auto-continue. */
export function interruptedSavedSession(before, after, sessionId, prompt) {
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
      row.ordinal > sent.ordinal &&
      row.turn_id === sent.turn_id &&
      row.type === 'turn' &&
      row.event.state === 'interrupted',
  )
  return interrupted
    ? { sessionId, externalRef: original.external_ref, interruptedTurn: sent.turn_id }
    : null
}

export function resumedSavedSession(before, after, sessionId, prompt, responseId) {
  const interrupted = interruptedSavedSession(before, after, sessionId, UPDATE_NOW_PROMPT)
  requireEvidence(interrupted, 'The original turn was not interrupted before its normal resume.')
  const events = eventsFor(after, sessionId)
  const stopped = events.find(
    (row) =>
      row.turn_id === interrupted.interruptedTurn &&
      row.type === 'turn' &&
      row.event.state === 'interrupted',
  )
  const sent = events.find(
    (row) =>
      row.ordinal > stopped.ordinal &&
      row.type === 'user_turn' &&
      row.event.text === prompt &&
      row.event.appNotice === undefined &&
      row.turn_id !== interrupted.interruptedTurn,
  )
  requireEvidence(sent?.turn_id, 'The normal B message is missing from the saved session.')
  const reply = events.find(
    (row) =>
      row.turn_id === sent?.turn_id &&
      row.ordinal > sent.ordinal &&
      row.type === 'assistant_message' &&
      row.event.text === `update rehearsal ${responseId}`,
  )
  const finished = events.find(
    (row) =>
      row.turn_id === sent?.turn_id &&
      row.ordinal > (reply?.ordinal ?? Infinity) &&
      row.type === 'turn' &&
      row.event.state === 'completed',
  )
  requireEvidence(
    sent && reply && finished,
    'A normal B message did not continue the saved session.',
  )
  return { ...interrupted, resumedTurn: sent.turn_id, responseId }
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
  const pending = children.splice(0)
  const results = await Promise.allSettled(pending.map((child) => quitChild(child, processInfo)))
  const failures = []
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') continue
    children.push(pending[index])
    failures.push(
      new Error(`B workspace PID ${pending[index].pid}: ${String(result.reason)}`, {
        cause: result.reason,
      }),
    )
  }
  if (failures.length)
    throw new AggregateError(failures, failures.map((one) => one.message).join('; '))
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
  checkpoint,
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
    const answers = await Promise.allSettled(
      workspaces.map(async (workspace) => {
        const peer = await workspaceDetails(workspace.data)
        if (
          !peer ||
          previous.some((one) => one.pid === peer.pid) ||
          peer.executable !== `${app}/Contents/MacOS/BroCrew` ||
          !workspaces.some((one) => one.data === peer.folder)
        )
          return peer
        const identity = await processInfo(peer.pid)
        requireEvidence(
          identity?.command === `${app}/Contents/MacOS/BroCrew` ||
            identity?.command.startsWith(`${app}/Contents/MacOS/BroCrew `),
          'Automatically reopened workspace process differs from the installed app.',
        )
        if (!automaticChildren.some((one) => one.pid === peer.pid)) automaticChildren.push(identity)
        return peer
      }),
    )
    const failure = answers.find((one) => one.status === 'rejected')
    if (failure) throw failure.reason
    const peers = answers.map((one) => one.value)
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
      { version, source, checkpoint },
      {
        readReceipt,
        completedCopy,
        workspaces,
        diagnostic: summary.updateNow,
      },
    )
    workspace.result.nativeStartup = {
      ...startup,
      receiptObserved: startup !== null,
      completedCheckpointId: completed?.manifest.id ?? null,
    }
    const snapshot = databaseSnapshot(join(workspace.data, 'brobot2.sqlite'), { movedState: true })
    const drafts = JSON.parse(stateBytes(workspace.data, snapshot)['drafts.json'].toString('utf8'))
    requireEvidence(
      drafts.drafts.some((one) => one.text === workspace.draft),
      'An automatically reopened workspace lost its unsent draft.',
    )
    if (workspace.interrupted) {
      workspace.result.interruptedSession = await waitFor(
        () =>
          interruptedSavedSession(
            workspace.interrupted.before,
            databaseSnapshot(join(workspace.data, 'brobot2.sqlite')),
            workspace.interrupted.sessionId,
            UPDATE_NOW_PROMPT,
          ),
        'B keeps the interrupted turn in its original saved session',
      )
    }
  }
  summary.replacementCount++
  await quitAutomaticWorkspaces(automaticChildren, processInfo, quitChild)
  return summary.updateNow
}
