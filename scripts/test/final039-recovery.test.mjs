import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import builderTools from '../../apps/desktop/build/builder-tools.mjs'
import { verifyFinal039Runs, verifyFinal039UpgradeReceipt } from '../lib/final039-recovery.mjs'

const workflow = builderTools.loadYaml(
  readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'),
)

describe('Final039 recovery route', () => {
  it('puts both release mutations behind the existing environment and the successful preflight', () => {
    expect(workflow.on).toHaveProperty('workflow_dispatch')
    expect(workflow.jobs.plan.if).toBe("github.event_name == 'push'")
    const verify = workflow.jobs['verify-final039']
    expect(verify.permissions).toEqual({ contents: 'read', actions: 'read' })
    expect(verify.if).toContain("github.ref == 'refs/heads/recover/final039-publication'")
    const recovery = workflow.jobs['recover-final039']
    expect(recovery.needs).toBe('verify-final039')
    expect(recovery.environment).toBe('release')
    const draft = recovery.steps.find((step) => step.id === 'draft')
    expect(draft.run).toBe(workflow.jobs.draft.steps.find((step) => step.id === 'draft').run)
    expect(draft.env.RECOVERY_PREDECESSOR).toBe('${{ needs.verify-final039.outputs.predecessor }}')
    expect(recovery.steps.at(-1).run).toBe(workflow.jobs.publish.steps.at(-1).run)
    expect(recovery.steps.at(-1).env.RELEASE_SOURCE).toBe(draft.env.RELEASE_SOURCE)
    expect(recovery.steps.at(-1).env.RECOVERY_PREDECESSOR).toBe(draft.env.RECOVERY_PREDECESSOR)
  })
})

const candidate = '6d1937e4ebf33f6fde2de8888883308023e91294'
const predecessor = 'a4287737be82efe4da81619e8085433b82142029'
const harness = '6e6f94d77155a25723842a827d4cbc08bee97fe7'
const original = {
  id: 45675584799,
  workflow_id: 387765921,
  head_sha: candidate,
  head_branch: 'v0.2.39',
  event: 'push',
  run_attempt: 1,
  status: 'completed',
  conclusion: 'failure',
}
const corrected = {
  id: 45685816909,
  workflow_id: 387765924,
  head_sha: harness,
  head_branch: 'qualify/final039-upgrade-harness-6e6f94d7',
  event: 'workflow_dispatch',
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
}
const macJob = "Mac, from the tester's beta to the candidate"
const windowsJob = "Windows, from the tester's beta to the candidate"
const macStep = 'Upgrade three workspaces using the original signed Mac files'
const windowsStep = 'Install the beta, make data with it, install the candidate over it, and check'
const assets = [
  [15051303619, 'release-windows-1'],
  [15052023547, 'release-macos-1'],
].map(([id, name]) => ({
  id,
  name,
  expired: false,
  workflow_run: { id: original.id, head_sha: candidate },
}))
const receipt = {
  binding: {
    harnessSource: harness,
    candidateSource: candidate,
    candidateVersion: '0.2.39',
    predecessorSource: predecessor,
    windowsPredecessor: 'v0.2.37',
    macPredecessor: 'v0.2.37',
    originalRun: original,
    artifacts: assets,
  },
}

const job = (name, step, conclusion = 'success') => ({
  name,
  conclusion,
  steps: step ? [{ name: step, conclusion }] : [],
})

function fixture() {
  const runs = { [original.id]: { ...original }, [corrected.id]: { ...corrected } }
  const tags = { 'tags/v0.2.39': candidate, 'tags/v0.2.37': predecessor }
  const jobs = {
    [original.id]: [
      job('What this tag releases'),
      job('No name the repo must not carry'),
      job('Large fictional workspace at the production worker heap'),
      job('Build for the Mac (Developer ID, notarized, Apple silicon)'),
      job('Build for Windows (NSIS, x64)', 'Set up CodeSignTool'),
      job('Upgrade test on the Mac', null, 'failure'),
      job(`Upgrade test on Windows / ${windowsJob}`, null, 'failure'),
    ],
    [corrected.id]: [
      job('Bind reused files to their original release'),
      job('Candidate large-workspace worker regression'),
      job(macJob, macStep),
      job(windowsJob, windowsStep),
    ],
  }
  const artifacts = structuredClone(assets)
  const github = {
    rest: {
      actions: {
        getWorkflow: async ({ workflow_id: file }) => ({
          data: { id: file === 'release.yml' ? original.workflow_id : corrected.workflow_id },
        }),
        getWorkflowRun: async ({ run_id: id }) => ({ data: runs[id] }),
        getArtifact: async ({ artifact_id: id }) => ({
          data: artifacts.find((value) => value.id === id),
        }),
        listJobsForWorkflowRunAttempt: Symbol('attempt jobs'),
      },
      repos: { getCommit: async ({ ref }) => ({ data: { sha: tags[ref] } }) },
    },
    paginate: async (method, { run_id: id, attempt_number: attempt }) => {
      expect(method).toBe(github.rest.actions.listJobsForWorkflowRunAttempt)
      expect(attempt).toBe(1)
      return jobs[id]
    },
  }
  return { github, runs, tags, jobs, artifacts }
}

describe('Final039 evidence', () => {
  const repo = { owner: 'brocrew', repo: 'brocrew' }
  it('resolves only the fixed original assets and corrected run after both ordinary upgrades', async () => {
    const { github } = fixture()
    await expect(verifyFinal039Runs(github, repo)).resolves.toEqual({
      tag: 'v0.2.39',
      source: candidate,
      version: '0.2.39',
      predecessor: 'v0.2.37',
      originalRun: original.id,
      originalArtifacts: '15051303619,15052023547',
      correctedRun: corrected.id,
      correctedAttempt: 1,
    })
    expect(() => verifyFinal039UpgradeReceipt(receipt, 'mac')).not.toThrow()
    expect(() => verifyFinal039UpgradeReceipt(receipt, 'windows')).not.toThrow()
  })

  it.each([
    [
      'a moved tag',
      (f) => {
        f.tags['tags/v0.2.39'] = harness
      },
      /v0.2.39 must resolve/,
    ],
    [
      'an unfinished run',
      (f) => {
        f.runs[corrected.id].status = 'in_progress'
      },
      /required identity/,
    ],
    [
      'a different attempt',
      (f) => {
        f.runs[corrected.id].run_attempt = 2
      },
      /required identity/,
    ],
    [
      'the wrong harness',
      (f) => {
        f.runs[corrected.id].head_sha = candidate
      },
      /required identity/,
    ],
    [
      'a skipped native job',
      (f) => {
        f.jobs[corrected.id].pop()
      },
      /Windows, .* must succeed/,
    ],
    [
      'a skipped native step',
      (f) => {
        f.jobs[corrected.id][2].steps = []
      },
      /Upgrade three.*must succeed/,
    ],
    [
      'an unsigned Windows build',
      (f) => {
        f.jobs[original.id][4].steps = []
      },
      /CodeSignTool must succeed/,
    ],
    [
      'an expired original asset',
      (f) => {
        f.artifacts[0].expired = true
      },
      /artifact .* unavailable/,
    ],
  ])('rejects %s', async (_label, change, expected) => {
    const f = fixture()
    change(f)
    await expect(verifyFinal039Runs(f.github, repo)).rejects.toThrow(expected)
  })

  it.each([
    { harnessSource: candidate },
    { candidateSource: harness },
    { predecessorSource: candidate },
    { candidateVersion: '0.2.38' },
    { macPredecessor: 'v0.2.36' },
    { originalRun: { ...original, id: corrected.id } },
    { artifacts: [assets[0], assets[0]] },
    {
      artifacts: [
        assets[0],
        { ...assets[1], workflow_run: { id: corrected.id, head_sha: candidate } },
      ],
    },
  ])('rejects a mismatched receipt %j', (change) => {
    expect(() =>
      verifyFinal039UpgradeReceipt({ binding: { ...receipt.binding, ...change } }, 'mac'),
    ).toThrow(/mac did not attest/)
  })
})
