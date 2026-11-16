import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { digest } from './mac-update-test.mjs'
import { proofManifests, completedProofCopy, checkedProofCopy } from './recovery-measurement.mjs'
import { until } from './update-rehearsal-app.mjs'
import {
  recoveryProofSequence,
  startOrder,
  makeEarlierMigrationFixture,
  stateKept,
  CHECKPOINT_LINE,
} from './upgrade-path.mjs'

export async function recoveryProofCases(
  {
    old,
    candidate,
    before,
    candidateLineage,
    migrations,
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
    current,
    useProgram,
    alive,
    phase,
    check,
    startHiddenProgram,
    bridge,
    onScreen,
    must,
    answerText,
    quit,
    readState,
    besideKept,
    keep,
    stop,
  },
) {
  const proof = recoveryProofSequence({
    launch,
    currentPid: () => current()?.pid,
    alive,
    phase,
    check,
  })
  async function proofOrdinary(program, folder, stage, port) {
    await startHiddenProgram(program, folder, stage, port, { launchProgram: proof.launch })
    const info = await current().cdp.evaluate('return await window.api.getAppInfo()')
    const responsive = performance.now()
    const manifestAbsent = !(await proofManifests(folder)).some((one) => !ids.has(one.manifest.id))
    const absent = performance.now()
    must(
      info.version === (program === candidate ? args['candidate-version'] : '0.2.19'),
      `${stage}: actual binary version answered.`,
      { version: info.version },
    )
    if (program === candidate)
      must(
        info.build?.commit === args['source-sha'],
        `${stage}: candidate source identity answered.`,
        info.build,
      )
    for (const id of conversations) {
      const read = await current().cdp.evaluate(
        `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(id)} }))`,
      )
      must(
        read.includes(answerText(betaAnswers[id])),
        `${stage}: seeded history survives in the actual binary.`,
        { id },
      )
    }
    return { launched: current().launchedMono, responsive, absent, manifestAbsent }
  }

  const result = (summary.recoveryProof = { compatible: {}, syntheticFuture: {}, synchronous: {} })
  const ids = new Set((await proofManifests(data)).map((one) => one.manifest.id))
  try {
    const state = readState()
    const cases = {
      compatible: async () => {
        const observed = await proofOrdinary(candidate, data, 'proof-candidate', 9350)
        const copy = await completedProofCopy(data, ids)
        observed.completed = performance.now()
        await until(
          () => readFileSync(current().log, 'utf8').includes(CHECKPOINT_LINE),
          10_000,
          100,
        )
        result.compatible.observed = observed
        result.compatible.copy = await checkedProofCopy(
          copy,
          {
            reason: 'first-start-of-release',
            version: args['candidate-version'],
            build: args['source-sha'],
            lineage: before.lineage,
          },
          state,
          stateFiles,
          must,
        )
        result.compatible.order = startOrder(readFileSync(current().log, 'utf8'), {
          checkpoint: true,
          completion: 'functional-background',
          observation: observed,
        })
        await quit('proof candidate completed')
      },
      compatible019: async () => {
        await proofOrdinary(old, data, 'proof-019-compatible', 9351)
        await quit('proof019 compatible')
        await proofOrdinary(candidate, data, 'proof-candidate-again', 9352)
        await quit('proof candidate again')
        result.compatible.actual019ThenCandidate = true
      },
      syntheticFuture: async () => {
        const { runnerImport } = await import(
          pathToFileURL(join(REPO, 'apps/desktop/node_modules/vite/dist/node/index.js')).href
        )
        const { module } = await runnerImport(
          join(REPO, 'apps/desktop/test/recovery/lib/recovery-fixture.ts'),
          { configFile: false, root: join(REPO, 'apps/desktop'), logLevel: 'error' },
        )
        const db = new DatabaseSync(join(data, 'brobot2.sqlite'))
        try {
          db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
            module.NEWER_MIGRATION.hash,
            module.NEWER_MIGRATION.createdAt,
          )
        } finally {
          db.close()
        }
        result.syntheticFuture.label =
          'Existing synthetic NEWER_MIGRATION; not a shipping candidate migration.'
        result.syntheticFuture.migration = module.NEWER_MIGRATION
        const newer = await digest(join(data, 'brobot2.sqlite'))
        const newerState = readState()
        useProgram(old)
        await proof.launch('proof-019-recovery', 9353, {
          workspace: data,
          hidden: true,
          recovery: true,
        })
        const verdict = await until(
          async () => {
            const verdict = await current().cdp.evaluate('return window.recovery?.verdict()')
            return verdict?.kind === 'working' ? null : verdict
          },
          600_000,
          100,
        )
        must(
          verdict?.kind === 'newer' && verdict.offers?.id === result.compatible.copy.id,
          'Actual019 offers the candidate-created v1 snapshot.',
          verdict,
        )
        await current().cdp.evaluate(
          'document.querySelector("[data-cy=recovery-restore]").click(); return true',
        )
        must(
          await until(
            async () =>
              (await current().cdp.evaluate('return window.recovery.verdict()')).kind ===
              'history-only',
            600_000,
            100,
          ),
          'Actual019 entered restored history.',
        )
        for (const id of conversations) {
          const read = await current().cdp.evaluate(
            `return JSON.stringify(await window.recovery.history.transcript(${JSON.stringify(id)}))`,
          )
          must(
            read.includes(answerText(betaAnswers[id])),
            'Actual019 reads the restored transcript.',
            {
              id,
            },
          )
        }
        await current().cdp.evaluate(
          'document.querySelector("[data-cy=recovery-return]").click(); return true',
        )
        must(
          await until(
            async () =>
              (await current().cdp.evaluate('return window.recovery.verdict()')).kind === 'newer',
            600_000,
            100,
          ),
          'Actual019 returned to the newer state.',
        )
        await quit('proof019 Return')
        must(
          (await digest(join(data, 'brobot2.sqlite'))) === newer,
          'Return preserved the synthetic newer database exactly.',
        )
        must(
          stateKept(newerState, readState(), stateFiles).lost.length === 0,
          'Return preserved coupled state.',
        )
        besideKept('proof019 Return kept current', besideBefore)
        result.syntheticFuture.actual019RestoreReturn = true
      },
      synchronous: async () => {
        const root = mkdtempSync(join(tmpdir(), 'upgrade-prefix-'))
        result.synchronous.workspace = root
        const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'))
        const prefix = new DatabaseSync(join(root, 'brobot2.sqlite'))
        let lineage
        try {
          lineage = makeEarlierMigrationFixture(prefix, journal, (tag) =>
            readFileSync(join(migrations, `${tag}.sql`), 'utf8'),
          )
        } finally {
          prefix.close()
        }
        const state = readState(root)
        must(
          (await proofManifests(root)).length === 0,
          'The earlier prefix has no completed fallback.',
        )
        useProgram(candidate)
        await proof.launch('proof-synchronous', 9354, { workspace: root, hidden: true })
        await bridge('proof synchronous')
        await onScreen('proof synchronous', true)
        const copy = await completedProofCopy(root, new Set())
        result.synchronous.copy = await checkedProofCopy(
          copy,
          {
            reason: 'before-migration',
            version: args['candidate-version'],
            build: args['source-sha'],
            lineage,
          },
          state,
          stateFiles,
          must,
        )
        result.synchronous.order = startOrder(readFileSync(current().log, 'utf8'), {
          checkpoint: true,
        })
        await quit('proof synchronous')
        const db = new DatabaseSync(join(root, 'brobot2.sqlite'), { readOnly: true })
        try {
          must(
            db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get().n ===
              candidateLineage.length,
            'The real remaining migration applied after the completed snapshot.',
          )
        } finally {
          db.close()
        }
      },
    }
    await proof.collect(result, cases, { state, readState, stateFiles })
  } finally {
    keep('recovery-proof.json', result)
    await stop()
    if (proof.closed() && result.synchronous.workspace)
      rmSync(result.synchronous.workspace, { recursive: true, force: true })
    if (proof.closed()) rmSync(old.root, { recursive: true, force: true })
  }
}
