import { describe, expect, it, vi } from 'vitest'
import { pathToFileURL } from 'node:url'
import {
  pluginServerLaunch,
  readPriorityClamped,
} from '../resources/plugin-host/process-groups.mjs'

describe('plugin server application scheduling policy', () => {
  const node = '/fictional/runtime/node',
    preload = '/fictional/runtime/server.mjs'
  it('uses only the absolute macOS taskpolicy with argv separated and the owned preload retained', () => {
    const stat = vi.fn(() => ({ isFile: () => true, uid: 0 })),
      access = vi.fn()
    expect(pluginServerLaunch(node, preload, { platform: 'darwin', stat, access })).toEqual({
      execPath: '/usr/sbin/taskpolicy',
      execArgv: ['-a', node, '--import', preload],
    })
    expect(stat).toHaveBeenCalledWith('/usr/sbin/taskpolicy')
    expect(access).toHaveBeenCalledWith('/usr/sbin/taskpolicy', 1)
  })
  it.each([{ isFile: () => false, uid: 0 }])('uses plain Node for a nonregular utility', (info) => {
    const access = vi.fn()
    expect(
      pluginServerLaunch(node, preload, {
        platform: 'darwin',
        stat: () => info,
        access,
      }),
    ).toEqual({ execPath: node, execArgv: ['--import', preload] })
    expect(access).not.toHaveBeenCalled()
  })
  it.each(['ENOENT', 'EACCES'])('falls back to the unchanged plain Node shape for %s', (code) => {
    expect(
      pluginServerLaunch(node, preload, {
        platform: 'darwin',
        stat: () => ({ isFile: () => true, uid: 0 }),
        access() {
          throw Object.assign(new Error('fictional unavailable utility'), { code })
        },
      }),
    ).toEqual({
      execPath: node,
      execArgv: ['--import', preload],
    })
  })
  it.each([
    ['linux', preload],
    ['win32', pathToFileURL('/fictional/runtime/server.mjs').href],
  ])(
    'does not inspect or wrap the utility on %s, and names the preload as Node takes it there',
    (platform, named) => {
      const stat = vi.fn(() => ({ isFile: () => true, uid: 0 })),
        access = vi.fn()
      expect(pluginServerLaunch(node, preload, { platform, stat, access })).toEqual({
        execPath: node,
        execArgv: ['--import', named],
      })
      expect(stat).not.toHaveBeenCalled()
      expect(access).not.toHaveBeenCalled()
    },
  )
  it.each([
    ['4 0', true],
    ['9 0', true],
    ['10 0', true],
    ['20 0', true],
    ['21 0', false],
    ['31 0', false],
    ['46 0', false],
    ['46 10', true],
    ['46 -20', false],
    ['127 20', true],
    ['128 0', null],
    ['46 -21', null],
    ['46 21', null],
    ['fictional-private-output', null],
    ['46 0 extra', null],
  ])('reduces priority output to a closed fact for %s', (output, expected) => {
    expect(readPriorityClamped(1234, { platform: 'darwin', read: () => output })).toBe(expected)
  })
  it('reports unknown on a failed priority read and does not inspect other platforms or invalid PIDs', () => {
    const read = vi.fn(() => {
      throw new Error('fictional-private-output')
    })
    expect(readPriorityClamped(1234, { platform: 'darwin', read })).toBeNull()
    read.mockClear()
    for (const platform of ['linux', 'win32'])
      expect(readPriorityClamped(1234, { platform, read })).toBeNull()
    expect(readPriorityClamped(1, { platform: 'darwin', read })).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})
