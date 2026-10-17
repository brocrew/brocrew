import type Database from 'better-sqlite3'

/** The event types the provider wall read reads: the walls, the launches that date them, the clears. */
export const PROVIDER_WALL_EVENT_TYPES = ['error', 'launched', 'provider_limit_clear'] as const

/**
 * The most rows the queue holds since it was last emptied. A write past it empties the queue,
 * and every kept read, now behind where it was emptied, begins again: no read ever takes in more.
 */
export const WALL_QUEUE_AT_MOST = 4096

const terms = PROVIDER_WALL_EVENT_TYPES.map((type) => `'${type}'`).join(', ')
const bump = 'UPDATE provider_wall_watch SET revision = revision + 1 WHERE id = 0;'
const newestCompleted = `INSERT OR REPLACE INTO provider_wall_turns (provider, at)
  SELECT ps.provider,
         max(NEW.closed_at, coalesce((SELECT at FROM provider_wall_turns WHERE provider = ps.provider),
                                     NEW.closed_at))
    FROM main.provider_session ps WHERE ps.id = NEW.session_id;`
const rewritten = ['type', 'payload', 'session_id', 'ordinal', 'created_at', 'generation']
  .map((column) => `OLD.${column} IS NOT NEW.${column}`)
  .join(' OR ')
const watch = `CREATE TEMP TABLE IF NOT EXISTS provider_wall_watch (
    id INTEGER PRIMARY KEY CHECK (id = 0), revision INTEGER NOT NULL DEFAULT 0,
    turns_for TEXT, turns_after INTEGER NOT NULL DEFAULT 0, turns_last INTEGER NOT NULL DEFAULT 0,
    emptied_through INTEGER NOT NULL DEFAULT 0);
  CREATE TEMP TABLE IF NOT EXISTS provider_wall_added (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_row INTEGER NOT NULL);
  CREATE TEMP TABLE IF NOT EXISTS provider_wall_turns (
    provider TEXT PRIMARY KEY, at INTEGER NOT NULL);
  CREATE TEMP TRIGGER IF NOT EXISTS provider_wall_event_added AFTER INSERT ON main.events
    WHEN NEW.type IN (${terms})
    BEGIN
      INSERT INTO provider_wall_added (event_row) VALUES (NEW.rowid);
      UPDATE provider_wall_watch SET emptied_through = (SELECT max(id) FROM provider_wall_added)
        WHERE id = 0
          AND (SELECT max(id) FROM provider_wall_added) - emptied_through > ${WALL_QUEUE_AT_MOST};
      DELETE FROM provider_wall_added
        WHERE id <= (SELECT emptied_through FROM provider_wall_watch WHERE id = 0);
    END;
  CREATE TEMP TRIGGER IF NOT EXISTS provider_wall_event_removed AFTER DELETE ON main.events
    WHEN OLD.type IN (${terms})
    BEGIN ${bump} END;
  CREATE TEMP TRIGGER IF NOT EXISTS provider_wall_event_rewritten AFTER UPDATE ON main.events
    WHEN (OLD.type IN (${terms}) OR NEW.type IN (${terms})) AND (${rewritten})
    BEGIN ${bump} END;
  CREATE TEMP TRIGGER IF NOT EXISTS provider_wall_turn_added AFTER INSERT ON main.turn
    WHEN NEW.end_reason = 'completed'
    BEGIN ${newestCompleted} END;
  CREATE TEMP TRIGGER IF NOT EXISTS provider_wall_turn_completed AFTER UPDATE ON main.turn
    WHEN NEW.end_reason = 'completed'
    BEGIN ${newestCompleted} END;
  CREATE TEMP TRIGGER IF NOT EXISTS provider_wall_turn_reopened AFTER UPDATE ON main.turn
    WHEN OLD.end_reason = 'completed' AND (NEW.end_reason IS NOT 'completed'
      OR NEW.closed_at IS NOT OLD.closed_at OR NEW.session_id IS NOT OLD.session_id)
    BEGIN ${bump} END;
  CREATE TEMP TRIGGER IF NOT EXISTS provider_wall_turn_removed AFTER DELETE ON main.turn
    WHEN OLD.end_reason = 'completed'
    BEGIN ${bump} END;
  CREATE TEMP TRIGGER IF NOT EXISTS provider_wall_provider_changed
    AFTER UPDATE ON main.provider_session
    WHEN OLD.provider IS NOT NEW.provider OR OLD.id IS NOT NEW.id
    BEGIN ${bump} END;`

/** The watch's tables and triggers, and the table each trigger is on. */
const WATCH_TABLES = ['provider_wall_watch', 'provider_wall_added', 'provider_wall_turns']
const WATCH_TRIGGERS = [
  ['provider_wall_event_added', 'events'],
  ['provider_wall_event_removed', 'events'],
  ['provider_wall_event_rewritten', 'events'],
  ['provider_wall_turn_added', 'turn'],
  ['provider_wall_turn_completed', 'turn'],
  ['provider_wall_turn_reopened', 'turn'],
  ['provider_wall_turn_removed', 'turn'],
  ['provider_wall_provider_changed', 'provider_session'],
] as const
const holdsOn = new WeakMap<Database.Database, Database.Statement>()
let installs = 0

/** Whether every table and trigger of the watch is still in place on this connection. */
export function providerWallsWatched(db: Database.Database): boolean {
  let holds = holdsOn.get(db)
  if (holds === undefined) {
    holds = db.prepare(
      `SELECT count(*) AS n FROM sqlite_temp_master
        WHERE (type = 'table' AND name IN (${WATCH_TABLES.map((name) => `'${name}'`).join(', ')}))
           OR (type = 'trigger' AND (name, tbl_name) IN
                (VALUES ${WATCH_TRIGGERS.map(([name, table]) => `('${name}', '${table}')`).join(', ')}))`,
    )
    holdsOn.set(db, holds)
  }
  return (holds.get() as { n: number }).n === WATCH_TABLES.length + WATCH_TRIGGERS.length
}

/**
 * Temp tables and triggers on one connection, saying what changed under a provider wall read since
 * it was kept:
 *  - `provider_wall_added`, each row of {@link PROVIDER_WALL_EVENT_TYPES} written, in order;
 *  - `provider_wall_watch.revision`, counting each such row removed or rewritten, each completed
 *    turn removed or reopened, and each conversation whose provider changed: what only a whole read
 *    can account for;
 *  - `provider_wall_turns`, the newest completed turn of each provider, and in
 *    `provider_wall_watch` how far it is filled, and for which count.
 * Each kept read on the connection (one per connection object a store was made on) reads the queue
 * from its own place. A read that has taken all of it in empties it once it is long, and says how
 * far in `emptied_through`: a read that had taken in less begins again. Emptying it moves
 * `total_changes()`, which tells the limits worker the database changed under its read, so it is
 * emptied seldom. A write that would leave more than {@link WALL_QUEUE_AT_MOST} rows in it since
 * then empties it itself, so a hold never takes in more. Temp writes roll back with the
 * transaction that made them, so a kept read never counts a row that was not kept. Another
 * connection's writes are not seen here; `data_version` says there were some.
 *
 * Left as it is when it is whole. Otherwise put in place whole or not at all: whatever part of it
 * is left from before is dropped first, so nothing it was keeping (its revision, its queue, its
 * filled turns) outlives a loss, whichever store finds it. Returns false where the connection
 * cannot hold it, as one set to query only cannot. Asked outside a transaction.
 */
export function watchProviderWalls(db: Database.Database): boolean {
  try {
    // A REPLACE deletes a row as a DELETE does, and must say so as one does.
    db.pragma('recursive_triggers = ON')
    if (providerWallsWatched(db)) return true
    db.transaction(() => {
      // Put back whole: what survived a loss is not trusted.
      db.exec(
        [
          ...WATCH_TRIGGERS.map(([name]) => `DROP TRIGGER IF EXISTS temp.${name};`),
          ...WATCH_TABLES.map((name) => `DROP TABLE IF EXISTS temp.${name};`),
        ].join('\n'),
      )
      db.exec(watch)
      // Its revision begins past every one this process has used, so no read kept before it
      // was put back can take it for its own.
      db.prepare('INSERT OR IGNORE INTO provider_wall_watch (id, revision) VALUES (0, ?)').run(
        ++installs * 2 ** 32,
      )
    })()
    return true
  } catch {
    return false
  }
}
