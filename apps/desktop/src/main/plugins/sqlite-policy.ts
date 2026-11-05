/** FULL is required before any caller SQL, but setting it can itself need a SQLite lock. */
export function pluginSqliteFullPolicy(connection: {
  active(): boolean
  exec(sql: string): void
  readSynchronous(): unknown
}): () => void {
  let ready = false
  return () => {
    if (ready) return
    if (connection.active()) throw new Error('plugin-sqlite-policy-inside-transaction')
    // BUSY must reach the caller's normal refusal/retry boundary; leave ready false on failure.
    connection.exec('PRAGMA synchronous=FULL')
    if (connection.readSynchronous() !== 2) throw new Error('plugin-sqlite-full-policy-unconfirmed')
    ready = true
  }
}
