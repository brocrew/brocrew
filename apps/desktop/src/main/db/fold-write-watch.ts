import type Database from 'better-sqlite3'
import { FOLD_TYPE_LIST } from './fold-index'

let watches = 0
const names = new WeakMap<object, string>()

/** The triggers of the watch that calls `written`, all on `events`; none before it is made. */
export function foldWatchTriggers(written: object): readonly string[] {
  const name = names.get(written)
  return name === undefined ? [] : [`${name}_insert`, `${name}_delete`, `${name}_update`]
}

/**
 * Temp triggers on one connection that call `written` for every insert, update or delete of a
 * fold row on it, whoever makes it: a store, another store, or plain SQL. `written` is told the
 * row's conversation, generation and ordinal, and whether it was an insert; an update calls it for
 * the row before and after. Each watch has triggers and a function of its own, so several stores on
 * one connection each hear every write. Another connection's writes are not heard here.
 *
 * Its triggers are put in place whole or not at all, and asked again for one `written` after a
 * failure; returns false where the connection cannot hold them. Asked outside a transaction.
 */
export function watchFoldWrites(
  db: Database.Database,
  written: (session: unknown, generation: unknown, ordinal: unknown, inserted: boolean) => void,
): boolean {
  let name = names.get(written)
  if (name === undefined) {
    name = `fold_row_written_${String(++watches)}`
    names.set(written, name)
  }
  const call = (row: string, inserted: 0 | 1) =>
    `SELECT ${name}(${row}.session_id, ${row}.generation, ${row}.ordinal, ${String(inserted)});`
  try {
    // A REPLACE deletes a row as a DELETE does, and must say so as one does.
    db.pragma('recursive_triggers = ON')
    db.function(name, { deterministic: false }, (session, generation, ordinal, inserted) => {
      written(session, generation, ordinal, inserted === 1)
      return null
    })
    db.transaction(() =>
      db.exec(`CREATE TEMP TRIGGER IF NOT EXISTS ${name}_insert AFTER INSERT ON main.events
          WHEN NEW.type IN (${FOLD_TYPE_LIST})
          BEGIN ${call('NEW', 1)} END;
        CREATE TEMP TRIGGER IF NOT EXISTS ${name}_delete AFTER DELETE ON main.events
          WHEN OLD.type IN (${FOLD_TYPE_LIST})
          BEGIN ${call('OLD', 0)} END;
        CREATE TEMP TRIGGER IF NOT EXISTS ${name}_update AFTER UPDATE ON main.events
          WHEN OLD.type IN (${FOLD_TYPE_LIST}) OR NEW.type IN (${FOLD_TYPE_LIST})
          BEGIN ${call('OLD', 0)} ${call('NEW', 0)} END;`),
    )()
    return true
  } catch {
    return false
  }
}
