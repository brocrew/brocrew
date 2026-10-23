import { changeCodexKeyInHome, createSpawnTransportFactory } from '@brobot2/runtime'
import { resolveCodexProgram, type CodexProgram } from './program'
import { codexVersionReader } from './program-versions'
import type { DesktopProviderContext } from '../desktop-context'
import type { CodexModuleSeams } from './index'
import type { CodexKeySeam } from './types'

export interface CodexDesktopSeams {
  readonly resolveProgram?: typeof resolveCodexProgram
  readonly versionReader?: typeof codexVersionReader
  readonly transportFactory?: typeof createSpawnTransportFactory
  readonly changeKey?: typeof changeCodexKeyInHome
}

/** Resolve the carried program at each actual launch, sign-in or key operation, never at binding. */
export function codexDesktopInputs(
  context: DesktopProviderContext,
  seams: CodexDesktopSeams = {},
): CodexModuleSeams {
  const program = (): CodexProgram =>
    (seams.resolveProgram ?? resolveCodexProgram)({
      isPackaged: context.isPackaged,
      resourcesPath: context.resourcesPath,
      platform: context.platform,
      arch: context.arch,
    })
  const command = (): string => program().path
  const key: CodexKeySeam = {
    current: () => context.keys.current('codex'),
    isSaved: () => context.keys.status('codex').set,
    change: (home, change) =>
      (seams.changeKey ?? changeCodexKeyInHome)(
        (seams.transportFactory ?? createSpawnTransportFactory)(program().path),
        home,
        change,
      ),
  }
  return {
    runtime: { command },
    home: { key },
    auth: { key, command },
    program: { version: (seams.versionReader ?? codexVersionReader)(program) },
  }
}
