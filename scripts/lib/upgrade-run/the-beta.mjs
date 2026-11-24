import { withdrawnPublicationOf } from '../withdrawn-upgrade-beta.mjs'
import { keepSafetyBaseline } from '../upgrade-trim-safety.mjs'
import { until } from '../update-rehearsal-app.mjs'
import { checkBetaKeyContract } from '../recovery-key-contract.mjs'
import { runRecoveryMeasurement, retainRecoveryProgram } from '../recovery-measurement.mjs'
import { describeDatabase, readDatabase, whole } from '../upgrade-database.mjs'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  betaAsset,
  buildLineage,
  historyOf,
  isPublishedRelease,
  keychainEntryFor,
  sha256,
  theCandidateInstaller,
  transcriptsOf,
} from '../upgrade-path.mjs'
import { CLAUDE_FIXTURE_KEY, receiptsIn, stampingOf, startEvidence } from '../scripted-claude.mjs'
import {
  REPO,
  args,
  os,
  measurementBytes,
  runsTrimSafety,
  FIXTURE_KEY,
  WORKSPACE_NAME,
  DRAFT,
  appRoot,
  data,
  candidateNames,
  installKey,
  candidateAppName,
  summary,
  check,
  must,
  keep,
  running,
  claudeDueAt,
  setClaudeDueAt,
  setInstalled,
} from './settings.mjs'
import { run, appsEntries, bundlesOfTheApp, samePath, install } from './system.mjs'
import {
  modelPort,
  answerText,
  claudePort,
  CLAUDE_FIRST_TEXT,
  CLAUDE_JOBS,
  CLAUDE_CANCEL_ID,
  claudeOneShotAt,
  claudeSeen,
  DUE_FIRST_TEXT,
  DUE_JOB_PROMPT,
  DUE_JOB_CALL,
  CLAUDE_ROUTE,
} from './models.mjs'
import { launch, bridge, onScreen, screenshot, quit, stop } from './app.mjs'
import {
  readState,
  codexTranscripts,
  fileFacts,
  besideTheFolder,
  keychainEntries,
  observeTheSavedKey,
} from './state.mjs'
import {
  turn,
  saveTheKey,
  savedCleanly,
  historyTail,
  claudeTurn,
  claudeRanEveryCall,
  loggedBy,
  theOwedStartOnTheKey,
  FIRST_OPEN_STARTS_MS,
  startHiddenProgram,
} from './conversations.mjs'

export async function theBeta() {
  summary.names = { appId: candidateNames.appId, candidate: candidateNames.productName, installKey }
  must(
    !existsSync(appRoot) &&
      (os === 'windows' ? appsEntries().length === 0 : bundlesOfTheApp().length === 0),
    'the runner holds no install of the app and none of its data',
    { appRoot },
  )
  const migrations = join(REPO, 'apps', 'desktop', 'src', 'main', 'db', 'migrations')
  const candidateLineage = buildLineage(
    JSON.parse(readFileSync(join(migrations, 'meta', '_journal.json'), 'utf8')),
    (tag) => readFileSync(join(migrations, `${tag}.sql`), 'utf8'),
  )
  summary.candidateSchema = candidateLineage.length

  const release = JSON.parse(readFileSync(resolve(args['beta-release']), 'utf8'))
  const previousPublication = withdrawnPublicationOf(release, args['beta-tag'])
  must(
    isPublishedRelease(release, args['beta-tag']) || previousPublication,
    previousPublication
      ? `the release ${args['beta-tag']} retains its originally published assets after withdrawal`
      : `the release is ${args['beta-tag']}, a published release`,
    {
      tag: release.tag_name,
      draft: release.draft,
      publishedAt: release.published_at,
      previousPublication,
    },
  )
  summary.betaPublication = previousPublication ?? {
    tag: release.tag_name,
    currentDraft: release.draft,
    publishedAt: release.published_at,
  }
  const asset = betaAsset(release.assets, os)
  const betaFile = join(resolve(args['beta-dir']), asset.name)
  const downloaded = fileFacts(betaFile)
  summary.betaAsset = { ...asset, downloaded, publishedAt: release.published_at }
  must(
    downloaded.bytes === asset.size && downloaded.sha256 === asset.sha256,
    `the downloaded ${asset.name} has the size and SHA-256 its release publishes`,
    summary.betaAsset,
  )
  const beta = install(betaFile, `the beta (${args['beta-tag']})`)
  setInstalled(beta.exe, beta.program)
  summary.names.beta = beta.productName
  summary.betaInstall = beta.facts
  const betaVersion = os === 'windows' ? beta.facts.entries[0].DisplayVersion : beta.facts.version
  must(
    typeof betaVersion === 'string' &&
      betaVersion !== '' &&
      betaVersion !== args['candidate-version'],
    `the beta is at another version than the candidate (${args['candidate-version']})`,
    { beta: betaVersion ?? null },
  )

  if (measurementBytes > 0) {
    must(
      os === 'mac' &&
        args['recovery-proof'] &&
        args['beta-tag'] === 'v0.2.19' &&
        betaVersion === '0.2.19',
      'Representative measurement requires Mac recovery proof with actual0.2.19.',
    )
    await runRecoveryMeasurement({
      bytes: measurementBytes,
      old: retainRecoveryProgram(beta, { os, run }),
      source: args['source-sha'],
      version: args['candidate-version'],
      migrations,
      candidate: () => {
        const folder = resolve(args['candidate-dir'])
        return install(
          join(folder, theCandidateInstaller(readdirSync(folder), os, args['candidate-version'])),
          'the measured candidate',
        )
      },
      app: {
        start: (program, workspace, stage, port) =>
          startHiddenProgram(program, workspace, stage, port, {
            budget: 900_000,
            windowWithin: 900_000,
          }),
        quit,
        stop,
      },
      keep,
      run,
    })
    return null
  }

  const codexHome = join(data, 'provider-homes', 'default', 'brobot', 'codex')
  mkdirSync(codexHome, { recursive: true })
  writeFileSync(
    join(codexHome, 'config.toml'),
    [
      'model = "gpt-5.4"',
      'model_provider = "upgrade_path"',
      '',
      '[model_providers.upgrade_path]',
      'name = "A local scripted model for the upgrade-path check"',
      `base_url = "http://127.0.0.1:${String(modelPort)}/v1"`,
      'requires_openai_auth = true',
      'request_max_retries = 0',
      'stream_max_retries = 0',
      '',
    ].join('\n'),
  )

  await launch('beta', 9339)
  await bridge('the beta')
  await onScreen('the beta')
  summary.betaApp = await running.cdp.evaluate('return await window.api.getAppInfo()')
  must(
    samePath(summary.betaApp?.workspace?.path, data),
    'the beta runs on the default data folder',
    {
      workspace: summary.betaApp?.workspace,
    },
  )
  const keyed = await saveTheKey('codex', FIXTURE_KEY)
  must(savedCleanly(keyed), 'the beta saved the fictional Codex key, and was not refused', keyed)
  const conversations = []
  const betaAnswers = {}
  for (const text of [
    'Fictional first conversation: café ☕',
    'Fictional second conversation: 日本語 ✓ «quotes»',
  ]) {
    const created = await running.cdp.evaluate(
      "return await window.api.runtime.createSession({ provider: 'codex', approvalMode: 'auto' })",
      240_000,
    )
    must(typeof created?.sessionId === 'string', 'the beta started a conversation', { created })
    const made = await turn(created.sessionId, text, { resume: false })
    must(
      made.answer !== null,
      `the beta's conversation ${String(conversations.length + 1)} was answered by the local model, on the fixture key`,
      { sessionId: created.sessionId, refused: made.refused, requests: made.requests },
    )
    conversations.push(created.sessionId)
    betaAnswers[created.sessionId] = made.answer
  }
  for (const sessionId of conversations) {
    await running.cdp.evaluate(
      `return await window.api.runtime.close({ sessionId: ${JSON.stringify(sessionId)} })`,
    )
  }
  summary.conversations = conversations
  summary.betaAnswers = betaAnswers
  summary.claude = { port: claudePort, oneShotAt: claudeOneShotAt.toISOString(), keyWait: {} }
  let claudeConversation = null
  let claudeDueConversation = null
  if (claudePort !== null) {
    const claudeKeyed = await saveTheKey('claude', CLAUDE_FIXTURE_KEY)
    check(
      savedCleanly(claudeKeyed),
      'the beta saved the fictional Anthropic key, and was not refused',
      claudeKeyed,
    )
    const created = await running.cdp
      .evaluate(
        "return await window.api.runtime.createSession({ provider: 'claude', approvalMode: 'auto' })",
        240_000,
      )
      .catch((error) => ({ threw: String(error) }))
    if (
      check(typeof created?.sessionId === 'string', 'the beta started a Claude conversation', {
        created,
      })
    ) {
      claudeConversation = created.sessionId
      const made = await claudeTurn(claudeConversation, CLAUDE_FIRST_TEXT, { resume: false })
      summary.claude.beta = { sessionId: claudeConversation, ...made }
      if (made.answer === null) summary.claude.beta.history = await historyTail(claudeConversation)
      check(
        made.requests.some((one) => one.auth === 'expected'),
        `the beta’s Claude Code reached the scripted model on the fixture key, ${CLAUDE_ROUTE}`,
        { refused: made.refused, requests: made.requests },
      )
      check(
        claudeRanEveryCall(made.requests),
        'the beta’s Claude Code ran the model’s three CronCreate calls and its CronDelete',
        { requests: made.requests },
      )
      check(
        made.answer !== null,
        'the beta’s Claude conversation was answered by the scripted model',
        { refused: made.refused },
      )
      await running.cdp.evaluate(
        `return await window.api.runtime.close({ sessionId: ${JSON.stringify(claudeConversation)} })`,
      )
    }
    const due = await running.cdp
      .evaluate(
        "return await window.api.runtime.createSession({ provider: 'claude', approvalMode: 'auto' })",
        240_000,
      )
      .catch((error) => ({ threw: String(error) }))
    if (
      check(typeof due?.sessionId === 'string', 'the beta started a second Claude conversation', {
        due,
      })
    ) {
      claudeDueConversation = due.sessionId
      setClaudeDueAt(new Date(Math.ceil((Date.now() + 150_000) / 60_000) * 60_000))
      summary.claude.dueAt = claudeDueAt.toISOString()
      const made = await claudeTurn(claudeDueConversation, DUE_FIRST_TEXT, { resume: false })
      summary.claude.betaDue = { sessionId: claudeDueConversation, ...made }
      check(
        made.answer !== null && made.requests.some((one) => one.answered.includes(DUE_JOB_CALL)),
        'the beta’s Claude Code made a one-shot a few minutes ahead in the second conversation, and the turn was answered',
        { refused: made.refused, requests: made.requests },
      )
      await running.cdp.evaluate(
        `return await window.api.runtime.close({ sessionId: ${JSON.stringify(claudeDueConversation)} })`,
      )
    }
  }
  const theBetasConversations = () => [
    ...conversations,
    ...[claudeConversation, claudeDueConversation].filter((one) => one !== null),
  ]
  const theBetasConversationsSaid = () => {
    const claude = [claudeConversation, claudeDueConversation].filter((one) => one !== null).length
    return `the beta’s ${String(conversations.length)} Codex conversations${claude === 0 ? '' : claude === 1 ? ' and its Claude conversation' : ` and its ${String(claude)} Claude conversations`}`
  }
  const theStartsOwed = () => [
    ...(claudeConversation !== null && !stamped()
      ? [
          {
            of: 'claude',
            conversation: claudeConversation,
            called: 'the Claude conversation',
            prompts: [CLAUDE_JOBS.repeating.prompt, CLAUDE_JOBS.oneShot.prompt],
          },
        ]
      : []),
    ...(claudeDueConversation !== null
      ? [
          {
            of: 'due',
            conversation: claudeDueConversation,
            called: 'the second conversation',
            prompts: [DUE_JOB_PROMPT],
          },
        ]
      : []),
  ]
  const theFirstOpenStarts = () => {
    const log = loggedBy('candidate-first')
    return theStartsOwed().map((owed) => ({
      called: owed.called,
      of: owed.of,
      ...startEvidence({
        requests: claudeSeen,
        log,
        stage: 'candidate-first',
        conversation: owed.conversation,
        of: owed.of,
        prompts: owed.prompts,
      }),
    }))
  }
  const theFirstOpenTold = async () => {
    await until(
      () => theFirstOpenStarts().every((one) => one.outcome !== 'pending') || null,
      FIRST_OPEN_STARTS_MS,
      1_000,
    )
    const starts = theFirstOpenStarts()
    summary.claude.firstOpen = {
      starts: Object.fromEntries(starts.map((one) => [one.of, one])),
      requests: claudeSeen.filter((one) => one.stage === 'candidate-first'),
    }
    for (const one of starts) {
      check(
        one.outcome === (claudeKeyWasSealed ? 'refused' : 'told') &&
          (claudeKeyWasSealed || one.started === 1),
        `at its first open, the candidate’s start for ${one.called} ${claudeKeyWasSealed ? 'waits for the sealed key' : 'was made once and its words sent on the readable key'}, within ${String(FIRST_OPEN_STARTS_MS / 1_000)} s`,
        one,
      )
      if (!claudeKeyWasSealed) {
        one.delivery = {}
        await theOwedStartOnTheKey(one.delivery, one.conversation, {
          stamped: stamped(),
          jobIds: claudeJobIds,
          keyWasSealed: false,
        })
      }
    }
  }
  await screenshot('beta-first.png')
  await quit('the beta')

  await launch('beta-settled', 9338)
  await bridge('the beta, started again')
  await onScreen('the beta, started again')
  for (const sessionId of conversations) {
    const read = await running.cdp.evaluate(
      `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(sessionId)} })).includes(${JSON.stringify(answerText(betaAnswers[sessionId]))})`,
    )
    must(read === true, `the beta, started again, reads conversation ${sessionId}`)
  }
  const renamed = await running.cdp.evaluate(
    `return await window.api.workspaces.rename({ path: ${JSON.stringify(summary.betaApp.workspace.path)}, name: ${JSON.stringify(WORKSPACE_NAME)} })`,
  )
  const namedAs = (await running.cdp.evaluate('return await window.api.getAppInfo()'))?.workspace
    ?.name
  must(
    renamed?.done === true && namedAs === WORKSPACE_NAME,
    'the beta named its workspace, and says so',
    { renamed, namedAs },
  )
  const betaUpdates = await running.cdp.evaluate(
    'const set = await window.api.updates.set({ checkAutomatically: false }); return { checkAutomatically: set.checkAutomatically }',
  )
  must(betaUpdates.checkAutomatically === false, 'the beta turned automatic update checks off', {
    betaUpdates,
  })
  summary.betaUpdates = betaUpdates
  const composer = await until(
    () => running.cdp.evaluate('return document.querySelector("[data-cy=prompt-input]") !== null'),
    60_000,
  )
  must(Boolean(composer), 'the beta, started again: the composer is ready')
  await running.cdp.evaluate(
    `const field = document.querySelector('[data-cy=prompt-input]'); if (!field) throw new Error('no composer'); field.focus(); field.value = ${JSON.stringify(DRAFT)}; field.dispatchEvent(new Event('input', { bubbles: true }))`,
  )
  const drafted = await until(
    () =>
      running.cdp.evaluate(
        `return (await window.api.savedDrafts())?.drafts?.some((one) => one.text === ${JSON.stringify(DRAFT)}) ?? false`,
      ),
    60_000,
  )
  must(Boolean(drafted), 'the beta kept an unsent draft')
  await screenshot('beta-with-data.png')
  summary.betaKeyStatus = await observeTheSavedKey('the beta, started again')
  await quit('the beta, started again')
  if (claudeDueAt !== null) {
    check(
      Date.now() < claudeDueAt.getTime() - 30_000,
      'the beta was closed before the second conversation’s one-shot came within its lead, so the beta itself started nothing for it',
      { closedAt: new Date().toISOString(), dueAt: claudeDueAt.toISOString() },
    )
  }
  const before = readDatabase(data)
  const safetyBaseline =
    runsTrimSafety && ['0.2.23', '0.2.26'].includes(betaVersion) ? keepSafetyBaseline(data) : null
  // File-backed betas need no Keychain entry. Keep attributes of any entry an older beta left.
  summary.keychain = { candidateAppName, afterTheBeta: keychainEntries('after-beta') }
  if (os === 'mac')
    summary.keychain.contract = checkBetaKeyContract({
      beta: summary.betaApp,
      sealedRows: before.tables.provider_api_key?.length,
      status: { ...summary.betaKeyStatus, keyFilePresent: existsSync(join(data, 'api-keys.json')) },
      entries: summary.keychain.afterTheBeta,
      entryFor: keychainEntryFor,
      check,
    })
  const betaEntry = summary.keychain.contract?.preservedEntry ?? null
  const claudeKeyWasSealed = (before.tables.provider_api_key ?? []).some(
    (row) => row.provider === 'claude',
  )
  summary.claude.keyWasSealed = claudeKeyWasSealed
  must(whole(before), "the beta's database is whole", before.integrity)
  const claudeJobIds = {}
  let betaStamping = 'none'
  const stamped = () => betaStamping === 'stamped'
  if (claudeConversation !== null) {
    const receipts = receiptsIn(before.tables.events, claudeConversation)
    for (const [role, job] of Object.entries(CLAUDE_JOBS)) {
      claudeJobIds[role] =
        receipts.find((one) => one.toolUseId === job.call && one.tool === 'CronCreate')?.job ?? null
    }
    summary.claude.betaReceipts = receipts
    summary.claude.jobIds = claudeJobIds
    const dueReceipts =
      claudeDueConversation === null ? [] : receiptsIn(before.tables.events, claudeDueConversation)
    summary.claude.dueReceipts = dueReceipts
    betaStamping = stampingOf([...receipts, ...dueReceipts])
    summary.claude.betaStamping = betaStamping
    check(
      betaStamping === 'stamped' || betaStamping === 'unstamped',
      `the beta’s receipts are all stamped or all unstamped (${betaStamping})`,
      [...receipts, ...dueReceipts],
    )
    check(
      Object.values(claudeJobIds).every((id) => typeof id === 'string') &&
        new Set(Object.values(claudeJobIds)).size === 3,
      'the beta recorded the three jobs its Claude conversation made, each with the id its call answered',
      receipts,
    )
    check(
      receipts.some(
        (one) =>
          one.toolUseId === CLAUDE_CANCEL_ID &&
          one.tool === 'CronDelete' &&
          one.asked === claudeJobIds.cancelled &&
          one.job === claudeJobIds.cancelled,
      ),
      'the beta recorded the cancellation of the third job, its result naming the job it was asked to cancel',
      receipts,
    )
  }

  const history = historyOf(before.tables, conversations)
  const ownTranscripts = transcriptsOf(history, codexTranscripts())
  const transcriptsBefore = Object.fromEntries(
    Object.entries(ownTranscripts).map(([conversation, path]) => [
      conversation,
      { path, ...fileFacts(join(data, path)) },
    ]),
  )
  const filesBefore = readState()
  const stateBefore = readState(data, before.tables)
  const besideBefore = besideTheFolder(args['beta-registry'])
  summary.baseline = {
    history,
    transcripts: transcriptsBefore,
    database: describeDatabase(before),
    state: Object.fromEntries(
      Object.entries(stateBefore).map(([name, bytes]) => [name, sha256(bytes)]),
    ),
    besideTheFolder: besideBefore,
  }
  keep('baseline.json', summary.baseline)
  return {
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
  }
}
