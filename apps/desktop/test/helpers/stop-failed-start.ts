import { closeStartedHostAfterFailedStart } from '../../src/main/failed-start-cleanup'
import { createMemoryJournalLifetime } from '../../src/main/memory-journal-lifetime'
import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { expect, vi } from 'vitest'
import type { RuntimeHost } from '../../src/main/runtime/runtime-host'

function rootFunction(file: string, name: string): string {
  const source = readFileSync(new URL('../../src/main/' + file, import.meta.url), 'utf8')
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const node = parsed.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )
  if (!node) throw new Error('Missing ' + name)
  return node.getText(parsed).replace(/^export /, '')
}

export function stopFailedStart(host: RuntimeHost, failure: Error) {
  const code = [
    rootFunction('index.ts', 'stopWindowServices'),
    rootFunction('index.ts', 'stopWhatTheStartStarted'),
    'stopWhatTheStartStarted()',
  ].join('\n')
  const sayAtOnce = vi.fn()
  const stopping = runInNewContext(
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    {
      host,
      closeStartedHostAfterFailedStart,
      memoryJournal: createMemoryJournalLifetime(() => null),
      stoppingTheStart: null,
      stopThemeIpc: undefined,
      stopStorageIpc: undefined,
      stopVoiceIpc: undefined,
      dockLabel: null,
      themes: null,
      pluginController: { close: async () => {} },
      pluginSupervisor: { quit: async () => {} },
      stopProviderSetup: () => Promise.reject(failure),
      sayAtOnce,
      inspect,
    },
  ) as Promise<void>
  return stopping.then(() => {
    expect(sayAtOnce).toHaveBeenCalledWith(expect.stringContaining(inspect(failure)))
  })
}
