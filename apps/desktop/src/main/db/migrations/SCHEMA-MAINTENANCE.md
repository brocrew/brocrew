# Schema maintenance

Some database objects are written by hand rather than generated from `schema.ts`:

- indexes and triggers in migrations that `schema.ts` does not declare;
- the question copies' derived tables, index and triggers, created at open (`../question-copies.ts`).

**A generated rebuild of a table drops them.** A migration that rebuilds a table the generator's
way (create a new table, copy the rows, drop the old, rename) loses every index and trigger on it
that `schema.ts` does not declare.

**So:**

- **A new hand-written index or trigger** joins `HAND_WRITTEN_OBJECTS` in `../question-copies.ts`.
  `hand-written-schema-survives-a-rebuild.test.ts` fails until it does.
- **A migration that rebuilds a table** recreates that table's hand-written objects in the same
  migration.
- **At open,** a missing copy trigger is recreated and the copies' fill starts again. A missing
  hand-written index is named, its reads take the slower way, and only a migration restores it.
- **The question copies are derived data, outside the journal,** a narrow exception: an older build
  opens the file, and its writes keep the copies current through the triggers stored in it.
