import { describe, expect, it } from 'vitest'
import { given as claude } from '../src/main/providers/claude/given'
import { given as codex } from '../src/main/providers/codex/given'
import { launchSettingDisplay } from '../src/main/providers/given-policy'
import { settingRows, modeDiffersFromCopy } from '../src/renderer/src/lib/launch-settings'
import type { LaunchSettingKey, LaunchSettingValue } from '@brobot2/runtime'
import type { WhatThisAgentWasGiven } from '../src/shared/what-this-agent-was-given'

const captured = { approval: 'ask' as const, planning: false }

describe('provider launch-setting display at the read', () => {
  it.each([
    [claude, 'settings-sources', [], 'Settings files', 'Off. This app adds the instruction files itself.', []],
    [claude, 'settings-sources', ['user', 'project'], 'Settings files', 'Reads user and project.', []],
    [claude, 'built-in-tools', ['preset:default', 'Fern'], 'Built-in tools', 'Default tools, plus Fern.', []],
    [claude, 'memory-folder', '/fictional/fern', 'Memory', 'On, in this profile’s memory folder.', ['/fictional/fern']],
    [claude, 'denied-tools', [], 'Not allowed', 'None.', []],
    [claude, 'connectors', false, 'Account connectors', 'Off.', []],
    [claude, 'attribution', 'set', 'Commit signatures', 'Set by this app.', []],
    [codex, 'approval-sandbox', ['sandbox=workspace-write'], 'Approval and files', '', ['sandbox=workspace-write']],
    [codex, 'memory', null, 'Memory', 'Couldn’t be read.', []],
    [codex, 'thread-overrides', [], 'Thread settings', 'None.', []],
    [codex, 'plan-tool', true, 'Plan tool', 'Enabled.', []],
    [codex, 'collaboration-mode', 'default', 'Plan', 'Default.', []],
    [claude, 'mode', 'default', 'Plan', 'Off.', []],
    [claude, 'tools-off', [], 'Turned off', 'None.', []],
    [codex, 'tools-left-on', ['fern_input'], 'Left on', 'fern_input (no switch).', []],
  ] as const)('keeps native words for %s %s', (policy, key, value, label, words, lines) => {
    const display = launchSettingDisplay(
      { recorded: true, settings: [{ key, atLaunch: value }] }, policy, captured,
    )
    expect(display.rows).toEqual([{ key, label, words, lines }])
    expect(settingRows(undefined, display)).toBe(display.rows)
  })

  it('keeps old recorded nulls distinct from missing records, and changed sentences in order', () => {
    const settings = {
      recorded: false,
      settings: [{ key: 'approval' as const, atLaunch: null, now: 'auto' }],
    }
    expect(launchSettingDisplay(settings, claude, captured)).toEqual({
      rows: [{ key: 'approval', label: 'Approval', words: 'Not recorded. Now: Runs without asking.', lines: [] }],
      modeDiffersFromCopy: false,
    })
    expect(launchSettingDisplay({ recorded: true, settings: [
      { key: 'approval', atLaunch: 'auto', now: 'ask' },
      { key: 'mode', atLaunch: 'default', now: 'plan' },
    ] }, claude, captured)).toEqual({
      rows: [
        { key: 'approval', label: 'Approval', words: 'At launch: Runs without asking. Now: Asks first.', lines: [] },
        { key: 'mode', label: 'Plan', words: 'At launch: Off. Now: Plan mode.', lines: [] },
      ],
      modeDiffersFromCopy: true,
    })
  })

  it('uses fictional supplied facts with their receiver, without client key interpretation', () => {
    const policy = {
      planningKey: 'mode' as const,
      prefix: 'Fern',
      launchSetting(this: { prefix: string }, _key: LaunchSettingKey, _value: LaunchSettingValue) {
        return { label: this.prefix, words: 'Supplied words.', lines: ['opaque'] }
      },
    }
    const raw = { recorded: true, settings: [{ key: 'settings-sources' as const, atLaunch: [] }] }
    const display = launchSettingDisplay(raw, policy, undefined)
    expect(settingRows(raw, display)).toEqual([
      { key: 'settings-sources', label: 'Fern', words: 'Supplied words.', lines: ['opaque'] },
    ])
    const given = { launchSettings: raw, launchSettingDisplay: { ...display, modeDiffersFromCopy: true } } as WhatThisAgentWasGiven
    expect(modeDiffersFromCopy(given)).toBe(true)
  })

  it('retains raw unknown values and absent optional policy facts without native guesses', () => {
    const settings = { recorded: true, settings: [
      { key: 'settings-sources' as const, atLaunch: 'future-format' },
      { key: 'memory' as const, atLaunch: null },
    ] }
    expect(launchSettingDisplay(settings, {}, undefined).rows).toEqual([
      { key: 'settings-sources', label: 'settings-sources', words: 'future-format.', lines: [] },
      { key: 'memory', label: 'memory', words: 'unknown.', lines: [] },
    ])
    expect(settingRows(settings)).toEqual(launchSettingDisplay(settings, {}, undefined).rows)
    expect(launchSettingDisplay({ recorded: true, settings: [
      { key: 'settings-sources', atLaunch: 'future-format' },
    ] }, claude, undefined).rows[0]).toEqual({
      key: 'settings-sources', label: 'Settings files', words: 'future-format.', lines: [],
    })
    expect(settingRows(undefined)).toEqual([])
  })
})
