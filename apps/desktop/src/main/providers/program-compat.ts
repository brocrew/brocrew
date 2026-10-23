import type { Provider } from '@brobot2/shared'
import type { ProviderVersion } from '../../shared/runtime-ipc'
import type { ClaudeProgram } from './claude/program'
import type { CodexProgram } from './codex/program'
import { claudeVersionReader } from './claude/program-versions'
import { codexVersionReader } from './codex/program-versions'
import { orderedProgramVersions } from './program-policy'

export {
  CLAUDE_CODE_SETUP_URL,
  CLAUDE_CODE_SWITCH,
  LOOK_FOR_THE_INSTALLED_ONE,
  findClaudeProgram,
  findClaudeProgramHere,
  installedCandidates,
  updateCommandFor,
  type ClaudeCopy,
  type ClaudeProgram,
  type ClaudeProgramContext,
} from './claude/program'

export {
  BUNDLED_CODEX,
  PACKAGED_CODEX_DIR,
  CodexUnavailableError,
  resolveCodexBinary,
  resolveCodexProgram,
  type BundledCodex,
  type CodexBinaryContext,
  type CodexProgram,
} from './codex/program'

export {
  CLAUDE_CODE_TESTED,
  versionOrder,
  standingOf,
  claudeAnswer,
} from './claude/program-versions'

/**
 * Each provider's program as this computer runs it, for the Providers screen and the
 * new-conversation form: what the program itself prints, never a constant.
 *
 *  - Claude: the program a launch would run, asked its `--version`, and each other copy installed
 *    here, so a person can see why updating one of them changed nothing. An answer is kept only while
 *    the same file answers ({@link theFileItRuns}: a link followed to its real file, its size and its
 *    time), so a program installed, updated or removed is asked again, and so is a silent one. Each
 *    runs with a fresh `HOME` and `CLAUDE_CONFIG_DIR`, removed after, never this person's `~/.claude`,
 *    and is told not to update itself.
 *  - Codex: the program a launch runs — today the copy this app carries — asked its `--version`
 *    (`codex-cli 0.160.0`), once per run, since that copy does not change under a running app; only
 *    an ask that failed for a passing reason is asked again. It lays a `tmp/` down in its home even
 *    for that, so it too runs with a fresh `HOME` and `CODEX_HOME`, never this person's `~/.codex`.
 *
 * Both answer the same {@link ProviderProgram}: which program runs, from where, and what it said.
 */
export function providerVersionsReader(
  codexProgram: () => CodexProgram,
  claudeProgram: () => ClaudeProgram,
): () => Promise<Readonly<Record<Provider, ProviderVersion>>> {
  return orderedProgramVersions({
    claude: claudeVersionReader(claudeProgram),
    codex: codexVersionReader(codexProgram),
  })
}
