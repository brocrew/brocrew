import {
  claudeLoginRenewer,
  defaultKeychainReaderAsync,
  probeClaudeCodeLogin,
} from '@brobot2/runtime'
import {
  CLAUDE_CODE_SWITCH,
  LOOK_FOR_THE_INSTALLED_ONE,
  findClaudeProgramHere,
  type ClaudeProgram,
} from './program'
import { claudeVersionReader } from './program-versions'
import type { DesktopProviderContext } from '../desktop-context'
import type { ClaudeModuleSeams } from './index'

export interface ClaudeDesktopSeams {
  readonly findProgram?: typeof findClaudeProgramHere
  readonly renewal?: typeof claudeLoginRenewer
  readonly probe?: typeof probeClaudeCodeLogin
  readonly readLogin?: typeof defaultKeychainReaderAsync
  readonly versionReader?: typeof claudeVersionReader
}

/** The same per-launch program lookup serves launches, renewal and version reads. */
export function claudeDesktopInputs(
  context: DesktopProviderContext,
  seams: ClaudeDesktopSeams = {},
): ClaudeModuleSeams {
  const find = seams.findProgram ?? findClaudeProgramHere
  const installed = (): string | null => {
    const given = context.commandLine.getSwitchValue(CLAUDE_CODE_SWITCH)
    try {
      return find({ isPackaged: true, given: given === '' ? LOOK_FOR_THE_INSTALLED_ONE : given })
        .path
    } catch {
      return null
    }
  }
  const program = (everyCopy = false): ClaudeProgram =>
    find({
      isPackaged: context.isPackaged,
      given: context.commandLine.hasSwitch(CLAUDE_CODE_SWITCH)
        ? context.commandLine.getSwitchValue(CLAUDE_CODE_SWITCH)
        : undefined,
      everyCopy,
    })
  const key = (): Promise<string | null> => context.keys.read('claude')
  const renew = (seams.renewal ?? claudeLoginRenewer)({
    readLogin: seams.readLogin ?? defaultKeychainReaderAsync,
    signal: context.signal,
    findProgram: installed,
  })
  return {
    runtime: {
      program: () => program().path,
      programFound: installed,
      managedRoot: context.managedRoot,
      key,
    },
    home: { key, programFound: installed },
    auth: {
      platform: context.platform,
      key,
      keyStatus: () => context.keys.status('claude'),
      programFound: installed,
      renewLogin: renew,
      probeLogin: (signal) =>
        (seams.probe ?? probeClaudeCodeLogin)({
          findProgram: installed,
          platform: context.platform,
          signal: signal === undefined ? context.signal : AbortSignal.any([context.signal, signal]),
        }),
    },
    program: {
      version: (seams.versionReader ?? claudeVersionReader)(() => program(true)),
      installedPath: installed,
    },
  }
}
