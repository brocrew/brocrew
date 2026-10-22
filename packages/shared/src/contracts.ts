import { z } from 'zod'

/**
 * Provider-neutral runtime contracts, zod-validated at every boundary.
 *
 * Step 0 deliberately ships only the minimum needed to persist provider
 * sessions and prove the boundary pattern. Slice 1 (tasks 004–006) extends
 * this with the full RuntimeEvent taxonomy from HO-001 §6.
 */

export { providerSchema } from './provider-schema'
export { providerValue } from './providers'
export type { Provider } from './providers'

/**
 * Orthogonal provider-session status machine.
 * Describes the conversation, not the task.
 */
export const sessionStatusSchema = z.enum([
  'idle',
  'working',
  'waiting_permission',
  'ended',
  'errored',
])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

/**
 * **How a TURN ended** (045, put on the wire by 222).
 *
 * The first three are the provider's own `turn` states (709, R43 — the machine no longer renames
 * one once a stop is asked; of its own three endings, `forceEnd` always says `interrupted`, and
 * `failTurn` and a fatal error say it only after an ask). `ended` is the session going terminal
 * underneath an open turn. ⛔ **`unknown` is the honest fifth** — a turn whose ending nobody
 * observed. Three ways to reach it, and a clean quit is NOT one of them (that records `ended`,
 * because the provider confirmed it stopped): the app died mid-turn and the next launch's sweep
 * settled the row; a teardown could not confirm the provider stopped and let go of the handle
 * anyway (208 H3); or an imported ledger simply never recorded an ending. It exists so those are
 * RECORDED rather than back-filled as `completed`.
 *
 * ⚠️ **Here rather than in `session-store.ts`, where 045 declared it, because 222 made it something
 * a surface reads.** It was the database's private vocabulary while the only reader was the
 * database; the moment the Sessions page and the rail describe a conversation with it, a second
 * hand-written copy in `runtime-ipc.ts` would be free to drift from the CHECK constraint that
 * actually governs the column. `turn-ending.test.ts` reads the constraint out of a migrated
 * database and pins it against this list, so the two cannot part company silently.
 */
export const turnEndingSchema = z.enum(['completed', 'failed', 'interrupted', 'ended', 'unknown'])
export type TurnEnding = z.infer<typeof turnEndingSchema>

/** The members, in declaration order — for the census that compares them against the DB CHECK. */
export const TURN_ENDINGS = turnEndingSchema.options

/**
 * ⚑ **The two build ids that are WORDS rather than shas** (331), here rather than in the three
 * files that used to spell them.
 *
 * ⛔ The producer decides which one a build gets (`build-stamp.ts`) and the renderer's tooltip
 * branches on it (`RuntimeScreen.vue`) — two copies of a literal, in different packages, where a
 * rename in one would not fail anything: the chip would keep rendering and the hover would quietly
 * explain the wrong thing. This is the same rule the `build.dirty` field is under, one level up.
 */
export const BUILD_IS_DEV = 'dev'
export const BUILD_IS_UNRECORDED = 'unknown'

/**
 * Payload returned by the `app:info` IPC channel. Kept here so main (producer)
 * and renderer (consumer) share one validated shape across the context bridge.
 */
export const appInfoSchema = z.object({
  name: z.string(),
  /**
   * 🔴 **695 §1 · the name this window wears in its own bar** — `BroBot2` for a person's launch,
   * `BroBot2 — test` for one given `--brobot-hidden` (`main/launch-presentation.ts`), and since
   * `724` (`718` F-1) `BroBot2 — <folder>` for a person's launch whose userData is not the app's
   * default. ⚠️ The hidden name wins when both hold (`windowTitleFor`).
   *
   * ⛔ **Why the bar needs it and the native title is not enough**: the window is frameless (385),
   * so the OS title is seen only in Mission Control and the Window menu. The name a person reads,
   * when a hidden window is brought forward, is the one `AppTitleBar.vue` draws — and until 695 that
   * was a literal. Required, like every field here: the producer can always supply it.
   */
  windowTitle: z.string(),
  /**
   * Identify this window's workspace by its userData path, display name and whether it is the default from `main/data-folder.ts`. The rail footer names the workspace rather than the person.
   *
   * ⚑ `name` is the person's own name for it — `{"name"}` in `<folder>/workspace.json` — else
   * `Default` for the default folder and the folder's own name for any other. `path` is the folder,
   * for a hover. e.g. `{ name: 'Research', path: '/Users/x/brobot-research', isDefault: false }`.
   */
  workspace: z.object({
    name: z.string(),
    path: z.string(),
    isDefault: z.boolean(),
  }),
  version: z.string(),
  step: z.string(),
  /**
   * Which BUILD this is (331). ⛔ **`version` is not this and never was** — it is
   * `package.json`'s `"0.0.0"`, unchanged since the first commit, and the chip that showed it was
   * the only thing in the running app that looked like build identity.
   *
   * ⚠️ **Every field is required and every field is a value the producer can always supply.**
   * `id` is a short sha or one of the honest words `dev` / `unknown`; `commit` is the full sha or
   * `''`. Nothing here is optional, because `app:info` is parsed on the way out and an absent
   * field would fail that parse — which would blank the schema count beside it on the chip
   * (`RuntimeScreen.vue`, 039), turning a build we could not name into an app that looks broken.
   */
  build: z.object({
    id: z.string(),
    commit: z.string(),
    dirty: z.boolean(),
    /**
     * ⚑ **F077 · which of `dev`, `prompts` and `ui` a build of `develop` holds, and any left out** —
     * each with its short tip: held at it, held at an older commit (`behind` newer ones not here),
     * or left out, with the held branches it conflicts with (`null`: not known). ⚑ `null` for a build that is not that combination, or that recorded nothing.
     */
    branches: z
      .array(
        z.union([
          z.object({ name: z.string(), tip: z.string(), held: z.literal(true) }),
          z.object({
            name: z.string(),
            tip: z.string(),
            held: z.literal('older'),
            holdsUpTo: z.string(),
            behind: z.number().int().nonnegative(),
          }),
          z.object({
            name: z.string(),
            tip: z.string(),
            held: z.literal(false),
            conflictsWith: z.array(z.string()).nullable(),
            conflictsWithBuild: z.boolean().nullable(),
          }),
        ]),
      )
      .nullable(),
  }),
  db: z.object({
    migrationsApplied: z.number().int().nonnegative(),
    providerSessionCount: z.number().int().nonnegative(),
  }),
})
export type AppInfo = z.infer<typeof appInfoSchema>
