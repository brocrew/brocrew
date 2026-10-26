// External read-only companion acceptance; never dispatches or admits an operation.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { demand, hash, readFile } from './contract.mjs'
import { verifyOperation } from './verify-operation.mjs'
import { assertMainAppBehavior } from './reload-source/contract.mjs'

export function verifyReload(expected, catalogueEvidence, catalogueBytes, evidence, bytes) {
  verifyOperation(expected, catalogueEvidence, catalogueBytes)
  demand(
    expected.platform === 'win32' &&
      expected.appVersion === '0.1.8' &&
      expected.appSource === expected.routeCommit,
  )
  const value = JSON.parse(bytes),
    observed = value.observedIdentity
  const catalogue = JSON.parse(catalogueBytes)
  demand(JSON.stringify(observed) === JSON.stringify(catalogue.observedIdentity))
  demand(
    value.schema === 1 &&
      value.scope === 'controlled-main-app-reload' &&
      value.passed === true &&
      value.publicBinary === false &&
      value.publication === false,
  )
  demand(value.realSdk === null && value.final018Qualification === null)
  demand(value.normalSourceRefused === true && value.normalOutputRefused === true)
  demand(value.cleanup?.directClosed === true && value.cleanup.twoEmptySamples === true)
  demand(/^[a-f0-9]{64}$/.test(value.packageSha256) && value.bundle?.controlledSdkRefusal === true)
  for (const name of ['mainSha256', 'preloadSha256'])
    demand(/^[a-f0-9]{64}$/.test(value.bundle[name]))
  const runtimePins = JSON.parse(
    readFile(fileURLToPath(new URL('./runtime-source-pins.json', import.meta.url))),
  )
  demand(value.runtimeSourcePinsSha256 === hash(Buffer.from(JSON.stringify(runtimePins))))
  const pins = JSON.parse(readFile(fileURLToPath(new URL('./reload-inputs.json', import.meta.url))))
  demand(
    value.moduleSource?.commit === pins.sourceCommit &&
      value.moduleSource.tree === pins.sourceTree &&
      value.moduleSource.manifestSha256 === pins.manifestSha256,
  )
  demand(
    JSON.stringify(value.moduleSource.files) ===
      JSON.stringify(pins.modules.map(({ name, sha256, bytes }) => ({ name, sha256, bytes }))),
  )
  assertMainAppBehavior(value.journey?.behavior)
  demand(value.journey.nativeDatabaseClosed === true && value.journey.nativeAppClosed === true)
  const ipc = value.journey.nativeIpc
  demand(
    ipc &&
      Object.keys(ipc).sort().join(',') ===
        'createdViaNormalPreload,nonceAndOpRefused,sampledDistinctActualArrivals,threePendingBeforeExit,threeRealSends,threeResolvedAfterExit',
  )
  demand(Object.values(ipc).every((v) => v === true))
  demand(
    evidence?.source === 'operator-broker-api-readback' &&
      evidence.artifact === 'plugin-reload-windows-0.1.8' &&
      evidence.summarySha256 === hash(bytes),
  )
  for (const key of [
    'repository',
    'workflow',
    'headSha',
    'ref',
    'event',
    'runId',
    'attempt',
    'jobKey',
    'jobName',
    'jobId',
    'conclusion',
    'workflowConclusion',
  ])
    demand(evidence[key] === catalogueEvidence[key])
  demand(
    evidence.brokerReceipt?.policy_sha256 === expected.brokerPolicySha256 &&
      evidence.reviewSha256 === expected.reviewSha256,
  )
  for (const name of [
    'Stage dedicated main-app reload source (0.1.8)',
    'Install dedicated reload dependencies in owned scratch',
    'Controlled main-app reload queue (0.1.8)',
    'Keep controlled main-app reload evidence',
  ]) {
    const rows = evidence.steps?.filter((s) => s.name === name)
    demand(rows?.length === 1 && rows[0].conclusion === 'success')
  }
  return {
    accepted: true,
    scope: 'controlled-main-app-reload',
    publication: false,
    realSdk: null,
    final018Qualification: null,
  }
}
// Independent SDK-only acceptance: never borrows a catalogue or controlled-main-app PASS.
export function verifySdkReload(expected, evidence, bytes) {
  const value = JSON.parse(bytes),
    observed = value.observedIdentity
  demand(
    expected?.schema === 1 &&
      expected.scope === 'real-sdk-start-reload' &&
      expected.executionAdmitted === true,
  )
  demand(expected.operator === 'Jae31.4' && expected.publicationApproved === false)
  demand(expected.repository === 'brocrew/brocrew' && expected.event === 'workflow_dispatch')
  demand(/^[a-f0-9]{40}$/.test(expected.routeCommit) && /^[a-f0-9]{40}$/.test(expected.routeTree))
  demand(expected.sdkAppSource === expected.routeCommit)
  for (const key of [
    'sourcePlanSha256',
    'workflowSha256',
    'routePolicySha256',
    'brokerPolicySha256',
    'reviewSha256',
    'programSha256',
    'sdkEntrySha256',
  ])
    demand(/^[a-f0-9]{64}$/.test(expected[key]))
  demand(expected.sdkVersion === '0.3.287' && expected.cliVersion === '2.1.290')
  const mac =
    expected.platform === 'darwin' &&
    expected.arch === 'arm64' &&
    expected.workflow === '.github/workflows/macos.yml'
  const windows =
    expected.platform === 'win32' &&
    expected.arch === 'x64' &&
    expected.workflow === '.github/workflows/windows.yml'
  demand(mac || windows)
  demand(
    new RegExp(`^refs/heads/gate/plugin-v2-${mac ? 'mac' : 'windows'}-sdk-[a-z0-9-]+$`).test(
      expected.ref,
    ),
  )
  for (const key of [
    'repository',
    'event',
    'workflow',
    'ref',
    'routeCommit',
    'routeTree',
    'platform',
    'arch',
    'sourcePlanSha256',
    'workflowSha256',
    'routePolicySha256',
  ])
    demand(observed?.[key] === expected[key])
  demand(
    observed.identityAuthority === 'observed-awaiting-external-operator-contract' &&
      observed.externalAdmissionVerified === null,
  )
  demand(
    value.schema === 1 &&
      value.scope === 'real-sdk-start-reload' &&
      value.passed === true &&
      !value.failure,
  )
  demand(
    value.publicBinary === false &&
      value.publication === false &&
      value.personalCutover === false &&
      value.final018Qualification === null &&
      value.sdkAppSource === expected.routeCommit,
  )
  demand(
    value.startControl === true && value.reloadControl === true && value.fixtureClosed === true,
  )
  demand(value.cleanup?.directClosed === true && value.cleanup.twoEmptySamples === true)
  demand(
    value.sdk?.name === '@anthropic-ai/claude-agent-sdk' &&
      value.sdk.expectedVersion === expected.sdkVersion &&
      value.sdk.version === expected.sdkVersion &&
      value.sdk.entrySha256 === expected.sdkEntrySha256,
  )
  demand(
    value.cli?.expectedVersion === expected.cliVersion &&
      value.cli.version === expected.cliVersion &&
      value.cli.programSha256 === expected.programSha256,
  )
  for (const key of ['manifestSha256', 'packageSha256', 'lockSha256'])
    demand(/^[a-f0-9]{64}$/.test(value.cli[key]))
  demand(
    value.cli.programIdentity &&
      ['dev', 'ino', 'birthtimeNs', 'size', 'nlink', 'mtimeNs', 'ctimeNs'].every((key) =>
        /^\d+$/.test(value.cli.programIdentity[key]),
      ),
  )
  demand(
    Object.keys(value.children ?? {})
      .sort()
      .join(',') === 'reload,start',
  )
  for (const child of Object.values(value.children)) {
    demand(Number.isSafeInteger(child.pid) && child.pid > 0 && child.exit !== null)
    demand(child.exit.code === null || Number.isInteger(child.exit.code))
    demand(child.exit.signal === null || /^SIG[A-Z0-9]+$/.test(child.exit.signal))
  }
  const ack = value.reloadAck
  demand(
    ack?.state === 'fulfilled' &&
      Number.isFinite(ack.latencyMs) &&
      ack.latencyMs >= 0 &&
      ack.latencyMs < 10000,
  )
  demand(ack.arrays === true && ack.errorCount === 0 && ack.ownedPlugin === true)
  demand(expected.sourceFiles && Object.keys(expected.sourceFiles).length >= 9)
  demand(JSON.stringify(value.sourceFiles) === JSON.stringify(expected.sourceFiles))
  for (const digest of Object.values(value.sourceFiles)) demand(/^[a-f0-9]{64}$/.test(digest))
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
      evidence.jobName === 'Plugin v2 Review (0.1.8)' &&
      value.jobKey === evidence.jobKey &&
      value.jobName === evidence.jobName,
  )
  demand(/^\d+$/.test(String(evidence.jobId)) && Number(evidence.jobId) > 0)
  demand(evidence.conclusion === 'success' && evidence.workflowConclusion === 'success')
  demand(
    evidence.reviewSha256 === expected.reviewSha256 &&
      evidence.brokerReceipt?.policy_sha256 === expected.brokerPolicySha256,
  )
  const names = [
    'Assert installed SDK role scope',
    'Stage owned installed SDK reload source',
    'Install pinned installed SDK probe dependencies',
    'Installed SDK start and reload probe',
    'Keep closed installed SDK reload evidence',
  ]
  demand(
    Object.keys(value.arms ?? {})
      .sort()
      .join(',') === 'reload,start',
  )
  for (const arm of ['start', 'reload'])
    demand(value.arms[arm]?.name === arm && value.arms[arm].executed === 1)
  for (const name of names) {
    const rows = evidence.steps?.filter((s) => s.name === name)
    demand(rows?.length === 1 && rows[0].conclusion === 'success')
  }
  // The two pre-existing matrix names stay active;017 proves only source/scope scaffolding.
  demand(Array.isArray(evidence.matrixJobs) && evidence.matrixJobs.length === 2)
  demand(new Set(evidence.matrixJobs.map((j) => String(j.id))).size === 2)
  const catalogue = [
    'Stage the observed ref-selected source plan',
    'Install the frozen app source dependencies in scratch',
    'Product HTTPS then projected package Review journey',
    'Keep the closed required evidence',
  ]
  if (windows)
    catalogue.push(
      'Stage dedicated main-app reload source (0.1.8)',
      'Install dedicated reload dependencies in owned scratch',
      'Controlled main-app reload queue (0.1.8)',
      'Keep controlled main-app reload evidence',
    )
  for (const version of ['0.1.7', '0.1.8']) {
    const job = evidence.matrixJobs.find((j) => j.name === `Plugin v2 Review (${version})`)
    demand(
      job && /^\d+$/.test(String(job.id)) && Number(job.id) > 0 && job.conclusion === 'success',
    )
    if (version === '0.1.8') demand(String(job.id) === String(evidence.jobId))
    const setup = [
      'Run actions/checkout@v7',
      'Run pnpm/action-setup@v6',
      'Run actions/setup-node@v7',
      'Plugin qualification source controls',
    ]
    if (windows) setup.push('Preserve committed line endings')
    for (const name of setup) {
      const rows = job.steps?.filter((s) => s.name === name)
      demand(rows?.length === 1 && rows[0].conclusion === 'success')
    }
    for (const name of names) {
      const rows = job.steps?.filter((s) => s.name === name)
      demand(
        rows?.length === 1 &&
          rows[0].conclusion === (version === '0.1.8' || name === names[0] ? 'success' : 'skipped'),
      )
    }
    for (const name of catalogue) {
      const rows = job.steps?.filter((s) => s.name === name)
      demand(rows?.length === 1 && rows[0].conclusion === 'skipped')
    }
  }
  const ordinary = mac
    ? ['flags', 'macos', 'guided-update-rehearsal', 'recovery-real-entry']
    : ['flags', 'windows', 'recovery-real-entry']
  demand(Array.isArray(evidence.ordinaryJobs) && evidence.ordinaryJobs.length === ordinary.length)
  demand(new Set(evidence.ordinaryJobs.map((j) => j.id)).size === ordinary.length)
  demand(evidence.ordinaryJobs.every((j) => ordinary.includes(j.id) && j.conclusion === 'skipped'))
  const plan = JSON.parse(
    readFile(fileURLToPath(new URL('./public-checks-plan.json', import.meta.url))),
  )
  const pub = evidence.publicChecks
  demand(
    pub?.workflow === plan.workflow &&
      pub.workflowSha256 === plan.workflowSha256 &&
      pub.event === 'push' &&
      pub.ref === expected.ref &&
      pub.headSha === expected.routeCommit &&
      pub.conclusion === 'success',
  )
  demand(
    /^\d+$/.test(pub.runId) &&
      /^\d+$/.test(pub.attempt) &&
      pub.jobs?.length === Object.keys(plan.jobs).length,
  )
  for (const [name, policy] of Object.entries(plan.jobs)) {
    const jobs = pub.jobs.filter((j) => j.name === name)
    demand(jobs.length === 1 && jobs[0].conclusion === 'success')
    demand(/^\d+$/.test(String(jobs[0].id)))
    for (const step of policy.required_steps) {
      const rows = jobs[0].steps?.filter((s) => s.name === step)
      demand(rows?.length === 1 && rows[0].conclusion === 'success')
    }
  }
  demand(
    evidence.artifact === `sdk-reload-${mac ? 'macos' : 'windows'}-0.1.8` &&
      evidence.summarySha256 === hash(bytes),
  )
  return {
    accepted: true,
    scope: 'real-sdk-start-reload',
    sdk: '0.3.287',
    cli: '2.1.290',
    publication: false,
    final018Qualification: null,
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'sdk') {
      const [contract, api, summary] = process.argv.slice(3)
      console.log(
        JSON.stringify(
          verifySdkReload(
            JSON.parse(fs.readFileSync(contract)),
            JSON.parse(fs.readFileSync(api)),
            fs.readFileSync(summary),
          ),
        ),
      )
    } else {
      const [operation, catAPI, catSummary, reloadAPI, reloadSummary] = process.argv.slice(2)
      const result = verifyReload(
        JSON.parse(fs.readFileSync(operation)),
        JSON.parse(fs.readFileSync(catAPI)),
        fs.readFileSync(catSummary),
        JSON.parse(fs.readFileSync(reloadAPI)),
        fs.readFileSync(reloadSummary),
      )
      console.log(JSON.stringify(result))
    }
  } catch {
    console.error('Reload companion acceptance refused')
    process.exitCode = 1
  }
}
