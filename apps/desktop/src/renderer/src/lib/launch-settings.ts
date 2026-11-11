import type {
  GivenLaunchSettings,
  GivenLaunchSettingDisplay,
  GivenLaunchSettingRow,
  WhatThisAgentWasGiven,
} from '../../../shared/what-this-agent-was-given'
import { launchSettingRows } from '../../../shared/launch-setting-display'

export type SettingRow = GivenLaunchSettingRow

/** The read owns the words. Older answers without display facts remain visible as raw values. */
export function settingRows(
  settings: GivenLaunchSettings | undefined,
  display?: GivenLaunchSettingDisplay,
): readonly SettingRow[] {
  return display?.rows ?? launchSettingRows(settings)
}

export const MODE_DIFFERS = 'This launch’s mode differs from the copy.'

export function modeDiffersFromCopy(
  given: Pick<WhatThisAgentWasGiven, 'launchSettingDisplay'>,
): boolean {
  return given.launchSettingDisplay?.modeDiffersFromCopy ?? false
}
