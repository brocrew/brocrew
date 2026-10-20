import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fixtureEnvironment, fixtureAppEnvironment } from '../gates/plugin-packaged/prepare.mjs'
import {
  hostedSystemEnvironment,
  environmentKeyDiff,
  systemKeyRules,
} from '../gates/plugin-packaged/environment.mjs'
import { safeReport } from '../gates/plugin-packaged/contract.mjs'
const hosted = {
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'brocrew/brocrew',
  GITHUB_REF: 'refs/heads/gate/plugin-packaged-fern',
}
describe('minimal hosted GUI metadata fence', () => {
  it('pins the same app PATH in the runner-Node matrix and bundled-Node journey', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-app-env-')))
    try {
      const app = path.join(root, 'Fern.app')
      const matrix = fixtureAppEnvironment(root, app)
      const journey = fixtureEnvironment(
        root,
        {},
        path.join(app, 'Contents/Resources/plugin-node/node'),
      )
      expect(matrix).toEqual(journey)
      expect(matrix.PATH).toContain(path.join(app, 'Contents/Resources/plugin-node'))
      expect(matrix.PATH).not.toBe(
        fixtureEnvironment(root, {}, '/fictional/runner-node/bin/node').PATH,
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  it('carries only the three validated system keys, never arbitrary paths, tokens, homes or loader options', () => {
    const source = {
      ...hosted,
      __CF_USER_TEXT_ENCODING: '0x1F5:0:0',
      XPC_FLAGS: '0x0',
      XPC_SERVICE_NAME: '0',
      HOME: '/fictional/runner',
      TMPDIR: '/fictional/runner-tmp',
      PATH: '/fictional/bin',
      NODE_OPTIONS: 'madeup-loader',
      GH_TOKEN: 'fictional-secret',
    }
    expect(hostedSystemEnvironment(source, 'darwin', 'arm64')).toEqual({
      __CF_USER_TEXT_ENCODING: '0x1F5:0:0',
      XPC_FLAGS: '0x0',
      XPC_SERVICE_NAME: '0',
    })
    expect(Object.keys(systemKeyRules)).toHaveLength(3)
    for (const key of Object.keys(systemKeyRules))
      expect(
        hostedSystemEnvironment({ ...source, [key]: '/fictional secret\n' }, 'darwin', 'arm64'),
      ).not.toHaveProperty(key)
    expect(
      hostedSystemEnvironment({ ...source, RUNNER_ENVIRONMENT: 'self-hosted' }, 'darwin', 'arm64'),
    ).toEqual({})
    expect(hostedSystemEnvironment(source, 'linux', 'x64')).toEqual({})
  })
  it('diffs every name without values and cannot put that receipt in the uploaded summary', () => {
    const diff = environmentKeyDiff(
      {
        PATH: '/fictional/private',
        LANG: 'madeup-locale',
        REMOVED: 'fictional-secret',
        'bad/name': true,
      },
      { PATH: '/fictional/scratch', LANG: 'other', ADDED: 'madeup' },
    )
    expect(diff).toEqual({
      onlyInV2: ['REMOVED', 'bad/name'],
      onlyInFixture: ['ADDED'],
      shared: ['LANG', 'PATH'],
    })
    expect(JSON.stringify(diff)).not.toMatch(/fictional|private|madeup|scratch|locale/)
    expect(safeReport({ environmentKeyNames: diff })).toBe(false)
  })
})
