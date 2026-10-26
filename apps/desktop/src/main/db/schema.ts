import { sql, type SQL } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'
// ⚑ **D-016 · R6 — the vocabularies a CHECK here closes are read off the descriptors the wire is
// built from**, never typed a second time. ⚠️ Both modules import nothing, so loading this file —
// `drizzle-kit` does, to generate a migration — pulls in nothing else.
import {
  CAPABILITY_FIELDS,
  MAX_CAPABILITY_COUNT,
  type AnyCapabilityField,
} from '../../shared/capabilities'
import { RESOURCE_ROLES } from '../../shared/documents'
// ⚑ **F071 · the fold index's types**, the list its readers repeat — see that module.
import { FOLD_TYPE_LIST } from './fold-index'

/**
 * **The database, whole.** D-016 generated ONE migration from this file (`0000_the_tree.sql`), and
 * this file is the schema: nothing else declares a table, a column or a constraint.
 *
 * ⛔ **Every table but one was created by that migration.** A database built before D-016 is refused
 * rather than upgraded: its tables already exist, so `0000` fails and the migrator rolls it back.
 * ⚑ **D-042 upgrades in place** (`0001_the_model_list.sql`): {@link providerModelSetting}, and two
 * columns on {@link providerSession} — no rows, nothing backfilled. ⚑ **D-050 upgrades in place**
 * (`0002_no_agent_limit.sql`): it drops two of {@link providerModelSetting}'s columns, and every
 * other value stays. ⚑ **`0003_the_api_keys.sql` upgrades in place**: it adds
 * {@link providerApiKey}, empty. The dispatches each comment cites say how a table came to be what
 * it is.
 *
 * The conventions every table follows:
 *   - text ids, minted by the app — prefixed (`ids.ts`) or derived from a natural key
 *     (`identity.ts`); no UUID defaults;
 *   - timestamps are integer epoch milliseconds;
 *   - an "enum" is text, closed by a CHECK or by the one fold every reader goes through;
 *   - `events` is an append-only ledger keyed by a per-session ordinal.
 */

/** A SQL list of string literals, e.g. `'none', 'any'` — for a CHECK over a closed vocabulary. */
function oneOf(words: readonly string[]): SQL {
  return sql.raw(words.map((word) => `'${word.replaceAll("'", "''")}'`).join(', '))
}

/**
 * ⚑ **D-016 · R6 — one capability's CHECK, built the way the wire builds its rule for the same
 * field** (`capabilityValueSchema` in `main/runtime/ipc.ts`): a whole number from 0 to
 * {@link MAX_CAPABILITY_COUNT} (the wire's `.int()`, and so `typeof` is asked as well as the
 * range), or a word from the field's own vocabulary. NULL is *nobody has chosen*, which reads as
 * the ruled default.
 *
 * ⛔ **So a value the capability sheet may send is a value this column admits, and nothing else is**:
 * a hand-edited row cannot hold a word the wire would refuse.
 */
function capabilityCheck(field: AnyCapabilityField, column: AnySQLiteColumn): SQL {
  switch (field.editor) {
    case 'count':
      return sql`${column} IS NULL OR (typeof(${column}) = 'integer' AND ${column} BETWEEN 0 AND ${sql.raw(String(MAX_CAPABILITY_COUNT))})`
    case 'choice':
      if (field.vocabulary === undefined || field.vocabulary.length === 0) {
        throw new Error(`capability ${field.key} is a choice with no vocabulary`)
      }
      return sql`${column} IS NULL OR ${column} IN (${oneOf(field.vocabulary)})`
  }
}

/**
 * 🔴 **The identity itself — GLOBAL, and the thing a profile IS** (369, HO-009 §4, HO-010 ruling 6).
 *
 * Keep identities global so a profile such as `notes-app-explorer` carries memory
 * across tickets instead of starting with a new home for each piece of work.
 *
 * ⛔ **The capability columns live HERE, and that is a ruling rather than a convenience** (369 §3).
 * A grant is a statement about *who this agent is*, and every rail reads it by the identity's slug
 * (`SessionStore.capabilitiesOf`).
 *
 * ⛔ **`id` is `aid:<folded slug>`, DERIVED rather than generated**: every writer computes the same
 * id from the same fact, so `INSERT OR IGNORE` is all the concurrency control it needs
 * (`db/identity.ts`). 187 has ruled since forever that a renamed slug is a **different identity** —
 * *"a profile is its folder"* — so the slug is not a mutable scope and deriving from it carries no
 * drift. ⚑ `:` is not in `PATH_SEGMENT_PATTERN`, so no slug can spell a separator.
 */
export const agentIdentity = sqliteTable(
  'agent_identity',
  {
    /** `aid:<folded slug>` — derived. See the table comment. */
    id: text('id').primaryKey(),
    /**
     * ⛔ **The canonical name, FOLDED, and globally unique.** The CHECK below is what makes that a
     * database fact: SQLite's `lower()` folds ASCII `A`–`Z` and nothing else, which is exactly what
     * {@link foldProfileName} does.
     *
     * ⚠️ **Not the directory name.** A caller that wants the DIRECTORY reads
     * {@link providerSession.profileId} for a session.
     */
    slug: text('slug').notNull(),
    /**
     * A human name, or null.
     *
     * 🔴 **558 · TWO writers, and which one may overwrite is `HO-016` §2.** ⛔ The app's is
     * `ensureIdentityRow`'s `INSERT OR IGNORE`, which cannot touch a row that exists; a person's is
     * `UPDATE agent_identity SET display_name = ?`, behind `requireAPerson`. ⚑ So a seed can never
     * land on top of a name somebody chose, and that is a property of the statement shapes rather
     * than of an ordering anybody has to remember —
     * `a-name-the-app-mints-for-itself.test.ts` §4 is the census.
     */
    displayName: text('display_name'),
    /**
     * ⚑ **How deep a piece of work this identity may give** (341, HO-005 Q3; D-016) — or null for the
     * ruled default.
     *
     * **Work a person gave is depth 0 — a conversation's own work, its root `W1`, and a piece it
     * took on for the person, `W1.2` (D-016 · commit 6); a piece given under either is depth 1 —
     * `W1.1`, `W1.2.1`.**
     * The give rail counts on `work`, reading up the piece's parents to the nearest one a person
     * gave.
     *
     * ⛔ **Read from the GIVER's row, not the receiver's.** The question the rail asks is *"may this
     * agent give work this deep"*, which is a fact about the agent asking.
     *
     * ⚠️ **Overridable per identity on purpose** — *"an exception you can point at is safe; a default
     * nobody chose is not"*. A per-row number is a decision with a row to blame for it. The CHECK
     * admits what the wire admits: 0 to `MAX_CAPABILITY_COUNT`.
     */
    maxDepth: integer('max_depth'),
    /**
     * ⚑ **Which conversations this identity may send a message to** (341, HO-005) — or null for the
     * ruled default, which since `549` is **any** (HO-058 §1: *a message consumes nothing, destroys
     * nothing, and transfers no authority*).
     */
    canMessage: text('can_message'),
    /**
     * 🔴 **{@link ProfileCapabilities.canAssignWork} — whether this identity may give WORK, which is
     * a different act from speaking to a conversation** (553, HO-060 §2; `give_work` since D-016).
     *
     * ⚠️ **Nullable with no SQL DEFAULT.** A NULL reads as the ruled word, and a default written into
     * a row would freeze today's ruling into a row that never chose.
     */
    canAssignWork: text('can_assign_work'),
    /**
     * 🔴 **{@link ProfileCapabilities.canCreateAgents} — whether this identity may bring another
     * identity into existence** (419, HO-020 §4).
     *
     * ⚠️ **`CREATION_REACH` and not `MESSAGING_REACH`**: the two vocabularies share their words today
     * and are two types, so a word of one cannot pass as a word of the other.
     */
    canCreateAgents: text('can_create_agents'),
    /**
     * 🔴 **{@link ProfileCapabilities.canWriteRules} — whether this identity may reach into another
     * identity's own instructions** (582, `HO-009` §2.2).
     *
     * ⚠️ **Not seeded, deliberately.** Seeding it would be this app deciding, on a person's behalf
     * and without showing them, that one agent may rewrite what every other agent is told. ⛔
     * **`HO-052` §1's own limit** — *categories seed, they do not decide* — read at the one place
     * where the seeded value would remove a person from a loop rather than put them in one. ⚑ It is
     * one choice in the grant sheet, visible like every other.
     */
    canWriteRules: text('can_write_rules'),
    /**
     * 🔴 **Which provider this identity's NEXT conversation runs on — or null, which means nobody
     * has said** (419, HO-023 §3).
     *
     * ⛔ **A default for the next conversation and NEVER a change to a live one**, and that is a
     * measurement rather than a preference. `417` established it: `provider` is the only REQUIRED
     * field of `CreateSessionInput`, no `UPDATE provider_session` statement sets it, `createRuntime`
     * returns a different class per provider, and `external_ref` holds the old provider's thread id.
     * ⚑ Changing provider is an end-and-relaunch, so the place to record the choice is the thing that
     * OUTLIVES a conversation — the identity.
     *
     * ⚠️ **Written by the creation door, by the LAUNCH that mints a seeded identity's row, and by
     * one person-only verb — and by nothing else** (433). ⛔ **A launch still does not record what
     * it RAN ON**: an identity that first existed because a give happened to start it on Codex has
     * said nothing about what it prefers, and recording that accident would be `370`'s
     * infer-from-an-accident defect with a different column. ⚑ What a launch writes is
     * `seededProviderFor(slug)` — a constant keyed on the identity, not a fact about that launch —
     * and `INSERT OR IGNORE` means it writes it once in the life of a row.
     *
     * 🔴 **`setAgentProvider` is the second writer and the first one a PERSON drives** (433,
     * HO-024 §2.2's *"required, not planned"*). ⛔ `a-gesture-that-creates-an-agent.test.ts` §3
     * enumerates every statement that can move it. ⛔ **Null is *nobody has said* and is
     * deliberately not `codex`** — the renderer's `DEFAULT_PROVIDER` is the fallback for an identity
     * that has not said, which is a different fact from an identity that chose it.
     *
     * ⚠️ **No CHECK: the fold is `parseProvider` in `session-store.ts`**, and an unreadable word
     * folds to NULL, which is both the narrow direction and the value that changes nothing.
     */
    provider: text('provider'),
    /**
     * 🔴 **This identity's DEFAULT model and effort — what its new conversations start on — or NULL,
     * it has none** (677's column; D-042 · R2).
     *
     * ⚑ **One JSON value — `{"provider","model","effort"}` — and not three columns**, because the
     * three are one fact: *a model name belongs to a provider* (`R25` §1.2). Three nullable columns
     * could hold a model with no provider beside it, which is the one state that could send a Claude
     * model to Codex; one value cannot. ⚑ D-042 · `model` is always named; `effort` is `null` only
     * for a model that offers none. Clearing is NULL.
     *
     * ⛔ **Read when a conversation of this identity STARTS with nothing named for it** — R1's
     * second term, after what a give or a person named — and never by a conversation already
     * open: each keeps its own `provider_session.model` / `reasoning_effort` until it is changed
     * there (R2).
     *
     * ⛔ **No CHECK: the value is closed in code by `parseModelChoice`**, which folds anything it
     * cannot read to NULL. ⚠️ **Not seeded**: a seed would choose a model on a person's behalf.
     *
     * ⚑ **Three writers, each after the list admitted the pair**: a person's sheet
     * (`setAgentModelAndEffort`, behind `requireAPerson`); a person's change to one of its
     * conversations (`setSessionSetting`, which only that conversation's window reaches — a pair the
     * list does not hold stays that conversation's alone); and `create_agent`, for the agent it makes
     * (the one seam, `model-rails.ts`). ⛔ A give never writes it. ⚠️ `setAgentProvider` CLEARS a
     * default for another provider in the same act (`R31b`).
     */
    modelChoice: text('model_choice'),
    /**
     * 🔴 **WHO brought this identity into being — or NULL, nobody recorded it** (598, `HO-084` §1).
     *
     * ⚠️ **A record, and no rule reads it** (D-014). The ledger has no identity-creation event, so
     * *who created this* is underivable after the fact —
     * `a-derivation-cannot-answer-what-its-ledger-does-not-contain` — and the answer is a WRITE at
     * construction rather than a fold.
     *
     * ⛔ **THREE SHAPES, one column, and they cannot collide.** `'a-person'` — the window's door;
     * `'this-app'` — a launch or an adoption; `aid:<folded slug>` — the agent that called
     * `create_agent`, or gave work under a new name. ⚑ A slug cannot spell `:`
     * (`PATH_SEGMENT_PATTERN`), so the id form is unmistakable for either bare word —
     * `db/identity.ts` owns both halves of the encoding and `readIdentityCreator` is the only reader.
     *
     * ⛔ **No CHECK: the value is closed in code by `readIdentityCreator`**, which folds anything it
     * cannot read to NULL — the direction that claims nothing. ⚑ **And no FOREIGN KEY**: a
     * self-reference would need an `ON DELETE` rule, and every answer to *what happens to the rows an
     * agent created when that agent is removed* is a ruling nobody has made.
     *
     * ⚠️ **NULL on an identity recorded before `598`**, and nothing fills it in after the fact: a
     * claim written into a ledger is worse than a null when it is wrong.
     *
     * ⚑ **Written ONCE, by the `INSERT OR IGNORE` that mints the row, and by no statement after
     * it.** That is `HO-016` §2's shape on a fact rather than on a grant: a row that exists is
     * never re-aimed, so an identity cannot change who created it.
     */
    createdBy: text('created_by'),
    /** When this identity first existed. */
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('agent_identity_slug_uq').on(sql`${t.slug} COLLATE NOCASE`),
    // ⚑ **A SHAPE rule rather than a vocabulary**: the slug a row is keyed by must already be
    // folded, so a hand-written INSERT cannot put `Developer` where every reader will look for
    // `developer`. `lower()` and `foldProfileName` agree on every value `PATH_SEGMENT_PATTERN`
    // admits.
    check('agent_identity_slug_folded_ck', sql`${t.slug} = lower(${t.slug})`),
    // 🔴 **D-016 · R6 — one CHECK per capability, read off `CAPABILITY_FIELDS`** — see
    // {@link capabilityCheck}. ⚠️ `provider`, `model_choice` and `created_by` have none: their
    // vocabularies are closed by the fold every reader goes through, not by a wire descriptor.
    ...CAPABILITY_FIELDS.map((field) =>
      check(`agent_identity_${field.column}_ck`, capabilityCheck(field, t[field.key])),
    ),
  ],
)

/**
 * 🔴 **One external MCP server a person registered — GLOBAL, and the ROW says who it is for** (516,
 * HO-040 §4.2, `HO-042` §6, from `507` §2.1; the default moved here at 524, `HO-048` §1).
 *
 * ⛔ **Registration and permission were two acts and `HO-048` §1 made them one for the common case.**
 * HO-040 §4.2 had read *"Register the server once, globally. Grant it per identity"*, and the PO
 * withdrew it: *"is this server everyone's? is a property of the server, and the current model asks
 * it once per identity and can never answer it once."* ⚑ A row here means a person typed an address
 * AND said who it is for; {@link externalMcpServerGrant} is what reaches a row they restricted.
 *
 * ## ⛔ Five columns, and every absence is still a decision
 *
 * ⚠️ **No `enabled`, no status, no tool inventory, no provider, no last error, no last-seen time**
 * (`507` §2.1). A registry row says what a person CONFIGURED; what actually connected is the child's
 * own inventory, which `392` already reads and `SessionTools.vue` draws. ⛔ **No header and no
 * token**: stage 1 is unauthenticated loopback only (brief §4), and there is deliberately no column
 * a credential could land in by accident.
 *
 * `reach` says who may use a registered server; removing the row removes the server for everyone. It does not record whether the server is enabled, connected or alive.
 *
 * ## 🔴 The URL is IMMUTABLE, and the PO endorsed that by name
 *
 * `HO-042` §6: ⛔ *"a mutable URL would let one global row silently retarget every identity that
 * already trusted it."* ⚑ **So there is no save verb on the wire** — changing an endpoint is
 * remove-and-add, which cascades every grant away and makes a person grant the new target
 * deliberately. ⚠️ The absence of an UPDATE statement is the enforcement; `one-local-server-one-identity.test.ts`
 * §2 is the census that keeps it absent.
 *
 * ## ⚑ The name's fold is a CHECK
 *
 * ⛔ **The fold is a DATABASE fact**, exactly as `agent_identity_slug_folded_ck` makes it one for an
 * identity: a hand-written INSERT cannot put `Jira` where every reader will look for `jira`.
 */
export const externalMcpServer = sqliteTable(
  'external_mcp_server',
  {
    /** `ems:<folded name>` — derived. See {@link agentIdentity.id} for why nothing here is generated. */
    id: text('id').primaryKey(),
    /**
     * ⛔ **The namespace both providers publish this server's tools under**, folded and globally
     * unique.
     *
     * ⚠️ **`__` is refused at the door and not by a CHECK**, deliberately: `tool-inventory.ts` splits
     * a qualified name at the FIRST `__` (`507` F4), which is a representational rule about two
     * providers' spelling rather than a shape rule about this column — and a person meeting it needs
     * the sentence `externalMcpNameRefusal` gives them, not a constraint violation.
     */
    name: text('name').notNull(),
    /** ⛔ The endpoint, validated loopback at the door. Immutable — see the table comment. */
    url: text('url').notNull(),
    /** When a person added it — durable audit, and the order the registry is drawn in. */
    registeredAt: integer('registered_at').notNull(),
    /**
     * 🔴 **524 · who this server is for — and the answer belongs to the SERVER** (`HO-048` §1).
     *
     * ⛔ **`'everyone'` is the DEFAULT and it is a database fact, not a reader's convention.** The
     * PO: *"a registration form that starts restricted and asks a person to open it up would
     * reproduce today's cost with one extra click, which is not a fix. It starts open."* ⚑ So the
     * column is `NOT NULL DEFAULT 'everyone'`.
     *
     * ## ⛔ NO CHECK — the reader closes the vocabulary, and closes it the safe way
     *
     * ⚑ `foldExternalMcpReach` answers `'restricted'` for every value that is not literally
     * `'everyone'`, so a typo, a hand-edit or a word a later build writes NARROWS rather than
     * widens; it is the one rule, and every reader goes through it. ⚠️ D-016's migration built this
     * table afresh and added no CHECK beside that fold: the capability columns are the only
     * vocabularies it moved into the database, because their descriptors are the wire's (D-016 ·
     * R6). ⚑ **`NOT NULL` covers the one shape a fold cannot see coming**, and it rides the
     * `DEFAULT`.
     *
     * 🔴 **The DEFAULT and the FOLD point in opposite directions, and that is deliberate.** They
     * answer two different questions: *what does a person who said nothing get* (the widest, which
     * is the ruling) and *what does a value this app cannot read mean* (the narrowest, which is
     * every other fold in this file).
     */
    reach: text('reach').notNull().default('everyone'),
  },
  (t) => [
    uniqueIndex('external_mcp_server_name_uq').on(sql`${t.name} COLLATE NOCASE`),
    // ⚑ **`agent_identity_slug_folded_ck`'s rule one table over**: the name a row is keyed by must
    // already be folded, because the id is
    // derived from the fold and a stored `Jira` would key `ems:jira` and read back as a different
    // spelling. `lower()` and `foldProfileName` agree on every value `PATH_SEGMENT_PATTERN` admits.
    check('external_mcp_server_name_folded_ck', sql`${t.name} = lower(${t.name})`),
  ],
)

/**
 * 🔴 **One identity may reach one registered server — and the ROW ITSELF is the grant** (516,
 * HO-040 §4.2, endorsed in `HO-042` §6).
 *
 * ⛔ **No nullable boolean and no role-derived default**, which the PO endorsed by name. ⚑ There are
 * exactly two states — a row or no row — so there is no third value for a reader to interpret, no
 * NULL to fold, and nothing for `role` to be inferred from (standing rule 10). ⚠️ It is also why
 * this is a table rather than a column on `agent_identity`: a grant is a RELATION between two rows,
 * and `507` §5 is explicit that server ids do not belong in the fixed `CAPABILITY_FIELDS` fold.
 *
 * ⛔ **Both foreign keys cascade**, and each direction is a decision:
 *  - an identity that is deleted takes its grants with it, because a grant naming nobody is a row
 *    no door could ever read;
 *  - a server that is removed takes every grant with it, which is the sentence
 *    {@link EXTERNAL_MCP_REMOVAL_MEANS} says out loud BEFORE the press — removing a global row is
 *    the only way to change an address, so the cascade is on the path a person actually walks.
 *
 * ⚠️ **`granted_at` records the person's act and nothing reads it as policy.** It is the audit half
 * of *row presence is the grant*: the row answers *may it*, this answers *since when*.
 */
export const externalMcpServerGrant = sqliteTable(
  'external_mcp_server_grant',
  {
    /** `emg:<folded identity slug>:<folded server name>` — derived, like every id in this schema. */
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => externalMcpServer.id, { onDelete: 'cascade' }),
    grantedAt: integer('granted_at').notNull(),
  },
  (t) => [
    // ⛔ **One grant per pair, enforced by the database and not by a reader remembering.** The id is
    // derived from the same two facts, so this index and the primary key say the same thing twice —
    // deliberately: the id makes a duplicate impossible to WRITE, and this makes it impossible to
    // EXIST, including for a row somebody inserted by hand with an id of their own.
    uniqueIndex('external_mcp_server_grant_uq').on(t.identityId, t.serverId),
    index('external_mcp_server_grant_identity_idx').on(t.identityId),
  ],
)

/**
 * 🔴 **The one switch that is not about any identity** (341, HO-005 criterion 7).
 *
 * ⛔ **One row, app-wide, and the CHECK is what makes that a database fact rather than a
 * convention.** `id` may only ever be `'policy'`, so a second row is not a thing a writer has to
 * remember not to create — it is a constraint violation. The alternative was worse: a column on
 * {@link agentIdentity} would be N switches and none of them global.
 *
 * ⚑ **Absence is OFF, and that is deliberate.** `SessionStore.spawnPolicy` answers *not enabled* for
 * a database with no row, and {@link NULL_SESSION_STORE} answers the same — so a host with no
 * database, or a row somebody deleted, refuses rather than defaulting open. A kill switch whose
 * broken state is *on* is not a kill switch. ⛔ **The one migration inserts the enabled row by
 * hand**, below the statements `drizzle-kit` generated (it writes no data rows), so an ordinary
 * install starts with it on.
 *
 * ⚠️ **D-016 · it refuses only what would START a conversation** — a give that finds no conversation
 * the giver already has with that agent, and `create_agent`. Work given to a conversation that
 * already exists still goes.
 *
 * ⚠️ **It does not end running conversations.** One already in flight when the switch is thrown
 * keeps going, because stopping work mid-turn is a different act with different consequences and
 * nothing asked for it.
 */
export const appPolicy = sqliteTable(
  'app_policy',
  {
    /** Always the literal `policy` — see the CHECK below, which is what enforces it. */
    id: text('id').primaryKey(),
    /**
     * The global kill switch. `1` is on, `0` is off, and **no row at all is also off** — see the
     * table comment for why absence is the safe direction rather than the convenient one.
     */
    spawningEnabled: integer('spawning_enabled').notNull().default(1),
    /**
     * 🔴 **The mode every conversation a PERSON starts begins in** (500, HO-036 §3.1) — *"a person
     * sets their approval mode once, and every conversation they start begins there."*
     *
     * ## ⛔ Why it is on THIS table and not on an identity
     *
     * ⚑ **It is a person's preference, and this is the only row in the schema that is about nobody
     * in particular.** A column on {@link agentIdentity} would be N preferences and none of them the
     * person's. ⚠️ **The singleton CHECK is what makes *one value, one owner* a database fact**
     * rather than a convention a later writer has to remember.
     *
     * ⛔ **It is not a capability and it cannot become one.** Nothing reads it to decide what an
     * agent may do; it decides what a LAUNCH asks for, and only at the two doors a person presses.
     * Standing rule 10's neighbour: a rail that keyed on this would be reading a preference to
     * answer a permission question.
     *
     * ## ⚠️ Nullable, no DEFAULT, and no CHECK — each for its own reason
     *
     * - **Nullable** because *nobody has chosen* is a real answer and is not `'ask'`. ⚑ A fresh
     *   install has never been asked, and the seeded row names three columns, so it reads NULL.
     * - **No DEFAULT**: the default belongs in code, where changing it changes every row that has
     *   not chosen.
     * - **No CHECK**: the vocabulary is closed in the READER, and closed the safe way —
     *   {@link SessionStore.defaultApprovalMode} folds anything it does not recognise to `'ask'`,
     *   which is the NARROWEST meaning and never the widest. A typo in this column cannot widen what
     *   an agent may do without asking.
     *
     * ## ⚑ What a reset does to it, said here because the answer is load-bearing
     *
     * ⛔ **`pnpm clean-base` deletes `brobot2.sqlite`, so this value does not survive a reset** —
     * and that is the decision, not an accident of where it landed. A clean base is what a
     * first-time install looks like, and a first-time install has never been asked; a preference
     * that outlived the reset would hand a *fresh* machine a standing consent to run every
     * conversation unattended. ⚠️ The reset's own summary line says so.
     *
     * ⚠️ **One person.** `app_policy` is one row and the door in front of it asks only whether a
     * PERSON is behind the channel, never which one — so this is app-wide with a person-gate,
     * exactly as the kill switch above is, and it would have to be re-scoped the day this app has
     * two people in it.
     */
    defaultApprovalMode: text('default_approval_mode'),
    /** When the switch was last thrown, so a person can tell a fresh install from a decision. */
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [check('app_policy_singleton_ck', sql`${t.id} = 'policy'`)],
)

/**
 * 🔴 **D-042 · the model list a PERSON keeps, one row per provider** (09 §2, §8; R2, R3). ⚑ **D-050
 * drops two of the columns `0001` created** (`0002_no_agent_limit.sql`; 09 §11): `agent_models` and
 * `agent_highest_effort`.
 *
 * ⚑ **Two facts about the person's list, none about an identity or a conversation**: the models
 * they added by hand, and the model and effort they last picked. ⛔ **A table, and not columns on
 * {@link appPolicy}**: those are one singleton row's fixed columns, and each fact here is per
 * provider — one row per provider is what the reader folds.
 *
 * ⚑ **Absence is the plain answer on every column**: no row, or NULL, is *none added* and *nothing
 * picked yet*. ⛔ **No CHECK**: `provider` is folded by `parseProvider` in the reader, and the JSON
 * column by its reader, unreadable folding to none.
 *
 * ⚑ **Written only from a person's doors**: the add and delete of a hand-added model (behind
 * `requireAPerson` in `ipc.ts`), and the last pick — a person's settings change, their sheet, and a
 * conversation they start naming a model, each only a pair the list holds.
 */
export const providerModelSetting = sqliteTable('provider_model_setting', {
  /** The provider these facts are about — `claude` or `codex`. */
  provider: text('provider').primaryKey(),
  /**
   * ⚑ **The models a person added by hand**, a JSON string array, or NULL — none. ⛔ Never checked
   * when added (R3: no test call, nothing spent); a provider that refuses one says so at its call.
   */
  handAdded: text('hand_added'),
  /** ⚑ **The model the person last picked on this provider**, or NULL — nothing picked yet. */
  lastModel: text('last_model'),
  /** Its effort — NULL beside a model, when that model offers none. */
  lastEffort: text('last_effort'),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * 🔒 **The API key a PERSON entered for a provider, sealed** — one row per provider that has one.
 *
 * ⛔ **Never the key itself.** `sealed` is the key encrypted with Electron's `safeStorage` (on macOS,
 * by a key the system Keychain holds for this app), as base64; this database alone cannot give the
 * key back. ⚑ **No row is no key**: the provider runs on its machine login, as before.
 *
 * ⚑ **Written only from a person's doors** (behind `requireAPerson` in `ipc.ts`), and read only to
 * hand the key to a launch (`api-keys.ts`). Nothing reads it back to the window: the window is told
 * only whether a key is set.
 */
export const providerApiKey = sqliteTable('provider_api_key', {
  /** The provider the key is for — `claude` or `codex`. */
  provider: text('provider').primaryKey(),
  /** The key, encrypted by `safeStorage`, base64. Never the key in the clear. */
  sealed: text('sealed').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const providerSession = sqliteTable(
  'provider_session',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    // Provider thread/session ref used to resume; unknown until the session starts.
    externalRef: text('external_ref'),
    /**
     * 🔴 **727 · R87 — the provider session id this conversation's LAUNCH asked for** (Claude's
     * `Options.sessionId`, minted in `ClaudeRuntime.start`), or null.
     *
     * ⚑ The ruling: *"The session id a launch hands the CLI is recorded durably BEFORE the CLI
     * [can write], so no kill at any moment can leave a transcript that no row names."* `722`'s R79
     * named a conversation at its CLOSE; a launch that never closed — the app killed between the
     * CLI's first write and `system/init`, an error before init, a close whose exit receipt timed out
     * — left a transcript that {@link externalRef} did not name, and the next adoption scan listed
     * it as somebody else's.
     *
     * ⛔ **Written by `store.create`, in the transaction that writes the row** — from `onRegistered`,
     * after the provider has started (`402` F3) and before any message can reach it: the host sends
     * nothing until `register` has returned, and the CLI writes nothing until a message reaches it
     * (`722`'s probe, never-sent arm). ⚠️ So "before the CLI can write", not "before it starts": no
     * row exists before the provider starts.
     *
     * ⛔ **Not a ref, and never read as one**: nothing resumes or archives by it. The adoption scan
     * asks it after {@link externalRef} (`findByProviderRef`), and a row it names that holds no ref
     * yet is given the one the scan read off the transcript (`nameItsLaunch`) — so the conversation
     * is reachable, not merely unlisted.
     *
     * ⚠️ **Nullable, no DEFAULT and no CHECK** — null means *"no launch of ours named an id"*: every
     * Codex row, every resume-only life, every adopted or restored row, and every Claude row recorded
     * before `727`.
     */
    launchedAs: text('launched_as'),
    cwd: text('cwd').notNull(),
    status: text('status').notNull().default('idle'),
    /**
     * Whether the session prompts for consequential actions (078). Persisted because it is the
     * one launch decision that cannot be re-derived on resume: the provider re-reports its model
     * and its home, but nothing tells us afterwards whether the user opted out of prompting.
     * Resuming a `auto` session as `ask` (or worse, the reverse) would silently change what the
     * agent is allowed to do. Nullable: rows written before this column existed genuinely do not
     * know, and guessing would be the lie this column exists to prevent.
     */
    approvalMode: text('approval_mode'),
    /**
     * The profile whose provider home this session ran in (085) — the shared-vs-isolated
     * memory boundary. Persisted for the same reason as {@link approvalMode}: resume cannot
     * re-derive it, and resuming into the wrong home means the provider cannot find the
     * conversation at all. Nullable: rows written before profiles could be chosen ran in a
     * directory called `default`, and `DEFAULT_PROFILE_ID` is what they resume into — read off the
     * schema, not guessed. ⛔ **620 · the second of those was spelled `default` too, and `592`
     * renamed it**; ⚠️ where those bytes ARE has not moved and what this app ANSWERS has.
     */
    profileId: text('profile_id'),
    /** Original managed-root-relative storage address; null retains the legacy path rules. */
    providerHome: text('provider_home'),
    /**
     * The reasoning effort this session was created with (024). Persisted for exactly the reason
     * {@link approvalMode} and {@link profileId} are: resume cannot re-derive it, and a
     * conversation that came back thinking harder or softer than it was started with would be a
     * silent change to how it behaves. Nullable: rows written before the column, and adopted
     * sessions we never ran, asked for nothing — which is not the same as asking for medium.
     *
     * ⚠️ **"created with" is the first writer, not the only one** — {@link model}'s writers, the
     * same four (D-042 · R1): the value is what every later start replays. ⚑ NULL beside a model
     * that offers no effort. ⚑ **Measured, and why the replay matters**: a Claude resume that names
     * no effort runs on the CLI's own default, not on the last one asked for
     * (`claude-resume-model-probe.smoke.ts`, step D2); Codex keeps the thread's last
     * (`codex-resume-model-probe.smoke.ts`, step D2).
     */
    reasoningEffort: text('reasoning_effort'),
    /**
     * The model this session was asked to run (038). The comment on {@link approvalMode} says the
     * provider "re-reports its model" on resume, and it does — but that is the model it CHOSE, and
     * once a session can ask for one, the two stop being the same fact. A conversation started on a
     * small model and resumed onto the provider's default would answer differently and cost
     * differently, with only the reported value to notice it by, after the fact.
     *
     * 🔴 **D-042 · R1 — the model this conversation is SELECTED to run, and every start names it**:
     * written at its launch (what a give or a person named, else its agent's default, else the last
     * pick, else the provider's default by name), by a person's change, by a give that switches it,
     * and by the first start of a row that named none. ⚠️ NULL only for a row nothing has started
     * since D-042, or an adopted one. ⚑ What the provider REPORTS is {@link reportedModel}: an
     * alias resolves, and a provider may run another. ⚑ **Measured, both providers**: a resume
     * that names no model continues on the model the conversation LAST ran, and one that names a
     * model switches to it and stays switched (`{claude,codex}-resume-model-probe.smoke.ts`).
     */
    model: text('model'),
    /**
     * Whether this session was started in PLAN MODE (030). Persisted for the same reason as the
     * three settings above: resume cannot re-derive it. ⚠️ **741 · R99 (corrected)** — a reopen no
     * longer resumes planning (as the CLI's resume does not): a row that planned is resumed as
     * released, and a plan still open at the close gets its {@link planEndedAt} at the reopen.
     *
     * Integer, because SQLite has no boolean. Nullable, and null means "a row from before this
     * column" — which is not the same as `0`, though both resume without plan mode; the difference
     * is that one is a recorded choice and the other is the absence of one.
     */
    planMode: integer('plan_mode', { mode: 'boolean' }),
    /**
     * When the user gave this planning session the GO-AHEAD (060) — epoch ms, null while it is
     * still planning and null for a session that never planned.
     *
     * ⚠️ **A second column rather than clearing {@link planMode}, because they are two facts and a
     * resume needs both.** Clearing the flag would make a session that planned and was released
     * indistinguishable from one that never planned — and on Codex those two must send different
     * things on every turn: the released one keeps asserting `{mode:'default'}`, because the
     * thread's mode is sticky server-side, while the one that never planned must send no mode at
     * all, since sending one replaces the developer instructions a workspace hint put there.
     *
     * A timestamp rather than a boolean for the reason {@link adoptedAt} is one: "when" costs the
     * same and answers questions "whether" cannot.
     */
    planEndedAt: integer('plan_ended_at'),
    /**
     * 🔴 **When a PERSON last changed this conversation's model or its effort — epoch ms, or NULL:
     * nobody has** (682, PM ruling `R31c`: *"a person's live act on a conversation outranks"* what
     * an agent would set on it).
     *
     * ⚑ **Why the row needed it**: {@link model} and {@link reasoningEffort} have several writers —
     * the launch, a person's change, a give that switches it (D-042 · R4) — and nothing else records
     * which one wrote last. ⛔ **Stamped by the person's change door and by nothing else**
     * (`RuntimeHost.setSessionSetting`, reached only from a person's window), and carried to the
     * conversation that replaces this one. ⚑ **D-042 · F1 — a give naming another pair keeps the
     * person's**, and its answer says what it runs instead.
     *
     * ⚠️ **One stamp for the PAIR, not one per half.** ⚠️ **Never cleared** — no gesture hands a
     * conversation back, so a person's act on it stands for its life.
     *
     * ⛔ **NO CHECK, by construction** — an INTEGER needs none.
     */
    modelOrEffortSetByAPersonAt: integer('model_or_effort_set_by_a_person_at'),
    /**
     * 🔴 **D-042 · R5 — the model the PROVIDER last reported running, or NULL — it has not said**
     * (Claude's per-turn `init`, Codex's handshake, `thread/settings/updated` and reroute). ⚑ Kept so
     * a stopped conversation can still show it beside {@link model} when the two differ — an alias's
     * target, a reroute. ⛔ **Written without touching `updated_at`**: a report is not activity, and
     * the lists order by it.
     */
    reportedModel: text('reported_model'),
    /**
     * ⚑ **The effort the provider last REPORTED**, or NULL — not reported. ⚠️ Claude reports one only
     * as a turn ends (F099), so a Claude conversation that has not ended a turn since reads NULL here
     * and its effort is said as *requested*.
     */
    reportedEffort: text('reported_effort'),
    /**
     * When this session was ADOPTED from a provider home (087) — a conversation that already
     * existed and that we recorded a pointer to, rather than one we ran. Null means we started
     * it. It matters to the UI: an adopted session's transcript and approval history are not
     * ours, so nothing may present them as if they were.
     */
    adoptedAt: integer('adopted_at'),
    /**
     * When this session was RESTORED FROM A BUNDLE (214 §1) — epoch ms; null for every other row.
     *
     * ⛔ **A column, because the alternative was a lie.** A restored bundle is adopted — the
     * conversation happened elsewhere and we hold a copy — so it already sets {@link adoptedAt}.
     * What no existing column could say is that **no provider home of ours contains its
     * transcript**, which is the fact `resumable()` needs. `foundInUserHome` encodes exactly that
     * for a swept `~/.claude` row, via `profile_id IS NULL`, and reusing it would have made the
     * refusal read *"one of your own Claude conversations, found in Claude's own folder"* about a
     * file that arrived in an email. `086` forbids saying something ELSE instead of the truth, and
     * `188` §1 already fought to keep a bundle's explicit-null profile meaning what it says.
     *
     * ⚠️ **`194` M2 is what makes it load-bearing rather than descriptive**: *"import persists a
     * provider ref without restoring the provider-side referent, then advertises Resume"*. Before
     * this column the Resume list offered a restored bundle, and the click asked the provider for a
     * conversation that was never put in the home it looks in. Now the row says why, in words, and
     * is not offered — see `whyNotResumable`.
     *
     * A timestamp rather than a boolean, for the reason {@link adoptedAt} is one: "when" costs the
     * same and answers questions "whether" cannot.
     */
    restoredAt: integer('restored_at'),
    /**
     * That this conversation is another one's **child**, as the provider recorded the descent
     * (111) — parent id, depth, nickname, role, agent path, as a JSON object.
     *
     * ⛔ **Persisted rather than re-derived, and that is the whole point of the column.** `109`
     * measured the damage: *"because child identity is discarded from `LibraryEntry` and adopted
     * rows, an archived child remains indistinguishable after its provider file disappears."*
     * Discovery can only answer this while the provider still holds the thread; the moment the
     * rollout file goes — which is precisely what the sweep exists to survive — the only copy left
     * is the one we wrote down. 806 rows are already in that state.
     *
     * ⚠️ **One JSON column rather than five.** Every field in it is optional *on the wire* (three
     * real rows know they are children and cannot name a parent), so five nullable columns would
     * encode the same optionality with five times the migration surface and no query we actually
     * run. Nothing joins on parent id today; the library groups in memory over a page it has
     * already loaded. If that changes, the column splits then, against a real query.
     *
     * Null means **not a child, or recorded before this column existed** — deliberately the same
     * value, because neither is a claim of descent and inventing a difference between them would
     * be the fabrication `086`/`104` rule out.
     */
    childDescent: text('child_descent'),
    /**
     * 🔴 **The global identity this conversation is a life of** (369) — {@link agentIdentity}.
     *
     * ⛔ **D-016 · a conversation is found by its agent**, and this is the column that finds it:
     * every PLACED read keys on it (`IS NOT NULL`) — the forest, the digest and their counts — and
     * so does give's lookup, beside {@link parentSessionId}.
     *
     * ⚠️ **Null exactly for a conversation swept out of the user's OWN `~/.claude` / `~/.codex`**
     * (or imported from one): it has no identity of ours, and giving it one would claim we hold bytes
     * we never owned.
     */
    agentIdentityId: text('agent_identity_id').references(() => agentIdentity.id),
    /**
     * 🔴 **The conversation that started this one — or null, which means a person did** (204, 341).
     *
     * ⚑ **Written in the transaction that writes the row** (`SessionStore.create`), and read in both
     * directions: upwards by {@link SessionStore.parentOf} and {@link SessionStore.ancestorsOf},
     * downwards by `SessionStore.spawnedBy` and give's lookup (`provider_session_parent_identity_idx`).
     * ⛔ **D-016 · the parent alone**: why it was started is the brief of the piece it was given, on
     * the `work` row, and a conversation with no parent owns a root.
     *
     * ⚠️ **It is NOT {@link childDescent}, and the two must not be confused.** That column is what the
     * PROVIDER said about a descent it made inside its own home, recorded verbatim as JSON because
     * nothing joins on it. This one is a conversation this app started for another — a row in this
     * table, with its own identity, its own ledger and its own place in the rail — which is why it is
     * a real self-FK and not a field in a blob.
     */
    parentSessionId: text('parent_session_id').references(
      (): AnySQLiteColumn => providerSession.id,
    ),
    /**
     * 🔴 **692 · the QUIT closed this conversation, and nothing has closed or reopened it since**
     * (PM ruling R34) — when that quit recorded it, or null. ⚠️ **735 · or a reopen did, for a first
     * message that did not go, and was undone** — see the fourth writer below.
     *
     * Conversations closed solely by a graceful quit reopen at the next launch. Record that cause explicitly so an update restart does not leave them in Closed conversations.
     *
     * ⚠️ **Why a column and not a derivation.** `status` says `ended` for every ending, and the
     * ledger's terminal rows are the same bytes whoever caused them — a person's Close, a provider
     * that died, a parent's `end_agent` (until D-017) and the quit all finalize through one path. ⛔ **R34a: *"Record
     * at quit which conversations the quit closed, and read only that at launch."*** So the quit
     * WRITES the fact, and nothing reconstructs it.
     *
     * **Its writers, all four:**
     *  - ⚑ **the quit** (`RuntimeHost.closeAll`) stamps the conversations it closed — the set taken
     *    before its first `await`, written once the teardown has finished — never one already on its
     *    way out, ended or failed, and never one its parent ended while the quit ran;
     *  - ⚑ **every reopen** (`SessionStore.reopened`) clears it — a person's Reopen, or any message
     *    that starts it (D-017) — so a conversation that was started again and then CRASHED falls
     *    back to closed, which is R34c;
     *  - ⚑ **an ending of one that was never started again** (`SessionStore.forgetTheQuit`) clears it
     *    — a person's Close, or a start the provider can never serve
     *    (a `ResumeError` its adapter marked `noSuchSession`, since `706`) — each closing it without
     *    starting a provider to do so.
     *  - 🔴 **735 · a first message refused after the start it caused** (`SessionStore.theQuitsStampPutBack`)
     *    writes it BACK, at the quit's own moment, just before the host stops what it started — so it
     *    is where the send found it (`701` F-8). ⚠️ So a stamped row may have a `reopened` and an
     *    ending after the quit's: a life that took no message and was undone.
     *
     * ⛔ **A crash writes nothing, by construction**: a crash before the quit, or during it, lands
     * before the one write, which comes after the teardown. ⚠️ And a crash that lands while a
     * conversation is STILL waiting leaves its stamp alone — nothing happened to it that the stamp
     * does not already say — so it comes back open again, exactly as the last quit left it.
     *
     * ⚠️ **Nullable, no DEFAULT and no CHECK** — null is *the quit did not close it*.
     */
    closedByTheQuitAt: integer('closed_by_the_quit_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    check('provider_session_provider_ck', sql`${t.provider} in ('claude', 'codex')`),
    check(
      'provider_session_status_ck',
      sql`${t.status} in ('idle', 'working', 'waiting_permission', 'ended', 'errored')`,
    ),
    check(
      'provider_session_approval_mode_ck',
      sql`${t.approvalMode} is null or ${t.approvalMode} in ('ask', 'auto')`,
    ),
    index('provider_session_status_idx').on(t.status),
    index('provider_session_identity_idx').on(t.agentIdentityId),
    index('provider_session_parent_idx').on(t.parentSessionId),
    /**
     * ⚑ **D-016 · give's lookup** — the newest conversation a giver started as one identity
     * (`SessionStore.newestChildAs`), which is how give finds the one conversation it has with an
     * agent.
     *
     * ⛔ **NOT unique**: a D-017 replacement leaves two rows for one pair — the conversation that can
     * never be reopened and the one that took its place — and the lookup takes the newest, then
     * follows it to the one in its place.
     */
    index('provider_session_parent_identity_idx').on(t.parentSessionId, t.agentIdentityId),
    // ⚑ 727 · every adoption scan asks it once per transcript it finds.
    index('provider_session_launched_as_idx').on(t.launchedAs),
  ],
)

/**
 * One user turn — opened when the user sends, closed when the turn actually ends (045).
 *
 * Until now a turn was not a thing that existed: it was implied by `turn` events inside the ledger,
 * and the session's status was whatever `status` event landed last. So "is this session busy?" was a
 * derived guess with nothing to reconcile against, and when the guess was wrong nothing disagreed
 * with it. 042 measured that: an interrupted turn emits `idle` and the message already in flight
 * arrives after it — 1 of 6 interrupts, 0 of 47 completions.
 *
 * This table is an INDEX OVER the ledger, never a replacement for it. `events` stays the record; a
 * turn row is the bracket around a span of it.
 */
export const turn = sqliteTable(
  'turn',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => providerSession.id, { onDelete: 'cascade' }),
    /** Nth turn in this session, from 0 — the same counting the ledger's ordinals use. */
    ordinal: integer('ordinal').notNull(),
    /**
     * What the person sent to open this turn; the row starts with the prompt.
     */
    prompt: text('prompt').notNull(),
    openedAt: integer('opened_at').notNull(),
    /** Null while the turn is open. Moves together with {@link endReason}, by CHECK. */
    closedAt: integer('closed_at'),
    /**
     * HOW it ended, and never null once it has.
     *
     *  - `completed` / `failed` / `interrupted` — the `turn` event's own states.
     *  - `ended` — the session ended while this turn was still open.
     *  - `unknown` — **required, and the point of the enum**: a turn whose ending we never observed
     *    (the app was quit mid-turn) must be recorded as such. Back-filling it as `completed` would
     *    be the app inventing an outcome, which is the one thing this table exists to stop.
     */
    endReason: text('end_reason'),
    /**
     * Since when this turn has been waiting on US — a permission card or a question (076).
     *
     * It lives here because it is a property of the open turn, not a fourth opinion about the
     * session. 042 found THREE independent status writers; this is how the adapters' own
     * `waiting_permission` is absorbed without being deleted: it is the only signal for the
     * "blocked on us" silence, and losing it would collapse three distinguishable silences into two.
     */
    blockedAt: integer('blocked_at'),
    /**
     * Which projection of this session's archive these turns belong to (065). See
     * {@link events.generation}: turns are an INDEX OVER the ledger, so they are scoped by exactly
     * the same number and are rebuilt with it. A turn row from a superseded generation is garbage,
     * not history.
     */
    generation: integer('generation').notNull().default(0),
  },
  (t) => [
    uniqueIndex('turn_session_ordinal_uq').on(t.sessionId, t.generation, t.ordinal),
    index('turn_session_idx').on(t.sessionId),
    check(
      'turn_end_reason_ck',
      sql`${t.endReason} is null or ${t.endReason} in ('completed', 'failed', 'interrupted', 'ended', 'unknown')`,
    ),
    // A turn cannot close without saying how, and cannot say how without closing. The two facts are
    // one fact, so the database holds them together rather than trusting every writer to.
    check('turn_closed_with_reason_ck', sql`(${t.closedAt} is null) = (${t.endReason} is null)`),
  ],
)

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => providerSession.id, { onDelete: 'cascade' }),
    // Per-session monotonic ordinal — preserves order for persist-before-publish.
    ordinal: integer('ordinal').notNull(),
    type: text('type').notNull(),
    // Normalized-event payload as JSON text; validated by zod in the runtime layer.
    payload: text('payload', { mode: 'json' })
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at').notNull(),
    /**
     * The turn this event belongs to (045), or null when it genuinely belongs to none.
     *
     * NULLABLE is load-bearing. Session lifecycle events, late usage reports and anything arriving
     * outside a turn are real; forcing them into an invented turn is the fabrication pattern 035
     * already cost us once.
     *
     * A CONTENT event arriving when no turn is open is stamped with the most recently CLOSED turn —
     * which is not silent re-parenting, because `turn.closed_at` makes the relationship explicitly
     * "after it ended". That is what turns 042's invisible anomaly into a join:
     *
     * ```sql
     * SELECT e.* FROM events e JOIN turn t ON e.turn_id = t.id
     *  WHERE t.closed_at IS NOT NULL AND e.created_at > t.closed_at
     * ```
     */
    turnId: text('turn_id').references(() => turn.id, { onDelete: 'set null' }),
    /**
     * Which PROJECTION of this session's provider file this row belongs to (065, from 061 finding 6).
     *
     * The provider's file is the record and `events` is the product projection of it — but until
     * then the projection had no way to say *"an older normalizer built me"*, and no way to be read
     * again without replacing the one on screen.
     *
     * A generation is that answer's mechanism. A rebuild writes generation N+1 **beside** the live
     * N in bounded transactions, and the flip is one row in {@link derivedGeneration} — so a failure
     * part-way through leaves the previous projection active and intact, and the promotion cannot be
     * half-done. Reads are scoped to the active generation; anything else is collectable garbage.
     *
     * `0` is the default and means "the only projection there has ever been" — every live session,
     * and every ledger written before this column existed.
     */
    generation: integer('generation').notNull().default(0),
  },
  (t) => [
    uniqueIndex('events_session_ordinal_uq').on(t.sessionId, t.generation, t.ordinal),
    index('events_session_idx').on(t.sessionId),
    index('events_turn_idx').on(t.turnId),
    /**
     * 🔴 **D-016 · where the pieces of work are — a PARTIAL index over the seven piece types.**
     *
     * ⛔ **A `work` row says what a piece IS; what happens to it is in its owner's ledger**, and the
     * fold that derives its state (`derivePieces`) reads a ledger from its first piece row on — the
     * `ordinal >= (SELECT min(ordinal) …)` floor every piece read takes. ⚑ This index answers that
     * floor without walking a ledger that may hold 181,791 events, and finds a root's newest title
     * and status line (`SessionStore.rootLines`).
     *
     * ⚠️ **All seven types** (D-016 · R5): a partial index's predicate is part of its definition,
     * so a type added later would be a DROP and a CREATE — a second migration. ⛔ The list is a
     * literal because a predicate must be a constant; `PIECE_EVENT_TYPES` in `shared/tasks.ts` is
     * the same seven words in the same order.
     *
     * 🔴 **Two things a reader owes it, or SQLite walks the ledger instead.** SQLite uses a partial
     * index only for a query whose WHERE implies this one, so every reader repeats the list exactly;
     * and it prefers `events_session_ordinal_uq`'s two equality columns, so every reader writes
     * `+generation` to keep that term out of index selection (measured: 9.6 ms a read on a
     * 90,000-row ledger without it, 0.005 ms with it).
     *
     * ⚠️ **NOT scoped by generation**, for its neighbours' reason: the reader passes the active one.
     */
    index('events_work_idx')
      .on(t.sessionId, t.ordinal)
      .where(
        sql`${t.type} IN ('work_given', 'work_replied', 'work_taken_back', 'work_retitled', 'work_status_set', 'work_rebriefed', 'work_closed')`,
      ),
    /**
     * 🔴 **Where the routed requests are — a partial index, and `394`'s whole schema change** (394,
     * HO-007 S4).
     *
     * ⛔ **S4 adds no table and no column.** A routed request is derived
     * (`shared/questions.ts`, which imports two types and can reach nothing else), so there is
     * nothing for a row to be. This index exists for the two questions the answer door asks of a
     * database that may hold a 181,791-event conversation: *which conversations have routed anything
     * to this parent*, and *from which ordinal does one conversation's ledger start mattering*.
     *
     * ⚑ **`events_work_idx`'s shape, for the same reason.** `questionsRoutedTo` scans
     * `type = 'request_routed'` and without this would walk every event of every session to answer a
     * question about a handful of them.
     *
     * ⚠️ **Partial, so it costs what routed requests cost rather than what events cost**, and NOT
     * scoped by generation — `deriveRoutedRequests`' reader passes the active one, exactly as the
     * piece fold's does.
     */
    index('events_request_routed_idx')
      .on(t.sessionId, t.ordinal)
      .where(sql`${t.type} = 'request_routed'`),
    /**
     * 🔴 **Where the provider walls are — a partial index** (533, HO-052 §4).
     *
     * ⛔ **533 adds no table and no column either.** A wall is derived
     * (`shared/provider-limit.ts`, which reads the line an adapter already wrote), so there is
     * nothing for a row to be. This index exists for the ONE question a person's queue asks every
     * five seconds: *has any provider reported a limit lately* — and without it that is a scan of
     * every event of every conversation, twelve times a minute, on the main process.
     *
     * ⚑ **The same shape as its neighbours and for their reason**: partial on the type, so it costs
     * what errors cost rather than what events cost.
     *
     * ⚠️ **Keyed on `created_at` and NOT on `(session_id, ordinal)`, which is where it differs from
     * the two above it.** Those serve *one conversation's rows, from an ordinal onward*;
     * `providerLimitsSeen` asks the opposite question — *the newest rows across every conversation
     * at once* — and a key beginning with `session_id` cannot serve an ordering by time.
     *
     * ⛔ **NOT scoped by generation, for its neighbours' reason and one of its own.** A wall is a
     * fact about the provider's account rather than about a conversation, so a rebuilt projection
     * does not un-say it and the reader deliberately does not narrow to the live one.
     */
    index('events_error_idx')
      .on(t.createdAt)
      .where(sql`${t.type} = 'error'`),
    /**
     * 🔴 **Where the instruction asks are — a partial index** (582, `HO-063` gap 4).
     *
     * ⛔ **582 adds no table and no column here either.** An ask is derived
     * (`shared/own-instructions.ts`'s `waitingOnAPerson`, a pure fold), so there is nothing for a
     * row to be — the durable thing an approval produces is a `identity_instruction` row, and that
     * is a different question with a different lifetime.
     *
     * ⚠️ **Keyed on `created_at` and covering BOTH types, which is where it differs from its
     * neighbours.** The two `(session_id, ordinal)` indexes serve *one conversation's rows*;
     * this serves the opposite question — *every ask anybody has made, across every conversation* —
     * because the surface that draws them is an IDENTITY's sheet and an identity is not a
     * conversation. ⛔ A key beginning with `session_id` cannot serve that at all.
     *
     * ⚑ **Both types in one index rather than two**, because the fold needs the ask and its ending
     * together: an index on the proposal alone would find the candidates and then need a second
     * lookup per candidate to learn whether anybody answered — a shape only a read scoped to one
     * session's ordinal range can afford.
     *
     * ⛔ **NOT scoped by generation**, for its neighbours' reason: a rebuild replays the ask verbatim
     * into a new generation and the reader scopes itself.
     */
    index('events_instruction_ask_idx')
      .on(t.createdAt)
      .where(sql`${t.type} in ('instruction_proposed', 'instruction_settled')`),
    /**
     * Where the MCP server requests are, across every conversation: the Waiting on you queue reads
     * every open request on each look, so without this it would scan every event. Both types share
     * the index, because the fold needs each request beside its ending. Keyed on `created_at` for
     * `events_instruction_ask_idx`'s reason: the question spans conversations.
     */
    index('events_mcp_request_idx')
      .on(t.createdAt)
      .where(sql`${t.type} in ('mcp_server_requested', 'mcp_server_request_settled')`),
    /**
     * 🔴 **Where the provider's own all-clears are — a partial index** (586, `HO-080` §1.3).
     *
     * ⛔ **586 adds no table and no column.** A retraction is derived (`foldProviderLimits`, a pure
     * fold), so there is nothing for a row to be — what is durable is the `provider_limit_clear`
     * event the adapter already writes, and this is only how it is found.
     *
     * ⚠️ **Keyed on `created_at`, which is `events_error_idx`'s shape and for its reason.** A wall
     * is a fact about the provider's ACCOUNT rather than about a conversation, and so is the record
     * that ends one: the question is *was this provider answering anywhere since that wall*, which
     * no `(session_id, ordinal)` index can serve.
     *
     * ⛔ **It is needed because the frame is ROUTINE.** `rate_limit_event` fires once or twice per
     * turn, so this type is one of the densest in the table — and the read behind it runs on the
     * five-second person's-queue poll. ⚑ Without it the reader is a scan of every event ever
     * recorded, which is the cost `events_error_idx` and its neighbours exist to refuse.
     *
     * ⛔ **NOT scoped by generation**, for its neighbours' reason: a rebuild replays the record
     * verbatim into a new generation, and a projection this app replaced has not un-answered a turn.
     */
    index('events_provider_clear_idx')
      .on(t.createdAt)
      .where(sql`${t.type} = 'provider_limit_clear'`),
    /**
     * 🔴 **Where the rows the ledger folds read are — a partial index** (F071).
     *
     * ⛔ **The person's look reads four folds every five seconds**: the routed requests, the pieces,
     * the questions raised and the stall receipts, of every conversation that routed, holds or gave
     * work. Each filtered `type` over `events_session_ordinal_uq`, so SQLite read every row of a
     * ledger to test its type: a 64,000-event ledger about ten times a look, and the main process
     * burst every five seconds by what the database held — 244 ms a look on a database of 174,000
     * events, 526 ms at twice that.
     *
     * ⚑ **`events_work_idx`'s shape, and scoped by generation**: the folds read one conversation's
     * active projection in ordinal order, so the key is the unique index's own and the rows come
     * back in the order they did. ⚠️ Partial, so it costs what these rows cost — about one event in
     * thirty — rather than what events cost.
     *
     * 🔴 **The list is `FOLD_EVENT_TYPES` (`fold-index.ts`)**, which every reader repeats so its
     * WHERE implies this one, and names this index, because SQLite otherwise prefers the unique
     * index for its `ORDER BY`. ⛔ A list the migration did not create stops the store from
     * starting. ⚠️ So the list changes only by a migration that drops and creates this index in the
     * commit that changes the list — and a build from before it cannot open a database it migrated.
     */
    index('events_fold_idx')
      .on(t.sessionId, t.generation, t.ordinal)
      .where(sql`${t.type} IN (${sql.raw(FOLD_TYPE_LIST)})`),
    /**
     * 🔴 **Where a conversation's tool inventories are — a partial index** (D-035).
     *
     * ⛔ **Every page of history carries the inventory in force at its first row**
     * (`LedgerWindow.toolsInForce`), because the window recognises a give, a reply, a question or a
     * request taken on by the tool names the conversation was handed — and a provider states them
     * once per start, so the row is usually far behind the page. Without this the read walked back
     * row by row from the page: 57 ms on a 180,000-event life, and to the very start for a
     * conversation that has none, on every page opened or scrolled back to.
     *
     * ⚑ **`events_fold_idx`'s key, and an index of its own rather than one more type in that list.**
     * The fold list is the folds' predicate, and every statement read through it repeats it word for
     * word; changing it is a migration that drops and rebuilds that index and moves the check that
     * keeps the two in step. This is one type and one reader, so its term is one equality.
     */
    index('events_inventory_idx')
      .on(t.sessionId, t.generation, t.ordinal)
      .where(sql`${t.type} = 'tool_inventory'`),
  ],
)

/**
 * **What the derived ledger claims about itself** (065, from 061 finding 6).
 *
 * One row per session whose conversation was DERIVED from its provider's file — imported from a
 * provider home, or taken in as a bundle. A session this app RAN has no row here and never gets one:
 * its ledger is the recording, not a projection of anything.
 *
 * ⚠️ **Staleness is derived on read, never stored.** `normalizer_version < NORMALIZER_VERSION` is
 * what makes a projection stale, and both operands are facts already on disk. A stored `is_stale`
 * flag would be a second opinion about them.
 */
export const derivedGeneration = sqliteTable('derived_generation', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => providerSession.id, { onDelete: 'cascade' }),
  /** The generation every read of this session's ledger and turns is scoped to. */
  active: integer('active').notNull(),
  /**
   * Which importer built the active generation — {@link NORMALIZER_VERSION} at the time it ran.
   *
   * `0` means "before this contract existed" (`PRE_CONTRACT_NORMALIZER_VERSION`). That is not a
   * guess dressed as a number: such a ledger genuinely predates the version, and reading it as stale
   * is the truthful answer rather than the convenient one.
   */
  normalizerVersion: integer('normalizer_version').notNull(),
  /** How many of the provider's lines the active generation was read from. */
  derivedThrough: integer('derived_through').notNull(),
  /** The generation currently being built beside the active one, or null when none is. */
  building: integer('building'),
  /**
   * The highest generation number ever handed out for this session — so one is **never reused**.
   *
   * ⚠️ Without it, a build that failed or was cancelled leaves rows at `active + 1`, and the next
   * attempt would take that same number and have to DELETE them first. On the measured corpus that
   * delete is millions of rows in one synchronous transaction — the unbounded step this whole task
   * exists to retire, reappearing in the one place nobody looks. Monotonic numbers make the leftovers
   * harmless: they are collected in bounded batches whenever there is a moment, and nothing ever
   * waits on that having happened.
   */
  highest: integer('highest').notNull(),
  /**
   * Why the last rebuild did not land, or null. Set only by a rebuild that FAILED — a cancelled one
   * clears it, because being asked to stop is not a fault and must not be reported as one.
   */
  failure: text('failure'),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * 🔴 **D-016 · a piece of work — what it IS, written once** (the tree).
 *
 * ⛔ **What a piece IS goes in this row; what HAPPENS to it goes in its owner's ledger**, and its
 * state is never stored: it is folded from those rows (`derivePieces`). ⚑ A given piece's row is
 * written in the transaction that appends its opening `work_given` row (`SessionStore.recordGive`),
 * so a crash cannot leave one without the other; a root's is written in the transaction that writes
 * its conversation's row, and a root has no event. ⚠️ **Never updated**: a later title or status is
 * a ledger row (`work_retitled`, `work_status_set`), and the newest one stands.
 *
 * ## ⚑ A root, and every other piece
 *
 *  - **A root** (`parent_id` NULL) is the work a person gave a conversation they started: every
 *    conversation with no parent gets one when its row is written, numbered app-wide — `W1`, `W2`, …
 *    Its giver is a person, so `given_by_session_id` is NULL, and its title arrives later, as a
 *    `work_retitled` row.
 *  - **A piece** is given by one conversation to a conversation it started (`give_work`), numbered
 *    under its parent — `W1.2` is the second piece given under `W1` — with the title and brief it was
 *    given with.
 *  - **A piece its root's owner takes on for the person** (`take_on_work`, D-016 · commit 6) is
 *    numbered under that root from the same counter, given by the person — `given_by_session_id`
 *    NULL — with its title and brief.
 *
 * ⛔ **The owner never changes**: a piece lives its whole life in one ledger. ⚑ Plain foreign keys
 * with no `ON DELETE`, because nothing deletes a conversation or a piece.
 */
export const work = sqliteTable(
  'work',
  {
    /** `work_<uuid>` — `newWorkId`. */
    id: text('id').primaryKey(),
    /** The piece this one was given under, or NULL: a root. */
    parentId: text('parent_id').references((): AnySQLiteColumn => work.id),
    /** Its number under its parent, or among the roots — from {@link workSequence}, never reused. */
    number: integer('number').notNull(),
    /** The conversation whose ledger holds this piece's life — fixed for good. */
    ownerSessionId: text('owner_session_id')
      .notNull()
      .references(() => providerSession.id),
    /**
     * The conversation that gave it, or NULL: a person — every root, and every piece taken on for
     * one.
     */
    givenBySessionId: text('given_by_session_id').references(() => providerSession.id),
    /** As given. NULL only on a root, whose title lives in its `work_retitled` rows. */
    title: text('title'),
    /** As given. NULL only on a root. */
    brief: text('brief'),
    /** The folder the give asked for, as asked, or NULL when it named none. */
    folder: text('folder'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    check('work_number_ck', sql`${t.number} >= 1`),
    // ⛔ A root is a person's: no conversation gives one. ⚑ A piece may be a person's too.
    check(
      'work_a_root_is_given_by_a_person_ck',
      sql`${t.parentId} IS NOT NULL OR ${t.givenBySessionId} IS NULL`,
    ),
    // ⛔ A given piece arrives with what it is: a title and a brief.
    check(
      'work_a_piece_has_a_title_and_a_brief_ck',
      sql`${t.parentId} IS NULL OR (${t.title} IS NOT NULL AND ${t.brief} IS NOT NULL)`,
    ),
    /**
     * ⚑ **One piece per number under a parent** — and the index `parent_id = ?` reads through:
     * SQLite takes an equality on a column as implying `IS NOT NULL`, so a separate parent index
     * would be a second copy of this one.
     */
    uniqueIndex('work_parent_number_uq')
      .on(t.parentId, t.number)
      .where(sql`${t.parentId} IS NOT NULL`),
    /** ⚑ One root per number, app-wide — NULL parents are distinct in the index above. */
    uniqueIndex('work_root_number_uq')
      .on(t.number)
      .where(sql`${t.parentId} IS NULL`),
    /** ⛔ **One root per conversation**, as a database fact. */
    uniqueIndex('work_one_root_per_conversation_uq')
      .on(t.ownerSessionId)
      .where(sql`${t.parentId} IS NULL`),
    index('work_owner_idx').on(t.ownerSessionId),
    index('work_given_by_idx').on(t.givenBySessionId),
  ],
)

/**
 * 🔴 **D-016 · the last number handed out under each parent, and among the roots** — so no number
 * is ever handed out twice.
 *
 * ⛔ **A counter, and never `max(number) + 1` over the rows.** A give whose brief could not be sent
 * burns the number it took (D-016 · R4: the owner is told its label before the brief goes), and a
 * maximum over the survivors would hand it out again — to different work, under a label a
 * transcript already quotes. ⚑ So there is no link to {@link work}, and nothing deletes a row here.
 *
 * ⚠️ **`scope` is a parent's `work.id`, or `ROOTS_SCOPE` (`'roots'`, `db/identity.ts`) for the
 * roots**, because SQLite cannot key on NULL as one value: two NULL keys are two rows.
 */
export const workSequence = sqliteTable(
  'work_sequence',
  {
    /** A parent's `work.id`, or `ROOTS_SCOPE`. */
    scope: text('scope').primaryKey(),
    /** The last number handed out in this scope. Starts at 1; only ever goes up. */
    last: integer('last').notNull(),
  },
  (t) => [check('work_sequence_last_ck', sql`${t.last} >= 1`)],
)

/**
 * 🔴 **D-016 · a file kept for a piece of work** — at `<userData>/resources/<sha256>/<name>`,
 * copied byte for byte when it was handed in and never changed after.
 *
 * ⚑ **Several per piece**, each an INPUT its giver handed over or something its owner MADE
 * ({@link RESOURCE_ROLES}): `give_work`'s inputs and a giver's `update_work` write `input`;
 * `reply_to_parent` and an owner's `update_work` write `made`. ⛔ **The bytes are checked against
 * `sha256` whenever they are read**, so a file changed on disk is refused rather than served.
 */
export const workResource = sqliteTable(
  'work_resource',
  {
    /** `res_<32 hex>` — `newResourceId`. */
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => work.id),
    /** One of {@link RESOURCE_ROLES}, and the CHECK below is what closes it. */
    role: text('role').notNull(),
    /**
     * 🔴 **D-026 · the file's title, taken from its bytes when it was kept** — a Markdown file's
     * first `# ` heading, a page's `<title>`, else its name (`resourceTitle`). ⚠️ NULL on a row kept
     * before titles were taken, which the window reads as its name.
     */
    title: text('title'),
    /** What the one who added it said it holds, or NULL when nothing was said. */
    summary: text('summary'),
    /** The file's own name as it was handed in — the last segment of its path here. */
    name: text('name').notNull(),
    /** Lower-case hex of the bytes as they were kept. */
    sha256: text('sha256').notNull(),
    bytes: integer('bytes').notNull(),
    /** The conversation that added it, or NULL: a person. */
    addedBySessionId: text('added_by_session_id').references(() => providerSession.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    check('work_resource_role_ck', sql`${t.role} IN (${oneOf(RESOURCE_ROLES)})`),
    check(
      'work_resource_sha256_ck',
      sql`length(${t.sha256}) = 64 AND ${t.sha256} NOT GLOB '*[^0-9a-f]*'`,
    ),
    // ⛔ An empty file is not kept: there is nothing in it to hand anybody.
    check('work_resource_bytes_ck', sql`${t.bytes} >= 1`),
    index('work_resource_work_idx').on(t.workId),
  ],
)

/**
 * 🔴 **Every version of every identity's own instructions — the `configured` layer, at last with a
 * writer** (582, `HO-009` §2, `HO-063` gap 4).
 *
 * ## ⛔ Why a table, when questions and a piece's state are derived from the ledger
 *
 * ⚠️ **Most of what this app derives is a fold over `events`, and this cannot be**, for two reasons
 * that are both about the ledger rather than about this layer:
 *
 *  1. ⛔ **`events.session_id` is `NOT NULL` and cascades.** A person editing an identity's rules
 *     from a sheet is not in a conversation at all, so there is no session for the row to belong
 *     to — and a conversation that IS deleted would take a person's standing rules with it.
 *  2. ⚑ **`HO-009` §1.2 makes *what the rule used to be* the safety property of the whole layer.**
 *     A store whose rows can go with a conversation cannot carry it.
 *
 * ⛔ **The ASK an agent makes is still a ledger row** — `instruction_proposed` / `instruction_settled`,
 * folded by `shared/own-instructions.ts` — because an ask genuinely belongs to the conversation that
 * made it and dies with it. ⚑ **A version is durable; a request to write one is a conversational
 * act**, and this table is the durable half.
 *
 * ## ⚑ Append-only, and the PRIMARY KEY is what enforces it
 *
 * ⛔ **`ins:<folded slug>:<version>` is DERIVED**, exactly as `aid:` is, so two writers
 * computing the same version collide on the key rather than producing two rows for one number.
 * ⚠️ **Nothing in this app deletes a row here.** The only removal is the cascade when the identity
 * itself is removed — at which point there is nothing the history could be the history OF.
 *
 * ## 🔴 Both of its vocabularies are CHECKs
 *
 * ⛔ **`wrote_it` and the version's range are database facts** — `version >= 1`, because a zeroth
 * version is not a thing this layer has.
 */
export const identityInstruction = sqliteTable(
  'identity_instruction',
  {
    /** `ins:<folded slug>:<version>` — derived. See the table comment. */
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    /**
     * ⚑ **1-based, monotone per identity, never reissued** — see
     * `OwnInstructionsVersion.version`. The derived `id` is what makes that unforgeable.
     */
    version: integer('version').notNull(),
    /**
     * ⛔ **The rules, verbatim, and `''` is a real value** meaning *a person took them away*. ⚠️ NOT
     * nullable: *nobody ever wrote any* is the absence of a ROW, and a nullable column here would
     * be a second spelling of it that every reader would have to learn.
     */
    text: text('text').notNull(),
    /**
     * 🔴 **One of `WHO_WROTE_IT`, and the CHECK below is what closes it** — `HO-009` §2.2's three
     * authorities, and `HO-078` §4's fourth.
     *
     * ⚠️ **`relayed-from-user` is a CLAIM this app did not check**, which is why it is its own word
     * rather than folded into `a-person`: the surface that draws the history says so.
     *
     * ⛔ **618 · this said *"with no fourth"*, and `HO-078` §4 is the fourth** — a creator writing
     * the first version of an identity it is bringing into existence. ⚑ The three that existed are
     * each FALSE of a creator, and `own-instructions.ts`' {@link WHO_WROTE_IT} asks them one at a
     * time.
     */
    wroteIt: text('wrote_it').notNull(),
    author: text('author', { mode: 'json' }),
    /**
     * ⚑ **`ActedBy`, stored as JSON** — who this app believes performed the act, the same value
     * every other settled act records. ⛔ Not derivable from `wrote_it` (`477`'s finding): a person
     * approving an agent's proposal is a different actor from the agent that proposed it.
     */
    by: text('by', { mode: 'json' }).notNull(),
    /**
     * The conversation that proposed or relayed this, or null when a person wrote it directly.
     *
     * ⛔ **`ON DELETE set null` and not cascade** — a version outlives the conversation that asked
     * for it, and losing the rule because the conversation was closed is the failure this whole
     * table exists to make impossible. ⚠️ The provenance narrows to *an agent asked, and this app
     * no longer holds which conversation*, which is honest and is not a deletion.
     */
    conversationId: text('conversation_id').references(() => providerSession.id, {
      onDelete: 'set null',
    }),
    /** What the agent said when it asked — a CLAIM, and null for a version a person wrote. */
    said: text('said'),
    /**
     * ⚑ **The version this one brought back, or null when it is new text** — a REVERT appends, so
     * the reverting is itself revertable.
     *
     * ⛔ **No foreign key, deliberately.** The target is `(identity_id, brought_back)`, a composite
     * this table has no unique index for — `id` is the key — and adding one to buy a constraint on
     * a column only this app's own door writes would cost an index on every row for a value present
     * on a handful. ⚠️ The CHECK below keeps it in range of a version that can exist.
     */
    broughtBack: integer('brought_back'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    /**
     * ⚑ **The read every LAUNCH makes** — *the newest version of this identity's rules* — and it is
     * on the path that composes a bundle before the first event is pumped. ⛔ Without it that is a
     * scan of every version of every identity on every launch.
     */
    index('identity_instruction_identity_idx').on(t.identityId, t.version),
    /**
     * ⛔ **The derived id already forbids two rows for one `(identity, version)`** — this is the
     * same fact said where a reader of the schema will look for it, and it is what a hand-written
     * `INSERT` that spelled its own id would hit.
     */
    uniqueIndex('identity_instruction_version_uq').on(t.identityId, t.version),
    check('identity_instruction_version_ck', sql`${t.version} >= 1`),
    check(
      'identity_instruction_wrote_it_ck',
      sql`${t.wroteIt} in ('a-person', 'an-agents-proposal', 'relayed-from-user', 'its-creator', 'an-agent-direct')`,
    ),
    /**
     * 🔴 **618 · *one write, at creation, and never again* as a DATABASE fact** (`HO-078` §4.1,
     * §1.1).
     *
     * ⛔ **`create_agent` must not be a back door into a layer a person owns**, and the rail that
     * makes it one is already there: a second call naming the same identity meets
     * `agent-name-taken` before anything is written. ⚠️ **That rail lives in one door.** This says
     * the same thing where no door can get past it — a version numbered 2 or higher can never
     * claim a creator wrote it, whatever code runs.
     */
    check(
      'identity_instruction_creator_is_first_ck',
      sql`${t.wroteIt} <> 'its-creator' or ${t.version} = 1`,
    ),
    /**
     * ⛔ **A version can only bring back one that came BEFORE it**, which is the whole of what
     * *revert* means. ⚠️ A row claiming to restore itself, or a version that does not exist yet,
     * would make the history unreadable in the one direction a person reads it.
     */
    check(
      'identity_instruction_brought_back_ck',
      sql`${t.broughtBack} is null or (${t.broughtBack} >= 1 and ${t.broughtBack} < ${t.version})`,
    ),
    /**
     * 🔴 **A person's own version was not asked for by anybody** — so the two provenance columns
     * cannot disagree about whether a conversation was involved.
     *
     * ⛔ **Two writers cannot be trusted to keep two columns agreeing about one thing.** ⚠️ It is
     * stated as
     * *a person's version says nothing* rather than *an agent's version names a conversation*,
     * because `conversation_id` is `set null` on a deleted conversation and must stay legal
     * afterwards.
     */
    check(
      'identity_instruction_person_said_nothing_ck',
      sql`${t.wroteIt} <> 'a-person' or (${t.conversationId} is null and ${t.said} is null)`,
    ),
  ],
)

/** The last rules change displayed to a person for this identity. */
export const identityInstructionSeen = sqliteTable(
  'identity_instruction_seen',
  {
    identityId: text('identity_id')
      .primaryKey()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    seenThrough: integer('seen_through').notNull().default(0),
  },
  (t) => [check('identity_instruction_seen_version_ck', sql`${t.seenThrough} >= 0`)],
)

/**
 * 🔴 **What a PERSON did to an agent's own memory** (625, `EXT-015` §3.3) — the record, and the
 * reason it is a table rather than a derivation.
 *
 * ## ⛔ It cannot be derived, and that is literal here
 *
 * ⚠️ **After a removal the file is gone.** *What it said* then exists nowhere in the world except
 * in this row — `a-derivation-cannot-answer-what-its-ledger-does-not-contain`, arriving on a store
 * this app does not own the contents of. ⛔ A record that carried only a path and a time could say
 * that something was taken out and never WHAT, which is the half a person needs when they realise
 * they removed the wrong one.
 *
 * ## ⚑ Why it is not the conversation ledger, which is where every other act in this app lands
 *
 * ⛔ **`EXT-015` §1 opens this door from the TEAM PAGE, where there is no conversation.** Every
 * `TranscriptEvent` is written against a `provider_session`; an amendment made with nothing open
 * has none to be written against, and inventing one would put a person's act inside a conversation
 * that never happened. ⚑ **It is a fact about an IDENTITY**, which is `369`'s ruling and
 * `identity_instruction`'s own — *"a grant is a fact about an identity and this row is only a
 * placement"* — so it hangs off `agent_identity` exactly as that table does.
 *
 * ## ⚠️ What it does NOT record
 *
 * ⛔ **There is no `wrote_it` column**, and the absence is the ruling. `identity_instruction` needs
 * one because FOUR authorities can write a version; exactly one can reach this door —
 * `requireAPerson` on the window wire, and no toolset — so a vocabulary here would have a single
 * member and could never disagree with the door. ⚑ `shared/agent-memory.ts`' `A_PERSON_DID_THIS` is
 * where that is stated and asserted; {@link identityMemoryAmendment.by} is what says WHICH caller,
 * which is the question `wrote_it` was never able to answer (`477`).
 *
 * ⛔ **And it records no TITLE and no summary of the entry.** `EXT-015` §5: *"Do not infer anything
 * from the text of a memory entry."* The path and the bytes are facts; anything else would be this
 * app reading meaning out of an agent's prose, which `D17` / `HO-088` §5.1 ruled against.
 */
export const identityMemoryAmendment = sqliteTable(
  'identity_memory_amendment',
  {
    /** `mem:<folded slug>:<seq>` — derived. See `memoryAmendmentRowId`. */
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    /**
     * ⚑ **1-based, monotone per identity, never reissued** — the derived `id` is what makes that
     * unforgeable, exactly as `identity_instruction.version` is.
     */
    seq: integer('seq').notNull(),
    /**
     * ⛔ **Which provider's store**, CHECKed to the two this app reads.
     *
     * ⚠️ **A store is per PROVIDER and an identity can have two**, because `setAgentProvider` has
     * been able to move one since `433` and the home it moved away from keeps what was written
     * there. A row without this column could not say which of two files named `MEMORY.md` a person
     * removed.
     */
    provider: text('provider').notNull(),
    /**
     * ⛔ **The absolute path this app derived for the entry** — never a path a caller sent.
     *
     * ⚠️ **It may name a file that no longer exists**, which is the point of the row rather than a
     * dangling reference. ⚑ No foreign key and nothing to join: the filesystem is not a table.
     */
    entry: text('entry').notNull(),
    /** One of `MEMORY_AMENDMENT`, and the CHECK below is what closes it. */
    act: text('act').notNull(),
    /**
     * ⚑ **`ActedBy`, stored as JSON** — who this app believes performed the act, the same value
     * every other settled act records.
     */
    by: text('by', { mode: 'json' }).notNull(),
    /**
     * ⛔ **What the entry said before, verbatim** — read inside the same guarded walk that decided
     * the path, so the row states what was really there at the moment of the act.
     *
     * ⚠️ **Bounded by the reader rather than here**: `INSTRUCTION_FILE_CAP` is enforced while the
     * bytes are read, and an entry this app could only read part of is refused outright rather
     * than amended — see `AMENDMENT_REFUSED`'s `unreadable`.
     */
    textBefore: text('text_before'),
    /** ⛔ **What it says now, or null for a removal.** The CHECK below is what keeps the pair honest. */
    textAfter: text('text_after'),
    createdAt: integer('created_at').notNull(),
    sourceId: text('source_id').references((): AnySQLiteColumn => identityMemoryAmendment.id),
    outcome: text('outcome').notNull().default('done'),
    actual: text('actual', { mode: 'json' }),
    settledBy: text('settled_by', { mode: 'json' }),
    settledAt: integer('settled_at'),
  },
  (t) => [
    /** ⚑ **The read the popup makes** — this identity's amendments, newest first. */
    index('identity_memory_amendment_identity_idx').on(t.identityId, t.seq),
    /**
     * ⛔ **The derived id already forbids two rows for one `(identity, seq)`** — this is the same
     * fact said where a reader of the schema will look for it.
     */
    uniqueIndex('identity_memory_amendment_seq_uq').on(t.identityId, t.seq),
    uniqueIndex('identity_memory_amendment_one_pending_uq')
      .on(t.identityId)
      .where(sql`${t.outcome} = 'pending'`),
    check('identity_memory_amendment_seq_ck', sql`${t.seq} >= 1`),
    check(
      'identity_memory_amendment_act_ck',
      sql`${t.act} in ('removed', 'corrected', 'restored')`,
    ),
    check('identity_memory_amendment_provider_ck', sql`${t.provider} in ('claude', 'codex')`),
    /**
     * 🔴 **A removal has no *after* and a correction has one** — the two columns cannot come apart
     * in a rule a writer has to keep.
     *
     * ⛔ **`identity_instruction_person_said_nothing_ck`'s own shape**, and for its reason: two
     * writers cannot be trusted to keep two columns agreeing about one thing. ⚠️ Stated in BOTH
     * directions here, unlike that one, because neither column is ever set null by a cascade —
     * there is nothing that would have to stay legal afterwards.
     */
    check(
      'identity_memory_amendment_after_matches_act_ck',
      sql`(${t.act} = 'removed' and ${t.textBefore} is not null and ${t.textAfter} is null) or (${t.act} = 'corrected' and ${t.textBefore} is not null and ${t.textAfter} is not null) or (${t.act} = 'restored' and ${t.textBefore} is null and ${t.textAfter} is not null and ${t.sourceId} is not null)`,
    ),
    check(
      'identity_memory_amendment_source_ck',
      sql`${t.sourceId} is null or (${t.sourceId} <> ${t.id} and (${t.act} in ('removed', 'restored') or (${t.act} = 'corrected' and (${t.outcome} = 'pending' or ${t.actual} is not null))))`,
    ),
    check(
      'identity_memory_amendment_source_person_ck',
      sql`${t.sourceId} is null or (case when json_valid(${t.by}) then json_extract(${t.by}, '$.who') is 'a-person' else 0 end)`,
    ),
    check(
      'identity_memory_amendment_outcome_ck',
      sql`${t.outcome} IN ('pending', 'done', 'partial', 'unchanged')`,
    ),
    check(
      'identity_memory_amendment_recovery_person_ck',
      sql`(${t.outcome} = 'done' AND ${t.actual} IS NULL AND ${t.settledBy} IS NULL AND ${t.settledAt} IS NULL) OR (CASE WHEN json_valid(${t.by}) THEN json_extract(${t.by}, '$.who') IS 'a-person' ELSE 0 END)`,
    ),
    check(
      'identity_memory_amendment_recovery_ck',
      sql`(
  ${t.outcome} IN ('pending', 'done') AND ${t.actual} IS NULL AND ${t.settledBy} IS NULL AND ${t.settledAt} IS NULL
) OR (
  ${t.outcome} IN ('done', 'partial', 'unchanged') AND ${t.actual} IS NOT NULL AND
  ${t.settledBy} IS NOT NULL AND ${t.settledAt} IS NOT NULL AND
  typeof(${t.settledAt}) = 'integer' AND ${t.settledAt} >= 0 AND ${t.settledAt} <= 9007199254740991 AND
  CASE WHEN json_valid(${t.actual}) THEN
    json_type(${t.actual}) IS 'object' AND
    CASE json_type(${t.actual}, '$.fingerprint')
      WHEN 'null' THEN 1
      WHEN 'text' THEN length(json_extract(${t.actual}, '$.fingerprint')) = 64 AND json_extract(${t.actual}, '$.fingerprint') NOT GLOB '*[^0-9a-f]*'
      ELSE 0
    END AND
    CASE WHEN json_type(${t.actual}, '$.unreadable') IS NULL THEN 1
      WHEN json_type(${t.actual}, '$.unreadable') IS 'true' THEN
        ${t.outcome} = 'partial' AND json_type(${t.actual}, '$.fingerprint') IS 'null'
      ELSE 0
    END
  ELSE 0 END AND
  CASE WHEN json_valid(${t.settledBy}) THEN
    json_type(${t.settledBy}) IS 'object' AND coalesce(json_extract(${t.settledBy}, '$.who'), '') IN ('a-person', 'the-app-itself')
  ELSE 0 END
)`,
    ),
  ],
)

/** The holder ledger boundary captured once when ordinary stalls adopt holder-first reminders. */
export const workLegacyStallCut = sqliteTable('work_legacy_stall_cut', {
  sessionId: text('session_id')
    .primaryKey()
    .notNull()
    .references(() => providerSession.id, { onDelete: 'cascade' }),
  generation: integer('generation').notNull(),
  throughOrdinal: integer('through_ordinal').notNull(),
})

/** Immutable source versions; provider-home views are derived from these bytes later. */
export const skillVersion = sqliteTable(
  'skill_version',
  {
    id: text('id').primaryKey(),
    skillId: text('skill_id').notNull(),
    versionKey: text('version_key').notNull(),
    metadata: text('metadata').notNull(),
    body: text('body').notNull(),
    sha256: text('sha256').notNull(),
    bytes: integer('bytes').notNull(),
    pluginId: text('plugin_id'),
    packageVersion: text('package_version'),
    packageSha256: text('package_sha256'),
    packageManifestSha256: text('package_manifest_sha256'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('skill_version_release_uq').on(t.skillId, t.versionKey),
    uniqueIndex('skill_version_owner_uq').on(t.skillId, t.id),
    index('skill_version_package_idx').on(t.pluginId, t.packageVersion),
    check(
      'skill_version_metadata_ck',
      sql`json_valid(${t.metadata}) AND length(CAST(${t.metadata} AS BLOB)) <= 8192`,
    ),
    check(
      'skill_version_bytes_ck',
      sql`typeof(${t.bytes}) = 'integer' AND ${t.bytes} BETWEEN 1 AND 65536 AND length(CAST(${t.body} AS BLOB)) = ${t.bytes}`,
    ),
    check(
      'skill_version_package_ck',
      sql`(${t.pluginId} IS NULL AND ${t.packageVersion} IS NULL AND ${t.packageSha256} IS NULL AND ${t.packageManifestSha256} IS NULL) OR (${t.pluginId} IS NOT NULL AND ${t.packageVersion} IS NOT NULL AND ${t.packageSha256} IS NOT NULL AND ${t.packageManifestSha256} IS NOT NULL)`,
    ),
  ],
)

/** One current version per source-qualified skill, without changing prior versions. */
export const skillCurrent = sqliteTable(
  'skill_current',
  {
    id: text('id').primaryKey(),
    alias: text('alias').notNull(),
    currentVersion: text('current_version').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull(),
  },
  (t) => [
    uniqueIndex('skill_current_alias_uq').on(t.alias),
    foreignKey({
      columns: [t.id, t.currentVersion],
      foreignColumns: [skillVersion.skillId, skillVersion.id],
    }),
    check('skill_current_active_ck', sql`${t.active} IN (0, 1)`),
  ],
)

/** A person's saved next-start choice, attached to an identity rather than its display name. */
export const skillSelection = sqliteTable(
  'skill_selection',
  {
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    skillId: text('skill_id')
      .notNull()
      .references(() => skillCurrent.id, { onDelete: 'cascade' }),
    choice: text('choice').notNull(),
  },
  (t) => [
    uniqueIndex('skill_selection_identity_uq').on(t.identityId, t.skillId),
    index('skill_selection_skill_idx').on(t.skillId),
    check('skill_selection_choice_ck', sql`${t.choice} IN ('default', 'on', 'off')`),
  ],
)

/** Compare-and-swap revision for catalogue edits and selections in one transaction. */
export const skillCatalogueState = sqliteTable(
  'skill_catalogue_state',
  {
    id: integer('id').primaryKey(),
    revision: integer('revision').notNull(),
  },
  (t) => [
    check(
      'skill_catalogue_state_ck',
      sql`${t.id} = 1 AND typeof(${t.revision}) = 'integer' AND ${t.revision} >= 0`,
    ),
  ],
)

/** Exact recovery bytes stay in main; window history receives metadata only. */
export const identityMethodChange = sqliteTable(
  'identity_method_change',
  {
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    operation: text('operation').notNull(),
    sourceId: text('source_id').references((): AnySQLiteColumn => identityMethodChange.id),
    target: text('target').notNull(),
    files: text('files', { mode: 'json' }).notNull(),
    by: text('by', { mode: 'json' }).notNull(),
    outcome: text('outcome').notNull(),
    actual: text('actual', { mode: 'json' }),
    createdAt: integer('created_at').notNull(),
    settledBy: text('settled_by', { mode: 'json' }),
    settledAt: integer('settled_at'),
  },
  (t) => [
    uniqueIndex('identity_method_change_sequence_uq').on(t.identityId, t.seq),
    uniqueIndex('identity_method_change_pending_uq')
      .on(t.identityId)
      .where(sql`${t.outcome} = 'pending'`),
    check('identity_method_change_sequence_ck', sql`${t.seq} >= 1`),
    check(
      'identity_method_change_operation_ck',
      sql`(${t.operation} = 'delete' AND ${t.sourceId} IS NULL) OR (${t.operation} = 'undo' AND ${t.sourceId} IS NOT NULL)`,
    ),
    check(
      'identity_method_change_outcome_ck',
      sql`(${t.outcome} = 'pending' AND ${t.actual} IS NULL) OR (${t.outcome} IN ('done', 'partial') AND ${t.actual} IS NOT NULL)`,
    ),
    check(
      'identity_method_change_settlement_ck',
      sql`(${t.settledBy} IS NULL AND ${t.settledAt} IS NULL) OR (${t.settledBy} IS NOT NULL AND ${t.settledAt} IS NOT NULL AND ${t.outcome} IN ('done', 'partial') AND typeof(${t.settledAt}) = 'integer' AND ${t.settledAt} >= 0 AND ${t.settledAt} <= 9007199254740991 AND CASE WHEN json_valid(${t.settledBy}) THEN coalesce(json_extract(${t.settledBy}, '$.who'), '') IN ('a-person', 'the-app-itself') ELSE 0 END)`,
    ),
  ],
)

/** Separate from standing rules: every version records an agent's own page or a person's edit. */
export const identityOwnNotes = sqliteTable(
  'identity_own_notes',
  {
    id: text('id').primaryKey(),
    identityId: text('identity_id')
      .notNull()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    text: text('text').notNull(),
    author: text('author'),
    actor: text('actor').notNull(),
    reason: text('reason').notNull(),
    restoredFromVersion: integer('restored_from_version'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('identity_own_notes_version_uq').on(t.identityId, t.version),
    check('identity_own_notes_version_ck', sql`${t.version} >= 1`),
    check(
      'identity_own_notes_text_ck',
      sql`length(${t.text}) <= 4000 AND instr(${t.text}, char(0)) = 0`,
    ),
    check(
      'identity_own_notes_reason_ck',
      sql`length(trim(${t.reason})) > 0 AND length(${t.reason}) <= 4000`,
    ),
    check(
      'identity_own_notes_restore_ck',
      sql`${t.restoredFromVersion} IS NULL OR (${t.restoredFromVersion} >= 0 AND ${t.restoredFromVersion} < ${t.version})`,
    ),
    check(
      'identity_own_notes_actor_ck',
      sql`json_valid(${t.actor}) AND coalesce(json_extract(${t.actor}, '$.who') IN ('a-person', 'an-agent'), 0)`,
    ),
    check(
      'identity_own_notes_author_ck',
      sql`(json_extract(${t.actor}, '$.who') = 'a-person' AND ${t.author} IS NULL) OR (json_extract(${t.actor}, '$.who') = 'an-agent' AND ${t.author} IS NOT NULL AND json_valid(${t.author}))`,
    ),
  ],
)

export const identityOwnNotesSeen = sqliteTable(
  'identity_own_notes_seen',
  {
    identityId: text('identity_id')
      .primaryKey()
      .references(() => agentIdentity.id, { onDelete: 'cascade' }),
    seenThrough: integer('seen_through').notNull().default(0),
  },
  (t) => [check('identity_own_notes_seen_ck', sql`${t.seenThrough} >= 0`)],
)
