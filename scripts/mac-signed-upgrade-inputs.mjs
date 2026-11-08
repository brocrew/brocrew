import { spawn, execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseArgs, promisify } from 'node:util'
import { assertHostedMac, requireEvidence } from './lib/mac-update-test.mjs'
import {
  BASELINE,
  artifactBinding,
  candidateReceipt,
  sealedFile,
  digestFile,
  upgradeRequest,
  artifactMembers,
} from './mac-signed-upgrade-contract.mjs'

assertHostedMac(process.env, process.platform, process.arch)
const { values } = parseArgs({
  options: { output: { type: 'string' }, request: { type: 'string' } },
})
requireEvidence(values.output && values.request, 'Both --output and --request JSON are required.')
const request = upgradeRequest(JSON.parse(values.request))
const output = resolve(values.output)
await mkdir(output, { recursive: false })
const exec = promisify(execFile)
async function api(path) {
  const { stdout } = await exec('gh', ['api', `repos/brocrew/brocrew/${path}`], {
    maxBuffer: 16 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}
async function acquire(expected, name) {
  const candidateDir = join(output, name)
  await mkdir(candidateDir)
  const [run, artifact] = await Promise.all([
    api(`actions/runs/${expected.runId}`),
    api(`actions/artifacts/${expected.artifactId}`),
  ])
  await writeFile(join(candidateDir, 'build-run.json'), JSON.stringify(run, null, 2))
  await writeFile(join(candidateDir, 'build-artifact.json'), JSON.stringify(artifact, null, 2))
  artifactBinding(run, artifact, expected)
  const commit = await api(`git/commits/${expected.source}`)
  requireEvidence(
    commit.sha === expected.source && commit.tree.sha === expected.tree,
    'Candidate source tree differs.',
  )
  await writeFile(join(candidateDir, 'build-commit.json'), JSON.stringify(commit, null, 2))
  const archive = join(output, `${name}-artifact.zip`)
  const download = spawn(
    'gh',
    ['api', `repos/brocrew/brocrew/actions/artifacts/${expected.artifactId}/zip`],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  download.stderr.resume()
  const exited = new Promise((done, failed) => {
    download.once('error', failed)
    download.once('exit', (code) =>
      code === 0 ? done() : failed(new Error(`Artifact download failed (${code}).`)),
    )
  })
  await Promise.all([
    pipeline(download.stdout, createWriteStream(archive, { flags: 'wx' })),
    exited,
  ])
  requireEvidence(
    (await digestFile(archive)) === expected.artifactSha256,
    'Downloaded candidate artifact SHA-256 differs.',
  )
  const { stdout: members } = await exec('/usr/bin/unzip', ['-Z1', archive])
  artifactMembers(members, expected.version)
  await exec('/usr/bin/unzip', ['-t', archive])
  await exec('/usr/bin/unzip', ['-q', archive, '-d', candidateDir])
  const receiptPath = join(candidateDir, 'mac-signed-candidate.json')
  const receipt = candidateReceipt(JSON.parse(await readFile(receiptPath, 'utf8')), expected)
  for (const file of receipt.files) await sealedFile(join(candidateDir, file.name), file)
  const release = await api(`releases/${expected.releaseId}`)
  requireEvidence(
    release.draft === true,
    'Controlled prepublication input must be a draft GitHub release.',
  )
  await writeFile(join(candidateDir, 'draft-release.json'), JSON.stringify(release, null, 2))
  const files = receipt.files.map((file) => {
    if (file.name === 'latest-mac.yml') return file
    const asset = release.assets.find((asset) => asset.name === file.name)
    requireEvidence(
      asset && asset.size === file.size && asset.digest === `sha256:${file.sha256}`,
      `Draft release asset does not match sealed ${file.name}.`,
    )
    return { ...file, assetId: asset.id }
  })
  return {
    ...receipt,
    files,
    directory: candidateDir,
    input: expected,
    manifest: await readFile(join(candidateDir, 'latest-mac.yml'), 'utf8'),
  }
}
try {
  const candidate = await acquire(request.to, 'candidate')
  const baselineDir = join(output, 'baseline')
  await mkdir(baselineDir)
  const downloads = [
    BASELINE,
    {
      name: 'latest-mac.yml',
      size: 509,
      sha256: 'cb1fefcd373ff32c78476393d6a52835812d6dc39ac02a389b0a238fef5ea888',
    },
  ]
  for (const seal of downloads) {
    const url = `https://github.com/brocrew/brocrew/releases/download/v${BASELINE.version}/${seal.name}`
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(600_000),
    })
    requireEvidence(
      response.ok && response.body,
      `Public baseline download failed (${response.status}).`,
    )
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(join(baselineDir, seal.name), { flags: 'wx' }),
    )
    await sealedFile(join(baselineDir, seal.name), seal)
  }
  const baseline = {
    ...BASELINE,
    directory: baselineDir,
    files: downloads,
    manifest: await readFile(join(baselineDir, 'latest-mac.yml'), 'utf8'),
  }
  await writeFile(
    join(output, 'inputs.json'),
    JSON.stringify(
      {
        mode: request.mode,
        transport: 'controlled-draft-github',
        candidate,
        baseline,
        publicFeedAvailability: 'not proved',
      },
      null,
      2,
    ),
  )
} catch (error) {
  await writeFile(
    join(output, 'input-failure.json'),
    JSON.stringify({ failure: error.stack ?? String(error), request }, null, 2),
  )
  throw error
}
