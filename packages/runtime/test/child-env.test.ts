import { describe, expect, it } from 'vitest'
import { buildChildEnv } from '../src/internal/child-env'

const BASE: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/tester',
  GITHUB_TOKEN: 'ghp_made_up',
  GH_TOKEN: 'gho_made_up',
  AWS_ACCESS_KEY_ID: 'AKIAMADEUP',
  AWS_SECRET_ACCESS_KEY: 'made-up-secret',
  AWS_PROFILE: 'made-up-profile',
  SSH_AUTH_SOCK: '/tmp/made-up-agent.sock',
  SOME_TOOL_SETTING: 'x',
  CLAUDE_CONFIG_DIR: '/home/tester/.claude',
}

describe('buildChildEnv', () => {
  it('passes on the whole inherited environment, as a plain client gets it', () => {
    const env = buildChildEnv({ CLAUDE_CONFIG_DIR: '/profile/home' }, BASE, 'darwin')
    expect(env).toEqual({ ...BASE, CLAUDE_CONFIG_DIR: '/profile/home' })
  })

  it('on Windows replaces an inherited key whatever its case', () => {
    const windows = { Path: 'C:\\Windows', Claude_Config_Dir: 'C:\\x' }
    const env = buildChildEnv({ CLAUDE_CONFIG_DIR: 'C:\\profile' }, windows, 'win32')
    expect(env).toEqual({ Path: 'C:\\Windows', CLAUDE_CONFIG_DIR: 'C:\\profile' })
  })

  it('off Windows keeps names exact', () => {
    const env = buildChildEnv({ PATH: '/profile/bin' }, { Path: '/x', PATH: '/y' }, 'linux')
    expect(env).toEqual({ Path: '/x', PATH: '/profile/bin' })
  })

  it('never mutates the base', () => {
    const base = { ...BASE }
    const env = buildChildEnv({ CLAUDE_CONFIG_DIR: '/profile/home' }, base)
    expect(env).not.toBe(base)
    expect(base).toEqual(BASE)
  })
})
