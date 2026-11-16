import type { Provider } from '@brobot2/shared'
import type { AppDatabase } from '../../src/main/db/connection'
import type { SessionStore } from '../../src/main/db/session-store'

/** Seed the recorded default and capture the launch bindings a metadata edit must preserve. */
export function metadataEditBaseline(
  db: AppDatabase,
  store: SessionStore,
  provider: Provider,
  connectionId: string,
) {
  store.setModelChoice('fern', {
    provider,
    model: 'fictional-small',
    effort: null,
    connectionId,
  })
  return {
    sessions: db.prepare('SELECT * FROM provider_session ORDER BY id').all(),
    defaults: db.prepare('SELECT * FROM agent_identity ORDER BY slug').all(),
  }
}
