import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { digest } from './mac-update-test.mjs'
import { proofManifests, completedProofCopy, checkedProofCopy } from './recovery-measurement.mjs'
import { until } from './update-rehearsal-app.mjs'
import { recoveryProofSequence, startOrder, stateKept, READY_LINE } from './upgrade-path.mjs'

export async function recoveryProofCases(
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
    current,
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
) {
  const proof = recoveryProofSequence({
    launch,
    currentPid: () => current()?.pid,
    alive,
    phase,
    check,
  })
  const result = (summary.recoveryProof = { upgrade: {}, syntheticFuture: {} })
  const ids = new Set((await proofManifests(data)).map((one) => one.manifest.id))
  try {
    const state = readState()
    const cases = {
      upgrade: async () => {
        await startHiddenProgram(candidate, data, 'proof-candidate', 9350, {
          launchProgram: proof.launch,
        })
        const info = await current().cdp.evaluate('return await window.api.getAppInfo()')
        must(
          info.version === args['candidate-version'],
          'The installed candidate version answered.',
          {
            version: info.version,
          },
        )
        must(
          info.build?.commit === args['source-sha'],
          'The candidate source identity answered.',
          info.build,
        )
        for (const id of conversations) {
          const read = await current().cdp.evaluate(
            `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(id)} }))`,
          )
          must(
            read.includes(answerText(betaAnswers[id])),
            'The upgraded candidate reads the seeded history.',
            {
              id,
            },
          )
        }
        const copy = await completedProofCopy(data, ids)
        await until(() => readFileSync(current().log, 'utf8').includes(READY_LINE), 10_000, 100)
        result.upgrade.copy = await checkedProofCopy(
          copy,
          {
            reason: 'before-migration',
            version: args['candidate-version'],
            build: args['source-sha'],
            lineage: before.lineage,
          },
          state,
          stateFiles,
          must,
        )
        result.upgrade.order = startOrder(readFileSync(current().log, 'utf8'), {
          checkpoint: true,
        })
        must(
          info.db?.migrationsApplied === candidateLineage.length,
          'The candidate applied its remaining migrations after the completed copy.',
          info.db,
        )
        await quit('proof candidate completed')
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
        await proof.launch('proof-candidate-recovery', 9353, {
          workspace: data,
          hidden: true,
          recovery: true,
        })
        const shown = () =>
          current().cdp.evaluate(
            'return document.querySelector("[data-cy=recovery]")?.dataset.verdict',
          )
        const verdict = await until(
          async () => {
            const screen = await shown()
            return screen && screen !== 'working'
              ? current().cdp.evaluate('return window.recovery.verdict()')
              : null
          },
          600_000,
          100,
        )
        must(
          verdict?.kind === 'newer' && verdict.offers?.id === result.upgrade.copy.id,
          'The candidate offers its before-migration copy.',
          verdict,
        )
        await current().cdp.evaluate(
          'document.querySelector("[data-cy=recovery-restore]").click(); return true',
        )
        must(
          await until(
            () =>
              current().cdp.evaluate(
                'return document.querySelector("[data-cy=recovery-return]")?.disabled === false',
              ),
            600_000,
            100,
          ),
          'The candidate entered restored history.',
        )
        for (const id of conversations) {
          const read = await current().cdp.evaluate(
            `return JSON.stringify(await window.recovery.history.transcript(${JSON.stringify(id)}))`,
          )
          must(
            read.includes(answerText(betaAnswers[id])),
            'The candidate reads the restored transcript.',
            {
              id,
            },
          )
        }
        await current().cdp.evaluate(
          'document.querySelector("[data-cy=recovery-return]").click(); return true',
        )
        must(
          await until(async () => (await shown()) === 'newer', 600_000, 100),
          'The candidate returned to the newer state.',
        )
        await quit('proof candidate Return')
        must(
          (await digest(join(data, 'brobot2.sqlite'))) === newer,
          'Return preserved the synthetic newer database exactly.',
        )
        must(
          stateKept(newerState, readState(), stateFiles).lost.length === 0,
          'Return preserved coupled state.',
        )
        besideKept('proof candidate Return kept current', besideBefore)
        result.syntheticFuture.restoreReturn = true
      },
    }
    await proof.collect(result, cases, { state, readState, stateFiles })
  } finally {
    keep('recovery-proof.json', result)
    await stop()
  }
}
