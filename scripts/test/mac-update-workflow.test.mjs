import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import builderTools from '../../apps/desktop/build/builder-tools.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path) => builderTools.loadYaml(readFileSync(join(root, path), 'utf8'))
const action = read('.github/actions/signed-mac/action.yml')
const steps = action.runs.steps
const build = steps.find((step) => step.name?.startsWith('Build and package'))
const keys = [
  'MAC_CERT_P12_BASE64',
  'MAC_CERT_P12_PASSWORD',
  'APPLE_API_KEY_P8',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
]

function argumentsFor(overrides = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'mac-action-args-'))
  try {
    writeFileSync(
      join(temp, 'pnpm'),
      '#!/usr/bin/env python3\nimport json,os,sys\nwith open(os.environ["ARGUMENTS"], "a") as out: out.write(json.dumps(sys.argv[1:])+"\\n")\n',
      { mode: 0o755 },
    )
    const inputs = Object.fromEntries(
      Object.entries(action.inputs).map(([key, value]) => [key, value.default ?? '']),
    )
    Object.assign(inputs, { owner: 'brocrew', repo: 'brocrew', version: '0.2.22' }, overrides)
    const env = {
      ...process.env,
      PATH: `${temp}:${process.env.PATH}`,
      ARGUMENTS: join(temp, 'args'),
    }
    for (const [name, value] of Object.entries(build.env)) {
      if (/^\$\{\{ inputs\./.test(value)) env[name] = inputs[value.slice(11, -3)]
    }
    execFileSync('bash', ['-c', build.run], { env })
    return readFileSync(env.ARGUMENTS, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

it('keeps the release builder arguments unchanged with the default inputs', () => {
  expect(argumentsFor()).toEqual([
    ['--filter', '@brobot2/desktop', 'run', 'build'],
    [
      '--filter',
      '@brobot2/desktop',
      'exec',
      'electron-builder',
      '--mac',
      'dmg',
      'zip',
      'dir',
      '--arm64',
      '--config',
      'electron-builder.yml',
      '-c.forceCodeSigning=true',
      '-c.mac.hardenedRuntime=true',
      '-c.mac.timestamp=http://timestamp.apple.com/ts01',
      '-c.mac.notarize=true',
      '-c.dmg.sign=true',
      '-c.artifactBuildCompleted=./build/notarize-dmg.mjs',
      '-c.extraMetadata.version=0.2.22',
      '-c.publish.provider=github',
      '-c.publish.owner=brocrew',
      '-c.publish.repo=brocrew',
      '--publish',
      'never',
    ],
  ])
  const release = read('.github/workflows/release.yml')
  const call = release.jobs.macos.steps.find((step) => step.uses === './.github/actions/signed-mac')
  expect(call.with).not.toHaveProperty('feed_url')
  expect(call.with).not.toHaveProperty('marker')
  expect(call.with).not.toHaveProperty('output')
})

it('uses the same signing command with generic or private rehearsal feeds', () => {
  const generic = argumentsFor({
    feed_url: 'http://127.0.0.1:47123/',
    marker: 'fictional marker',
    output: 'dist-mac-update/a',
  })[1]
  expect(generic).toContain('-c.publish.provider=generic')
  expect(generic).toContain('-c.publish.url=http://127.0.0.1:47123/')
  expect(generic).toContain('-c.extraMetadata.rehearsalMarker=fictional marker')
  expect(generic).toContain('-c.directories.output=dist-mac-update/a')
  expect(generic).not.toContain('-c.publish.provider=github')
  expect(argumentsFor({ feed_private: 'true' })[1]).toContain('-c.publish.private=true')
})

it('forwards the five signing secrets explicitly and shares the existing signing action', () => {
  const caller = read('.github/workflows/macos.yml')
  const call = Object.values(caller.jobs).find(
    (job) => job.uses === './.github/workflows/mac-update-test.yml',
  )
  expect(call.secrets).toEqual(
    Object.fromEntries(keys.map((key) => [key, '${{ secrets.' + key + ' }}'])),
  )
  const mac = read('.github/workflows/mac-update-test.yml')
  expect(mac.on.workflow_call.secrets).toEqual(
    Object.fromEntries(keys.map((key) => [key, { required: true }])),
  )
  const shared = read('.github/workflows/update-rehearsal.yml')
  const reused = shared.jobs.macos
  expect(reused.uses).toBe('./.github/workflows/mac-update-test.yml')
  expect(reused.with.build_only).toBe(true)
  expect(reused.with.feed_url).toContain('http://127.0.0.1:47122/')
  expect(reused.with.feed_private).toContain("mode == 'private'")
  expect(reused.secrets).toEqual(call.secrets)
  for (const workflow of [mac, shared]) {
    expect(workflow.on).not.toHaveProperty('pull_request')
    expect(workflow.on).not.toHaveProperty('pull_request_target')
  }
  const job = mac.jobs.rehearse
  expect(job.environment).toBe('mac-signing')
  const builds = job.steps.filter((step) => step.uses === './.github/actions/signed-mac')
  expect(builds.map((step) => step.with.version)).toEqual(['0.0.98', '0.0.99'])
  for (const build of builds) expect(Object.keys(build.env)).toEqual(keys)
  expect(job.steps.some((step) => /electron-builder|notary\.p8/.test(step.run ?? ''))).toBe(false)
  const feed = job.steps.find((step) => step.id === 'feed')
  expect(feed.run).toContain('dist=dist-rehearsal')
  expect(feed.run).toContain('prefix=mac-')
  expect(job.steps.find((step) => step.name?.startsWith('Rehearse ZIP')).if).toBe(
    '${{ !inputs.build_only }}',
  )
  expect(job.steps.find((step) => step.with?.name === 'rehearsal-macos').if).toBe(
    'inputs.build_only',
  )
})

it.each([false, true])('preserves package layout and markers for build-only=%s', (buildOnly) => {
  const temp = mkdtempSync(join(tmpdir(), 'mac-rehearsal-feed-'))
  const output = join(temp, 'outputs')
  try {
    const step = read('.github/workflows/mac-update-test.yml').jobs.rehearse.steps.find(
      (step) => step.id === 'feed',
    )
    execFileSync('bash', ['-c', step.run], {
      env: {
        ...process.env,
        REPO: 'fictional/sandbox',
        BUILD_ONLY: String(buildOnly),
        GITHUB_OUTPUT: output,
      },
    })
    expect(readFileSync(output, 'utf8')).toBe(
      'owner=fictional\nrepo=sandbox\n' +
        (buildOnly ? 'dist=dist-rehearsal\nprefix=\n' : 'dist=dist-mac-update\nprefix=mac-\n'),
    )
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
