/** Normalize SQLite primary BUSY across the app and standalone backends. */
export function pluginSqliteCall<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    if (error instanceof Error) {
      const value = error as Error & { code?: string; errcode?: number }
      if (value.code === 'SQLITE_BUSY') throw error
      if (Number(value.errcode) % 256 === 5 || value.code?.startsWith('SQLITE_BUSY_'))
        throw Object.assign(new Error('supervisor busy', { cause: error }), { code: 'SQLITE_BUSY' })
    }
    throw error
  }
}
