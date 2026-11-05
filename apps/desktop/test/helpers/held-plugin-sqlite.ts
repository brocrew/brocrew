import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'

/** A real second process owns only this fixture's database; release is an explicit IPC exchange. */
export async function holdPluginSqlite(path: string, captured: ChildProcess[]) {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { DatabaseSync } from 'node:sqlite';
    const database = new DatabaseSync(process.argv[1], {timeout:0});
    database.exec('BEGIN EXCLUSIVE');
    process.once('message', () => {
      database.exec('ROLLBACK'); database.close(); process.disconnect();
    });
    process.once('disconnect', () => { process.exitCode = 0 });
    process.send('held');
  `,
      path,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true },
  )
  captured.push(child)
  const exited = once(child, 'exit')
  let stderr = ''
  child.stderr?.on('data', (bytes: Buffer) => {
    stderr += bytes.toString().slice(0, Math.max(0, 4096 - stderr.length))
  })
  const [message] = await Promise.race([
    once(child, 'message'),
    exited.then(([code, signal]) => {
      throw new Error(
        `Fictional SQLite holder exited before readiness: ${code}/${signal}: ${stderr}`,
      )
    }),
  ])
  if (message !== 'held') throw new Error('Fictional SQLite holder did not acquire its lock')
  return {
    child,
    async release() {
      child.send('release')
      const [code, signal] = await exited
      if (code !== 0 || signal !== null)
        throw new Error(`Fictional SQLite holder did not exit cleanly: ${stderr}`)
    },
  }
}
