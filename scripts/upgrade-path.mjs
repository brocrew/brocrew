import { recoveryProofCases } from './lib/upgrade-recovery-proof.mjs'
import { firstCopyPolicy, checkCheckpointRetention } from './lib/upgrade-candidate-evidence.mjs'
import { readStateEntry } from './lib/skill-tree-state.mjs'
import { retainedFixtureTables, replacementSetMatches } from './lib/upgrade-retention.mjs'
import { runTrimUpgradeSafety } from './lib/upgrade-trim-safety.mjs'
import { aCrashAfterTheSavedKey, until } from './lib/update-rehearsal-app.mjs'
import { keyEntryPreserved } from './lib/recovery-key-contract.mjs'
import { proofManifests } from './lib/recovery-measurement.mjs'
import { liveProviderSessions } from './lib/upgrade-session-preservation.mjs'
import {
  describeDatabase,
  readDatabase,
  verifyFixtureCheckpoint,
  whole,
} from './lib/upgrade-database.mjs'
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  CHECKPOINT_LINE,
  copiesSince,
  keptTables,
  skillsKept,
  RETIRED_TABLES,
  jobSummary,
  lastResortStop,
  lineageFits,
  recordedWith,
  workspaceRegistryBaseline,
  requireEvidence,
  resultLine,
  rowsPreserved,
  CONNECTION_UPGRADE_DEFAULTS,
  stateKept,
  theCandidateInstaller,
  turnOutcome,
} from './lib/upgrade-path.mjs'
import { JOB_NOTICE, jobNoticesIn, minuteOf } from './lib/scripted-claude.mjs'
import {
  REPO,
  args,
  os,
  trimsEvents,
  runsTrimSafety,
  evidence,
  WORKSPACE_NAME,
  DRAFT,
  data,
  candidateNames,
  candidateAppName,
  started,
  harnessLog,
  say,
  summary,
  check,
  must,
  holds,
  keep,
  running,
  claudeDueAt,
  installedExe,
  installedProgram,
  setInstalled,
} from './lib/upgrade-run/settings.mjs'
import { samePath, alive, installedCandidateSkills, install } from './lib/upgrade-run/system.mjs'
import {
  modelSeen,
  model,
  answerText,
  claudeOneShotAt,
  DUE_JOB_PROMPT,
  DUE_WHILE_STOPPED,
  TIME_NOT_KNOWN_WORDS,
  CLAUDE_ROUTE,
} from './lib/upgrade-run/models.mjs'
import {
  launch,
  pagesNow,
  bridge,
  onScreen,
  dialogsAtAStart,
  whatRunsIsRead,
  whatEachSetupSays,
  railLists,
  screenshot,
  wholeScreen,
  verdict,
  wholeLog,
  quit,
  stop,
  phase,
} from './lib/upgrade-run/app.mjs'
import {
  stateFiles,
  readState,
  transcriptsKept,
  ownTranscriptsKept,
  copies,
  copySaid,
  besideKept,
  keychainEntries,
  kept,
  observeTheSavedKey,
} from './lib/upgrade-run/state.mjs'
import {
  turn,
  scheduleAttemptsOf,
  historyTail,
  claudeTurn,
  crash,
  linesOf,
  jobWordsIn,
  aCrashMidStart,
  theKeySavedAgain,
  COPY_FINISH_MS,
  theStartAndTheKey,
  startHiddenProgram,
} from './lib/upgrade-run/conversations.mjs'
import { theBeta } from './lib/upgrade-run/the-beta.mjs'

let exitCode = 1
async function runUpgradePath() {
  const stage = await theBeta()
  if (stage === null) {
    exitCode = summary.failures.length === 0 ? 0 : 1
    return
  }
  const {
    candidateLineage,
    beta,
    betaVersion,
    conversations,
    betaAnswers,
    claudeConversation,
    claudeDueConversation,
    theBetasConversations,
    theBetasConversationsSaid,
    theStartsOwed,
    theFirstOpenTold,
    betaUpdates,
    before,
    safetyBaseline,
    betaEntry,
    claudeKeyWasSealed,
    claudeJobIds,
    stamped,
    history,
    transcriptsBefore,
    filesBefore,
    stateBefore,
    besideBefore,
  } = stage
  must(
    Object.values(transcriptsBefore).every((one) => one.bytes > 0),
    'each of the beta’s conversations has its own Codex transcript',
    transcriptsBefore,
  )
  must(stateBefore['drafts.json'] !== undefined, 'the beta left its drafts file')
  check(stateBefore['workspace.json'] !== undefined, 'the beta left its workspace’s name file')
  const registryProblems = workspaceRegistryBaseline(
    besideBefore.registry,
    summary.betaApp.workspace.path,
  )
  check(
    besideBefore['settings.json'] !== null && registryProblems.length === 0,
    'the beta left the computer’s settings and its list of workspaces',
    { ...besideBefore, registryProblems },
  )
  const copiesTheBetaLeft = await copies()
  const leftByTheBeta = copiesSince([], copiesTheBetaLeft, betaVersion)
  summary.baseline.copies = copiesTheBetaLeft.map(copySaid)
  check(
    leftByTheBeta.others.length === 0 && leftByTheBeta.unread.length === 0,
    `each recovery copy the beta left says the beta (${betaVersion}) made it`,
    summary.baseline.copies,
  )
  summary.baseline.migrationsRecordedWith = recordedWith(before.lineage, candidateLineage)
  keep('baseline.json', summary.baseline)
  must(
    lineageFits(before.lineage, candidateLineage),
    "the beta's migrations are the first of the candidate's, by the rule the app's start uses",
    {
      recordedWith: summary.baseline.migrationsRecordedWith,
      beta: before.lineage,
      candidate: candidateLineage,
    },
  )
  const firstCompaction = trimsEvents && before.storage.free * 2 > before.storage.pages
  const migrationCopy = candidateLineage.length > before.lineage.length
  const expectedReason = firstCompaction
    ? 'after-compaction'
    : migrationCopy
      ? 'before-migration'
      : null
  const firstCheckpointCount = Number(migrationCopy) + Number(firstCompaction)
  const completedCopies = copiesTheBetaLeft.map((copy) => {
    const folder = join(data, 'backups', copy.folder)
    const files = {}
    for (const name of ['database.sqlite', ...stateFiles]) {
      if (existsSync(join(folder, name))) files[name] = readStateEntry(join(folder, name))
    }
    return { ...copy, files, unfinished: existsSync(join(folder, 'unfinished')) }
  })
  const firstCopy = firstCopyPolicy(before.lineage, candidateLineage, completedCopies, {
    workspaceId:
      completedCopies.length > 0
        ? readFileSync(join(data, 'backups', 'workspace-id'), 'utf8').trim()
        : undefined,
    stateFiles,
  })
  const previousWhole = completedCopies.filter(({ manifest }) =>
    firstCopy.fallbacks.includes(manifest?.id),
  )
  const previousMigration = previousWhole.filter(
    ({ manifest }) => manifest.reason === 'before-migration',
  )
  const previousSelected =
    (previousMigration.length > 0
      ? previousMigration.sort(
          (a, b) => Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt),
        )
      : previousWhole.sort(
          (a, b) => Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt),
        ))[0]?.folder ?? null
  const firstCopyCompletion = firstCopy.completion
  summary.firstCopyPolicy = firstCopy
  keep('first-copy-policy.json', firstCopy)
  const betasCopyIds = new Set(copiesTheBetaLeft.map(({ manifest }) => manifest?.id))
  let firstCopyObservation = null

  const candidateDir = resolve(args['candidate-dir'])
  const candidateFile = join(
    candidateDir,
    theCandidateInstaller(readdirSync(candidateDir), os, args['candidate-version']),
  )
  const candidate = install(candidateFile, `the candidate (${args['candidate-version']})`)
  summary.candidateInstall = candidate.facts
  const candidateSkills = installedCandidateSkills(candidate)
  summary.candidateSkills = { names: candidateSkills.names, digest: candidateSkills.digest }
  check(
    candidate.productName === candidateNames.productName,
    `the candidate installs as ${candidateNames.productName}, the name its build gives it`,
    { installed: candidate.productName, packaged: candidateNames.productName },
  )
  const nameChanged = candidate.productName !== beta.productName
  if (os === 'windows') {
    check(
      candidate.facts.entries[0].DisplayVersion === args['candidate-version'] &&
        samePath(dirname(candidate.exe), dirname(installedExe)),
      'Windows lists the app once, at the candidate version, in the beta’s folder',
      candidate.facts.entries,
    )
    if (nameChanged) {
      check(
        !existsSync(installedExe),
        `the beta’s program, ${basename(installedExe)}, is gone from that folder`,
        { files: candidate.facts.files },
      )
    }
  } else {
    check(
      candidate.facts.version === args['candidate-version'],
      'the app the candidate put in Applications is the candidate',
      candidate.facts,
    )
    const expected = [
      ...new Set([`${beta.productName}.app`, `${candidate.productName}.app`]),
    ].sort()
    check(
      JSON.stringify(candidate.facts.inApplications) === JSON.stringify(expected),
      nameChanged
        ? `Applications holds the beta’s ${beta.productName}.app beside the candidate’s ${candidate.productName}.app, as a person’s drag leaves them`
        : `Applications holds one ${candidate.productName}.app: the candidate replaced the beta`,
      { inApplications: candidate.facts.inApplications, expected },
    )
  }
  setInstalled(candidate.exe, candidate.program)
  check(
    existsSync(join(data, 'brobot2.sqlite')),
    'installing the candidate left the data folder in place',
  )
  check(
    transcriptsKept(transcriptsBefore, { exact: true }).length === 0 &&
      stateKept(stateBefore, readState(data, before.tables), stateFiles).lost.length === 0,
    'installing the candidate changed no transcript and no state file',
  )

  if (args['recovery-proof']) {
    must(
      migrationCopy,
      'The published predecessor must have migrations left for the candidate to apply.',
      { predecessor: before.lineage.length, candidate: candidateLineage.length },
    )
    await recoveryProofCases(
      {
        candidate,
        before,
        candidateLineage,
        conversations,
        betaAnswers,
        besideBefore,
        data,
        args,
        REPO,
        stateFiles,
        summary,
      },
      {
        launch,
        current: () => running,
        alive,
        phase,
        check,
        startHiddenProgram,
        must,
        answerText,
        quit,
        readState,
        besideKept,
        keep,
        stop,
      },
    )
    exitCode = summary.failures.length === 0 ? 0 : 1
    return
  }

  summary.firstStart = {}
  if (claudeDueAt !== null) {
    await until(() => (Date.now() > claudeDueAt.getTime() + 45_000 ? true : null), 300_000, 5_000)
  }
  await phase('first start', async () => {
    await launch('candidate-first', 9340)
    summary.firstStart.readyAfterMs = await verdict('first start')
    keep('candidate-first-windows.json', await pagesNow())
    await bridge('first start')
    await onScreen('first start')
    await screenshot('candidate-first.png')
    await dialogsAtAStart('first start', summary.firstStart)
    const info = await running.cdp.evaluate('return await window.api.getAppInfo()')
    const responsive = performance.now()
    const manifestAbsent = !(await proofManifests(data)).some(
      (one) => !betasCopyIds.has(one.manifest.id),
    )
    firstCopyObservation = {
      launched: running.launchedMono,
      responsive,
      absent: performance.now(),
      manifestAbsent,
    }
    summary.firstStart.copyObservation = firstCopyObservation
    summary.firstStart.app = info
    check(
      info?.version === args['candidate-version'] && info?.build?.commit === args['source-sha'],
      'the running app is the candidate, built from the selected candidate commit',
      { version: info?.version, build: info?.build },
    )
    check(
      samePath(info?.workspace?.path, data) &&
        info?.workspace?.isDefault === true &&
        info?.workspace?.name === WORKSPACE_NAME,
      'the candidate opened the beta’s data folder, under the name the beta gave it',
      info?.workspace,
    )
    const everyConversation = theBetasConversations()
    check(
      info?.db?.migrationsApplied === candidateLineage.length &&
        info?.db?.providerSessionCount === everyConversation.length,
      `the candidate says schema ${String(candidateLineage.length)} and ${String(everyConversation.length)} conversations: ${theBetasConversationsSaid()}`,
      info?.db,
    )
    const updates = await running.cdp.evaluate(
      'const read = await window.api.updates.read(); return { checkAutomatically: read.checkAutomatically }',
    )
    check(
      updates.checkAutomatically === false,
      'the candidate keeps the update setting the beta left',
      { beta: betaUpdates, candidate: updates },
    )
    await railLists('first start', theBetasConversations(), theBetasConversationsSaid())
    if (claudeConversation !== null) await theFirstOpenTold()
    const draftRead = await running.cdp.evaluate(
      `return (await window.api.savedDrafts())?.drafts?.some((one) => one.text === ${JSON.stringify(DRAFT)}) ?? false`,
    )
    check(draftRead === true, 'the candidate reads the beta’s unsent draft')
    for (const sessionId of conversations) {
      const read = await running.cdp.evaluate(
        `return await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(sessionId)} }).then((one) => JSON.stringify(one).includes(${JSON.stringify(answerText(betaAnswers[sessionId]))})).catch((e) => 'refused: ' + String(e))`,
      )
      check(
        read === true,
        `the candidate reads conversation ${sessionId} as the beta recorded it`,
        {
          read,
        },
      )
    }
    await observeTheSavedKey('first start')
    wholeScreen('screen-after-the-first-start.png')
    if (expectedReason !== null && firstCopyCompletion === 'functional-background') {
      const finished = await until(
        () => (readFileSync(running.log, 'utf8').includes(CHECKPOINT_LINE) ? true : null),
        COPY_FINISH_MS,
        500,
      )
      if (finished === true) firstCopyObservation.completed = performance.now()
      check(
        finished === true,
        `first start: the recovery copy finished in the background before the app was asked to close (waited up to ${String(COPY_FINISH_MS / 1_000)} s)`,
      )
    }
    firstCopyObservation.closeRequested = performance.now()
    await quit('the candidate, after its first start')
  })
  summary.firstStart.order = existsSync(join(evidence, 'candidate-first.log'))
    ? wholeLog('candidate-first', {
        checkpoint: expectedReason !== null,
        checkpointCount: firstCheckpointCount,
        completion: firstCopyCompletion,
        observation: firstCopyObservation,
      })
    : check(false, 'first start: its log was kept')

  const copiesAfterFirst = await copies()
  const sinceTheBeta = copiesSince(copiesTheBetaLeft, copiesAfterFirst, args['candidate-version'])
  summary.copiesAfterFirst = { ...sinceTheBeta, copies: copiesAfterFirst.map(copySaid) }
  if (expectedReason !== null)
    holds('the first start retained one recovery copy with exactly the beta’s data', () => {
      requireEvidence(
        sinceTheBeta.made.length === 1 &&
          sinceTheBeta.others.length === 0 &&
          sinceTheBeta.unread.length === 0,
        `The first start left ${String(sinceTheBeta.made.length)} new copies that name the candidate’s version, not one, and ${String(sinceTheBeta.others.length + sinceTheBeta.unread.length)} that do not: ${JSON.stringify(summary.copiesAfterFirst.copies)}`,
      )
      summary.checkpoint = verifyFixtureCheckpoint({
        data,
        made: sinceTheBeta.made[0],
        baseline: before,
        state: filesBefore,
        stateFiles,
        reason: expectedReason,
        version: args['candidate-version'],
        source: args['source-sha'],
        program: installedProgram,
        os,
        prefix: 'checkpoint',
        keep,
      })
    })

  checkCheckpointRetention(check, {
    copiesAfterFirst,
    sinceTheBeta,
    copiesTheBetaLeft,
    previousSelected,
    expectedReason,
  })
  check(
    copiesTheBetaLeft.every(
      ({ manifest }) =>
        typeof manifest?.workspaceId === 'string' &&
        manifest.workspaceId === readFileSync(join(data, 'backups', 'workspace-id'), 'utf8').trim(),
    ),
    'each recovery copy the beta made is of the workspace the candidate’s copy is of',
    {
      candidate: summary.checkpoint?.workspaceId ?? null,
      beta: copiesTheBetaLeft.map(({ folder, manifest }) => ({
        folder,
        workspaceId: manifest?.workspaceId ?? null,
      })),
    },
  )
  const afterFirst = readDatabase(data)
  const sessionComparison = (stage, after) => {
    const comparison = liveProviderSessions(
      before,
      after,
      candidateLineage,
      CONNECTION_UPGRADE_DEFAULTS,
    )
    keep(`${stage}-provider-sessions.json`, comparison.receipt)
    return comparison
  }
  const firstSessions = sessionComparison('candidate-first', afterFirst)
  if (claudeConversation !== null) {
    const notices = jobNoticesIn(afterFirst.tables.events, claudeConversation)
    summary.claude.afterFirst = notices
    if (!stamped()) {
      const startedAtFirstOpen = notices.said.length > 0
      const saysNotStarted = notices.appLevels.some((jobs) => jobs.includes('time-not-known'))
      check(
        startedAtFirstOpen ? saysNotStarted : !saysNotStarted,
        startedAtFirstOpen
          ? 'at its first open, once it made its one start, the candidate lists the job the beta made as one whose time it cannot know, not started again'
          : 'at its first open, its one start still owed, the candidate does not yet list the job the beta made as not started',
        notices,
      )
      check(
        notices.queued.length === 1,
        `at its first open, the candidate held its words about that job once (${JOB_NOTICE})`,
        notices,
      )
    } else {
      const listed = new Map(notices.appJobs.map((job) => [job.id, job]))
      check(
        listed.size === 2 &&
          listed.get(claudeJobIds.repeating)?.notStarted === null &&
          typeof listed.get(claudeJobIds.repeating)?.nominalAt === 'number' &&
          listed.get(claudeJobIds.oneShot)?.notStarted === null &&
          listed.get(claudeJobIds.oneShot)?.nominalAt === minuteOf(claudeOneShotAt) &&
          !listed.has(claudeJobIds.cancelled),
        'from a beta that stamps its receipts, at its first open the candidate lists the repeating job and the one-shot with the times it knows, and not the job the beta cancelled',
        { listed: notices.appJobs, ids: claudeJobIds, oneShotAt: claudeOneShotAt.toISOString() },
      )
      const started = linesOf(
        'candidate-first',
        `starting ${claudeConversation} for its scheduled jobs`,
      )
      check(
        notices.queued.length === 0 && notices.said.length === 0 && started.length === 0,
        'from a beta that stamps its receipts, nothing is owed at the first open: no words held or said, and no start',
        { notices, started },
      )
    }
  }
  if (claudeDueConversation !== null) {
    const due = jobNoticesIn(afterFirst.tables.events, claudeDueConversation)
    summary.claude.dueAfterFirst = due
    const words = stamped() ? DUE_WHILE_STOPPED : TIME_NOT_KNOWN_WORDS
    check(
      due.queued.length === 1 &&
        (due.queued[0] ?? '').includes(words) &&
        (due.queued[0] ?? '').includes(DUE_JOB_PROMPT),
      stamped()
        ? 'at its first open, the candidate held words once for the second conversation’s one-shot: it was due while the app was closed'
        : 'at its first open, the candidate held words once for the second conversation’s one-shot: its time is one it cannot know',
      due,
    )
  }
  const firstRetention = retainedFixtureTables(
    before.tables,
    afterFirst.tables,
    args['candidate-version'],
  )
  keep('candidate-first-retention.json', firstRetention.removed)
  if (firstCompaction)
    check(
      afterFirst.storage.autoVacuum === 2,
      'the eligible first-launch compaction installed an incremental database',
      afterFirst.storage,
    )
  const keptRows = rowsPreserved(
    keptTables(firstRetention.tables),
    afterFirst.tables,
    undefined,
    before.keys,
    candidateSkills,
    firstSessions.additions,
  )
  const afterFirstSkills = skillsKept(before.tables, afterFirst.tables, candidateSkills)
  check(
    afterFirstSkills.length === 0,
    'skill versions, choices and valid current pointers survive the upgrade',
    afterFirstSkills,
  )
  summary.afterFirst = { database: describeDatabase(afterFirst), added: keptRows.added }
  check(whole(afterFirst), "the candidate's database is whole", afterFirst.integrity)
  check(
    keptRows.lost.length === 0,
    'every conversation, protected event, retained history row, saved key and other state the beta left is unchanged',
    { lost: keptRows.lost.slice(0, 40), added: keptRows.added },
  )
  check(
    RETIRED_TABLES.every((table) => !(table in afterFirst.tables)),
    'the tables a migration retires are gone from the candidate’s database',
    Object.fromEntries(
      RETIRED_TABLES.map((table) => [
        table,
        { before: before.tables[table]?.length ?? null, after: table in afterFirst.tables },
      ]),
    ),
  )
  check(
    firstSessions.receipt.matchesLineage,
    `the schema moved from ${String(before.lineage.length)} to the candidate's ${String(candidateLineage.length)}, and the beta's own migration records are as it left them`,
    {
      before: before.lineage.length,
      after: afterFirst.lineage.length,
      recordedWith: recordedWith(afterFirst.lineage, candidateLineage),
    },
  )
  const stateNow = stateKept(stateBefore, readState(data, afterFirst.tables), stateFiles)
  summary.afterFirst.state = stateNow
  check(
    stateNow.lost.length === 0,
    'every state file the beta left still says what it said',
    stateNow,
  )
  const transcriptsNow = transcriptsKept(transcriptsBefore, { exact: true })
  check(
    transcriptsNow.length === 0,
    'each conversation’s Codex transcript is byte for byte what the beta left',
    transcriptsNow,
  )
  ownTranscriptsKept('after the first start', history, transcriptsBefore, afterFirst.tables)
  besideKept('after the first start', besideBefore)

  summary.secondStart = {}
  let copiesAtSecondReady = null
  const secondCopyState = readState(data, afterFirst.tables)
  const secondCompaction = trimsEvents && afterFirst.storage.free * 2 > afterFirst.storage.pages
  await phase('second start', async () => {
    await launch('candidate-second', 9341)
    summary.secondStart.readyAfterMs = await verdict('second start')
    await bridge('second start')
    await onScreen('second start')
    await dialogsAtAStart('second start', summary.secondStart)
    copiesAtSecondReady = await copies()
    const sinceTheFirst = copiesSince(
      copiesAfterFirst,
      copiesAtSecondReady,
      args['candidate-version'],
    )
    check(
      replacementSetMatches(
        { ...sinceTheFirst, previousCount: copiesAfterFirst.length },
        secondCompaction,
      ),
      'the second start obeyed its measured compaction eligibility and retained one checkpoint',
      sinceTheFirst,
    )
    if (secondCompaction)
      summary.secondStart.checkpoint = verifyFixtureCheckpoint({
        data,
        made: sinceTheFirst.made[0],
        baseline: afterFirst,
        state: secondCopyState,
        stateFiles,
        reason: 'after-compaction',
        version: args['candidate-version'],
        source: args['source-sha'],
        program: installedProgram,
        os,
        prefix: 'second-checkpoint',
        keep,
      })
    await observeTheSavedKey('second start')
    summary.secondStart.turns = []
    const carriedOn = []
    for (const sessionId of conversations) {
      const carried = await turn(sessionId, 'A fictional turn after the upgrade', { resume: true })
      carriedOn.push({ sessionId, ...carried })
      check(
        kept(carried.probes),
        `the app answered each time it was asked, while conversation ${sessionId} started on the saved key`,
        carried.probes,
      )
    }
    wholeScreen('screen-after-the-turns.png')
    const keyStatus = await observeTheSavedKey('second start, after the turns')
    for (const carried of carriedOn) {
      const judged = turnOutcome(carried, keyStatus)
      summary.secondStart.turns.push({ ...judged, ...carried })
      check(
        judged.ok,
        judged.outcome === 'the-saved-key-cannot-be-read'
          ? `the candidate refused to start conversation ${carried.sessionId} on the key the beta sealed, in its own words, within a minute, without asking the model or falling back to a sign-in`
          : `the candidate carried on conversation ${carried.sessionId}, answered on the key the beta saved`,
        { ...judged, ...carried, keyStatus },
      )
    }
    const turns = summary.secondStart.turns
    const allAnswered = turns.every((one) => one.outcome === 'answered')
    if (allAnswered) {
      check(
        keyStatus?.inUse === true && keyStatus?.readState === undefined,
        'after the turns, the app says the key the beta saved is in use',
        keyStatus,
      )
    }
    if (os === 'mac' && betaEntry !== null && betaEntry.appName === candidateAppName) {
      const entries = keychainEntries('after-candidate')
      summary.keychain.afterTheCandidateAskedForTheKey = entries
      check(
        keyEntryPreserved(betaEntry, entries),
        `the beta’s Keychain entry ("${betaEntry.service}", account "${betaEntry.account}") is as the beta left it, and the candidate made no other`,
        { before: betaEntry, now: entries },
      )
    }
    const refusedTurn = turns.find((one) => one.refused !== null)
    summary.savedKeyAfterTheUpgrade = !turns.every((one) => kept(one.probes))
      ? 'the app stopped answering while it opened the saved key'
      : allAnswered
        ? 'in use: both conversations carried on with it, and the app answered each time it was asked'
        : `not in use: ${refusedTurn?.refused ?? 'a turn was not answered'} (the ${refusedTurn?.refusedAt ?? 'turn'} was refused ${String(refusedTurn?.refusedAfterMs ?? 'no')} ms after it was asked; the app answered each time it was asked)`
    summary.secondStart.whatRuns = await whatRunsIsRead('second start')
    if (claudeConversation !== null) {
      const text = 'A fictional Claude turn after the upgrade'
      const carried = await claudeTurn(claudeConversation, text, { resume: true })
      summary.claude.candidate = { first: carried }
      if (carried.answer === null) {
        summary.claude.candidate.history = await historyTail(claudeConversation)
      }
      const claudeKey = await running.cdp.evaluate(
        "return await window.api.runtime.apiKeyStatus({ provider: 'claude' }).catch(() => null)",
      )
      const judged = turnOutcome(carried, claudeKey)
      summary.claude.candidate.judged = judged
      check(
        judged.ok,
        judged.outcome === 'the-saved-key-cannot-be-read'
          ? 'the candidate refused to start the Claude conversation on the Anthropic key the beta sealed, in its own words, within a minute, without asking the model or falling back to a sign-in'
          : `the candidate’s Claude Code reached the scripted model, ${CLAUDE_ROUTE}, and carried the Claude conversation on`,
        { ...judged, refused: carried.refused, requests: carried.requests, claudeKey },
      )
    }
    const [shown] = conversations
    await railLists('second start', theBetasConversations(), theBetasConversationsSaid())
    await running.cdp.evaluate(
      `document.querySelector('[data-cy="open-session-${shown}"]')?.click()`,
    )
    const drawn = await until(
      () =>
        running.cdp.evaluate(
          `return [...document.querySelectorAll('[data-cy=reading-pane], [data-cy=conversation-pane]')].some((one) => (one.innerText ?? '').includes(${JSON.stringify(answerText(betaAnswers[shown]))}))`,
        ),
      120_000,
    )
    await screenshot('candidate-second.png')
    check(
      Boolean(drawn),
      'the window draws the answer the beta recorded, in that conversation’s own view',
    )
    await whatEachSetupSays('second start', summary.secondStart)
    await quit('the candidate, after its second start')
  })
  if (existsSync(join(evidence, 'candidate-second.log'))) {
    summary.secondStart.order = wholeLog('candidate-second', {
      checkpoint: secondCompaction,
      checkpointCount: Number(secondCompaction),
    })
  } else check(false, 'second start: its log was kept')

  const afterSecond = readDatabase(data)
  const secondSessions = sessionComparison('candidate-second', afterSecond)
  check(
    secondSessions.receipt.matchesLineage,
    'Second start preserves the candidate migration lineage',
  )
  if (secondCompaction)
    check(
      afterSecond.storage.autoVacuum === 2,
      'the eligible second-launch compaction retained incremental mode',
      afterSecond.storage,
    )
  for (const owed of theStartsOwed()) {
    theStartAndTheKey(owed.conversation, owed.called, summary.claude.firstOpen?.starts?.[owed.of])
  }
  if (claudeConversation !== null) {
    const notices = jobNoticesIn(afterSecond.tables.events, claudeConversation)
    summary.claude.afterAll = { notices, attempts: scheduleAttemptsOf(claudeConversation) }
    if (!stamped()) {
      check(
        notices.queued.length === 1 &&
          notices.said.length === (claudeKeyWasSealed ? 0 : 1) &&
          (claudeKeyWasSealed || notices.said[0] === notices.queued[0]),
        claudeKeyWasSealed
          ? 'the candidate held its words about that job once, unsaid, for a start that waits for the key to be saved again'
          : 'the readable key: the candidate held its words about that job once and delivered those words once',
        notices,
      )
    } else {
      check(
        notices.queued.length === 0 &&
          notices.said.length === 0 &&
          !notices.appLevels.some((jobs) => jobs.includes('time-not-known')),
        'from a beta that stamps its receipts, over every start nothing was said to the first conversation about its jobs, and none of its rows says their time is not known',
        notices,
      )
    }
  }
  if (claudeDueConversation !== null) {
    const due = jobNoticesIn(afterSecond.tables.events, claudeDueConversation)
    summary.claude.dueAfterAll = due
    check(
      due.queued.length === 1 &&
        due.said.length === (claudeKeyWasSealed ? 0 : 1) &&
        (claudeKeyWasSealed || due.said[0] === due.queued[0]),
      claudeKeyWasSealed
        ? 'the candidate held its words about the second conversation’s one-shot once, unsaid, for a start that waits for the key to be saved again'
        : 'the readable key: the candidate held the second conversation’s one-shot notice once and delivered those words once',
      due,
    )
  }
  const secondRetention = retainedFixtureTables(
    before.tables,
    afterSecond.tables,
    args['candidate-version'],
  )
  keep('candidate-second-retention.json', secondRetention.removed)
  const stillKept = rowsPreserved(
    keptTables(secondRetention.tables),
    afterSecond.tables,
    undefined,
    before.keys,
    candidateSkills,
    secondSessions.additions,
  )
  const afterSecondSkills = skillsKept(before.tables, afterSecond.tables, candidateSkills)
  check(
    afterSecondSkills.length === 0,
    'skill versions, choices and valid current pointers survive the upgrade',
    afterSecondSkills,
  )
  summary.afterSecond = { database: describeDatabase(afterSecond), added: stillKept.added }
  check(
    whole(afterSecond) && stillKept.lost.length === 0,
    'after the second start, protected events, retained history and all other state the beta left are unchanged',
    { integrity: afterSecond.integrity, lost: stillKept.lost.slice(0, 40) },
  )
  ownTranscriptsKept('after the second start', history, transcriptsBefore, afterSecond.tables)
  const transcriptsThen = transcriptsKept(transcriptsBefore, { exact: false })
  check(transcriptsThen.length === 0, 'the Codex transcripts only grew', transcriptsThen)
  check(
    stateKept(stateBefore, readState(data, afterSecond.tables), stateFiles).lost.length === 0,
    'after the second start, every state file the beta left still says what it said',
  )
  must(copiesAtSecondReady !== null, 'the second READY checkpoint inventory was retained')
  const sinceSecondReady = copiesSince(
    copiesAtSecondReady,
    await copies(),
    args['candidate-version'],
  )
  check(
    sinceSecondReady.same,
    'after second READY, the completed checkpoint and its bytes stayed unchanged',
    sinceSecondReady,
  )
  besideKept('after the second start', besideBefore)

  if (claudeConversation !== null) {
    summary.crash = {}
    await phase('the crash', () =>
      aCrashAfterTheSavedKey(
        summary.crash,
        stamped() && claudeDueConversation !== null ? claudeDueConversation : claudeConversation,
        claudeKeyWasSealed,
        { launch, bridge, linesOf, check, jobWordsIn, crash, quit },
      ),
    )
  }

  summary.keySavedAgain = {}
  await phase('the key saved again', () =>
    theKeySavedAgain(summary.keySavedAgain, conversations, {
      claudeConversation,
      claudeDueConversation,
      stamped: stamped(),
      jobIds: claudeJobIds,
      keyWasSealed: claudeKeyWasSealed,
    }),
  )

  if (os === 'windows' && claudeConversation !== null) {
    summary.crashMidStart = {}
    await phase('the crash mid-start', () => aCrashMidStart(summary.crashMidStart))
  }

  for (const [stage, start] of [
    ['candidate-first', summary.firstStart],
    ['candidate-second', summary.secondStart],
  ]) {
    const log = join(evidence, `${stage}.log`)
    const stopped = existsSync(log) ? lastResortStop(readFileSync(log, 'utf8')) : null
    start.stoppedByItsLastResortAfterMs = stopped
    check(stopped === null, `${stage}: the app's process left by itself when it closed`, {
      stoppedByItsLastResortAfterMs: stopped,
    })
  }

  if (runsTrimSafety)
    await runTrimUpgradeSafety(
      {
        os,
        betaVersion,
        version: args['candidate-version'],
        source: args['source-sha'],
        data,
        safetyBaseline,
        candidateSkills,
        conversations,
        answers: Object.fromEntries(conversations.map((id) => [id, answerText(betaAnswers[id])])),
        summary,
      },
      {
        phase,
        launch,
        verdict,
        bridge,
        current: () => running,
        stop,
        alive,
        crash,
        quit,
        copies,
        keep,
        must,
      },
    )

  exitCode = summary.failures.length === 0 ? 0 : 1
  if (exitCode === 0 && safetyBaseline) rmSync(safetyBaseline, { recursive: true })
}
try {
  await runUpgradePath()
} catch (error) {
  summary.failures.push(`the run stopped: ${error.message}`)
  say(`✗ the run stopped: ${error.stack ?? error.message}`)
  if (running !== null) await screenshot('where-the-run-stopped.png')
} finally {
  await stop()
  model.close()
  summary.minutes = Math.round((Date.now() - started) / 6_000) / 10
  summary.passed = exitCode === 0
  summary.result = resultLine(summary)
  keep('summary.json', summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, jobSummary(summary))
    } catch (error) {
      say(`(the job's summary could not be written: ${error.message})`)
    }
  }
  keep(
    'model.log',
    `${modelSeen.map((one) => `${one.at} ${String(one.stage)} ${one.method} ${one.url} → ${one.id} · key ${one.auth}`).join('\n')}\n`,
  )
  say(summary.result)
  keep('harness.log', `${harnessLog.join('\n')}\n`)
}
process.exit(exitCode)
