const release = {
  tag: 'v0.2.39',
  source: '6d1937e4ebf33f6fde2de8888883308023e91294',
  run: 45675584799,
  attempt: 1,
  windows: 15051303619,
  mac: 15052023547,
}
const predecessor = {
  tag: 'v0.2.37',
  source: 'a4287737be82efe4da81619e8085433b82142029',
}
const upgrade = {
  run: 45685816909,
  attempt: 1,
  branch: 'qualify/final039-upgrade-harness-6e6f94d7',
  source: '6e6f94d77155a25723842a827d4cbc08bee97fe7',
}

function requireEvidence(ok, issue) {
  if (!ok) throw new Error(issue)
}

function successfulJob(jobs, name) {
  const job = jobs.find((entry) => entry.name === name)
  requireEvidence(job?.conclusion === 'success', `${name} must succeed.`)
  return job
}

function successfulStep(job, name) {
  requireEvidence(
    job.steps?.some((step) => step.name === name && step.conclusion === 'success'),
    `${job.name}: ${name} must succeed.`,
  )
}

function originalArtifact(artifact, id, platform) {
  return (
    artifact.id === id &&
    artifact.expired === false &&
    artifact.name === `release-${platform}-${release.attempt}` &&
    artifact.workflow_run?.id === release.run &&
    artifact.workflow_run?.head_sha === release.source
  )
}

export async function verifyFinal039Runs(github, repo) {
  const { actions, repos } = github.rest
  for (const { tag, source } of [release, predecessor]) {
    const { data: commit } = await repos.getCommit({ ...repo, ref: `tags/${tag}` })
    requireEvidence(commit.sha === source, `${tag} must resolve to ${source}.`)
  }

  async function readRun(expected, filename, event, branch, conclusion) {
    const { data: workflow } = await actions.getWorkflow({ ...repo, workflow_id: filename })
    const { data: run } = await actions.getWorkflowRun({ ...repo, run_id: expected.run })
    requireEvidence(
      run.id === expected.run &&
        run.workflow_id === workflow.id &&
        run.event === event &&
        run.head_branch === branch &&
        run.head_sha === expected.source &&
        run.status === 'completed' &&
        run.conclusion === conclusion &&
        run.run_attempt === expected.attempt,
      `Run ${expected.run} does not have the required identity and result.`,
    )
    return github.paginate(actions.listJobsForWorkflowRunAttempt, {
      ...repo,
      run_id: expected.run,
      attempt_number: expected.attempt,
    })
  }

  const original = await readRun(release, 'release.yml', 'push', release.tag, 'failure')
  for (const name of [
    'What this tag releases',
    'No name the repo must not carry',
    'Large fictional workspace at the production worker heap',
    'Build for the Mac (Developer ID, notarized, Apple silicon)',
  ])
    successfulJob(original, name)
  successfulStep(successfulJob(original, 'Build for Windows (NSIS, x64)'), 'Set up CodeSignTool')
  // windows-upgrade is a reusable workflow, so its checkout-level jobs are prefixed.
  requireEvidence(
    original.some(
      ({ name, conclusion }) => name === 'Upgrade test on the Mac' && conclusion === 'failure',
    ),
    'The original Mac upgrade failure must be retained.',
  )
  requireEvidence(
    original.some(
      ({ name, conclusion }) =>
        name === "Upgrade test on Windows / Windows, from the tester's beta to the candidate" &&
        conclusion === 'failure',
    ),
    'The original Windows upgrade failure must be retained.',
  )

  const corrected = await readRun(
    upgrade,
    'upgrade-path.yml',
    'workflow_dispatch',
    upgrade.branch,
    'success',
  )
  successfulJob(corrected, 'Bind reused files to their original release')
  successfulJob(corrected, 'Candidate large-workspace worker regression')
  successfulStep(
    successfulJob(corrected, "Mac, from the tester's beta to the candidate"),
    'Upgrade three workspaces using the original signed Mac files',
  )
  successfulStep(
    successfulJob(corrected, "Windows, from the tester's beta to the candidate"),
    'Install the beta, make data with it, install the candidate over it, and check',
  )
  for (const [platform, id] of [
    ['windows', release.windows],
    ['macos', release.mac],
  ]) {
    const { data } = await actions.getArtifact({ ...repo, artifact_id: id })
    requireEvidence(
      originalArtifact(data, id, platform),
      `Original ${platform} artifact ${id} is unavailable or different.`,
    )
  }
  return {
    tag: release.tag,
    source: release.source,
    version: release.tag.slice(1),
    predecessor: predecessor.tag,
    originalRun: release.run,
    originalArtifacts: `${release.windows},${release.mac}`,
    correctedRun: upgrade.run,
    correctedAttempt: upgrade.attempt,
  }
}

export function verifyFinal039UpgradeReceipt({ binding }, platform) {
  requireEvidence(
    binding?.harnessSource === upgrade.source &&
      binding.candidateSource === release.source &&
      binding.candidateVersion === release.tag.slice(1) &&
      binding.predecessorSource === predecessor.source &&
      binding.windowsPredecessor === predecessor.tag &&
      binding.macPredecessor === predecessor.tag &&
      binding.originalRun?.id === release.run &&
      binding.originalRun.head_sha === release.source &&
      binding.originalRun.head_branch === release.tag &&
      binding.artifacts?.length === 2 &&
      binding.artifacts.some((artifact) =>
        originalArtifact(artifact, release.windows, 'windows'),
      ) &&
      binding.artifacts.some((artifact) => originalArtifact(artifact, release.mac, 'macos')),
    `${platform} did not attest to these original artifacts and upgrade sources.`,
  )
}
