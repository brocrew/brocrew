import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { afterAll, expect, it } from 'vitest'
import rule from '../eslint/no-forced-sqlite-worker-termination.mjs'

/**
 * Code that owns a SQLite worker asks it to stop and waits for it: ending a worker inside a
 * better-sqlite3 call aborts the whole app. The rule finds Node's `Worker#terminate` by its type,
 * so a renamed import, an alias or an injected method is found too, and a `terminate` of anything
 * else is not.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const RULE = 'worker-lifetime/stop-and-join'

/** Each line marked `reported` ends a Node worker one way or another. */
const TERMINATES = `import { Worker } from 'node:worker_threads'
import * as threads from 'node:worker_threads'
import { Worker as Thread } from 'node:worker_threads'

export async function terminates(
  worker: Worker,
  other: threads.Worker,
  aliased: Thread,
  injected: Worker['terminate'],
): Promise<void> {
  await worker.terminate() // reported
  await other.terminate() // reported
  await aliased.terminate() // reported
  await worker?.['terminate']() // reported
  await injected() // reported
  const saved = worker.terminate // reported
  await worker.terminate.bind(worker)() // reported
  void saved
}
`

const JOINS = `import { Worker as NodeWorker } from 'node:worker_threads'

class Store {
  terminate(): void {}
}

class Worker {
  terminate(): void {}
}

interface Lifetime {
  terminate: NodeWorker['terminate']
  reader: Pick<NodeWorker, 'postMessage' | 'terminate'>
}

// Stops by asking and waiting, and ends only things that are not Node workers.
export async function joins(worker: NodeWorker, store: Store, own: Worker, lifetime: Lifetime) {
  store.terminate()
  own.terminate()
  worker.postMessage({ kind: 'stop' })
  await new Promise((resolve) => worker.once('exit', resolve))
  lifetime.reader.postMessage({ type: 'close' })
}
`

const folder = mkdtempSync(join(tmpdir(), 'fictional-worker-lint-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))

/** The lines a source marks `// reported`. */
const marked = (source) =>
  source.split('\n').flatMap((line, at) => (line.endsWith('// reported') ? [at + 1] : []))

it('reports every way a Node worker is ended, and no other terminate', async () => {
  writeFileSync(join(folder, 'terminates.ts'), TERMINATES)
  writeFileSync(join(folder, 'joins.ts'), JOINS)
  writeFileSync(
    join(folder, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2022'],
        types: ['node'],
        typeRoots: [join(ROOT, 'node_modules/@types')],
        strict: true,
        noEmit: true,
      },
      include: ['*.ts'],
    }),
  )
  const { languageOptions } = await new ESLint({ cwd: ROOT }).calculateConfigForFile(
    'apps/desktop/src/main/db/connection.ts',
  )
  const eslint = new ESLint({
    cwd: folder,
    overrideConfigFile: true,
    overrideConfig: {
      files: ['**/*.ts'],
      languageOptions: {
        parser: languageOptions.parser,
        parserOptions: { project: './tsconfig.json', tsconfigRootDir: folder },
      },
      plugins: { 'worker-lifetime': { rules: { 'stop-and-join': rule } } },
      rules: { [RULE]: 'error' },
    },
  })
  const results = await eslint.lintFiles(['terminates.ts', 'joins.ts'])
  // A line can hold two reports (`worker.terminate.bind(worker)()`), so lines are compared once each.
  const lines = (file) => [
    ...new Set(
      results
        .find((result) => result.filePath.endsWith(file))
        .messages.map((message) => {
          expect(message.ruleId, message.message).toBe(RULE)
          return message.line
        }),
    ),
  ]
  expect(marked(TERMINATES)).toHaveLength(7)
  expect(lines('terminates.ts')).toEqual(marked(TERMINATES))
  expect(lines('joins.ts')).toEqual([])
}, 60_000)

it('applies to the code that owns a SQLite worker', async () => {
  const repository = new ESLint({ cwd: ROOT })
  for (const file of [
    'apps/desktop/src/main/db/reader-worker-lifetime.ts',
    'apps/desktop/src/main/recovery/copy-check.ts',
    'apps/desktop/src/main/storage/workspace-compaction.ts',
    'apps/desktop/src/main/storage/event-retention.ts',
  ]) {
    const { rules } = await repository.calculateConfigForFile(file)
    expect(rules[RULE], file).toEqual([2])
  }
})
