// Read-only external acceptance. It never dispatches and cannot mint an operation admission.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { demand, receipt, hash, readFile, appSourceFor } from './contract.mjs'

export function verifyOperation(expected, evidence, summaryBytes) {
  const summary = JSON.parse(summaryBytes),
    observed = summary.observedIdentity
  const publicPlan = JSON.parse(
    readFile(fileURLToPath(new URL('./public-checks-plan.json', import.meta.url))),
  )
  demand(
    expected?.schema === 2 &&
      expected.executionAdmitted === true &&
      expected.operator === 'Jae31.4',
  )
  demand(expected.scope === 'synthetic-v2-review' && expected.publicationApproved === false)
  for (const k of ['routeCommit', 'routeTree']) demand(/^[a-f0-9]{40}$/.test(expected[k]))
  for (const k of [
    'sourcePlanSha256',
    'workflowSha256',
    'routePolicySha256',
    'brokerPolicySha256',
    'publicChecksWorkflowSha256',
    'reviewSha256',
  ])
    demand(/^[a-f0-9]{64}$/.test(expected[k]))
  demand(expected.repository === 'brocrew/brocrew' && expected.event === 'workflow_dispatch')
  demand(/^refs\/heads\/gate\/plugin-v2-(mac|windows)-[a-z0-9-]+$/.test(expected.ref))
  demand(['0.1.7', '0.1.8'].includes(expected.appVersion))
  demand(expected.appSource === appSourceFor(expected.appVersion, expected.routeCommit))
  demand(
    (expected.platform === 'darwin' &&
      expected.arch === 'arm64' &&
      expected.workflow === '.github/workflows/macos.yml' &&
      expected.ref.startsWith('refs/heads/gate/plugin-v2-mac-')) ||
      (expected.platform === 'win32' &&
        expected.arch === 'x64' &&
        expected.workflow === '.github/workflows/windows.yml' &&
        expected.ref.startsWith('refs/heads/gate/plugin-v2-windows-')),
  )
  for (const k of [
    'repository',
    'ref',
    'event',
    'routeCommit',
    'routeTree',
    'sourcePlanSha256',
    'workflowSha256',
    'routePolicySha256',
  ])
    demand(expected[k] === observed?.[k])
  demand(
    expected.workflow === observed.workflow &&
      expected.appVersion === observed.appVersion &&
      expected.appSource === observed.appSource,
  )
  demand(expected.platform === observed.platform && expected.arch === observed.arch)
  demand(
    observed.identityAuthority === 'observed-awaiting-external-operator-contract' &&
      observed.externalAdmissionVerified === null,
  )
  // This external record comes from the existing broker/API readback, never from the app.
  demand(
    evidence?.source === 'operator-broker-api-readback' &&
      evidence.repository === expected.repository,
  )
  demand(
    evidence.workflow === expected.workflow &&
      evidence.headSha === expected.routeCommit &&
      evidence.ref === expected.ref &&
      evidence.event === expected.event,
  )
  demand(
    evidence.runId === observed.runId &&
      evidence.attempt === observed.attempt &&
      /^\d+$/.test(evidence.runId) &&
      /^\d+$/.test(evidence.attempt),
  )
  demand(
    evidence.jobKey === 'plugin-v2-review' &&
      evidence.jobName === `Plugin v2 Review (${expected.appVersion})`,
  )
  demand(/^\d+$/.test(String(evidence.jobId)) && Number(evidence.jobId) > 0)
  demand(
    evidence.appVersion === expected.appVersion &&
      evidence.conclusion === 'success' &&
      evidence.workflowConclusion === 'success',
  )
  demand(evidence.reviewSha256 === expected.reviewSha256)
  demand(evidence.brokerReceipt?.policy_sha256 === expected.brokerPolicySha256)
  // Full matrix job census and automatic public checks come from independent API readback.
  demand(Array.isArray(evidence.matrixJobs) && evidence.matrixJobs.length === 2)
  demand(new Set(evidence.matrixJobs.map((j) => String(j.id))).size === 2)
  for (const version of ['0.1.7', '0.1.8']) {
    const job = evidence.matrixJobs.find((j) => j.name === `Plugin v2 Review (${version})`)
    demand(
      job && /^\d+$/.test(String(job.id)) && Number(job.id) > 0 && job.conclusion === 'success',
    )
    if (version === expected.appVersion) demand(String(job.id) === String(evidence.jobId))
  }
  demand(expected.publicChecksWorkflowSha256 === publicPlan.workflowSha256)
  demand(
    JSON.stringify(expected.requiredPublicChecks) === JSON.stringify(Object.keys(publicPlan.jobs)),
  )
  const publicRun = evidence.publicChecks
  demand(
    publicRun &&
      publicRun.workflow === publicPlan.workflow &&
      publicRun.workflowSha256 === publicPlan.workflowSha256,
  )
  demand(
    publicRun.event === 'push' &&
      publicRun.ref === expected.ref &&
      publicRun.headSha === expected.routeCommit &&
      publicRun.conclusion === 'success',
  )
  demand(/^\d+$/.test(publicRun.runId) && /^\d+$/.test(publicRun.attempt))
  demand(
    Array.isArray(publicRun.jobs) && publicRun.jobs.length === Object.keys(publicPlan.jobs).length,
  )
  demand(new Set(publicRun.jobs.map((j) => j.name)).size === publicRun.jobs.length)
  for (const [name, policy] of Object.entries(publicPlan.jobs)) {
    const job = publicRun.jobs.find((c) => c.name === name)
    demand(job && /^\d+$/.test(String(job.id)) && job.conclusion === 'success')
    for (const step of policy.required_steps) {
      const matched = job.steps?.filter((s) => s.name === step)
      demand(matched?.length === 1 && matched[0].conclusion === 'success')
    }
  }

  for (const name of [
    'Plugin qualification source controls',
    'Stage the observed ref-selected source plan',
    'Install the frozen app source dependencies in scratch',
    'Product HTTPS then projected package Review journey',
    'Keep the closed required evidence',
  ])
    demand(evidence.steps?.some((s) => s.name === name && s.conclusion === 'success'))
  const ordinary =
    expected.platform === 'darwin'
      ? ['flags', 'macos', 'guided-update-rehearsal', 'recovery-real-entry']
      : ['flags', 'windows', 'recovery-real-entry']
  demand(Array.isArray(evidence.ordinaryJobs) && evidence.ordinaryJobs.length === ordinary.length)
  demand(new Set(evidence.ordinaryJobs.map((j) => j.id)).size === ordinary.length)
  demand(evidence.ordinaryJobs.every((j) => ordinary.includes(j.id) && j.conclusion === 'skipped'))
  demand(evidence.summarySha256 === hash(summaryBytes) && summary.passed === true)
  demand(
    evidence.artifact ===
      `plugin-v2-${expected.platform === 'darwin' ? 'macos' : 'windows'}-${expected.appVersion}`,
  )
  receipt(summary)
  return {
    accepted: true,
    scope: 'synthetic-v2-review',
    publication: false,
    personalCutover: false,
    controlledOwnerCompatibility: summary.controlledOwnerCompatibility ?? null,
    final018Qualification: null,
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [contract, evidence, summary] = process.argv.slice(2)
    const answer = verifyOperation(
      JSON.parse(fs.readFileSync(contract)),
      JSON.parse(fs.readFileSync(evidence)),
      fs.readFileSync(summary),
    )
    console.log(JSON.stringify(answer))
  } catch {
    console.error('Plugin v2 external operation acceptance refused')
    process.exitCode = 1
  }
}
