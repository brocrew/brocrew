/**
 * # ⚑ 678 · Where a person creates an agent, in the words of the control that does it
 *
 * ⛔ **Three sentences told a person to create an agent *"from the rail"*** — the refusal a sheet
 * shows when its identity is gone (`agent-store.ts`, twice) and New project's scope note. ⚠️ **True
 * at `423`, when the rail's AGENTS section had a create button; false since `570`**, which moved
 * that section's job to the Team page (`EXT-008` §4.4) and with it the only door to the `newAgent`
 * overlay (`RuntimeScreen.vue`, `@create` on `TeamWorkspace`). ⚑ `672` F2 found the first two.
 *
 * 🔴 **So the button's label lives HERE and the button draws it** — standing rule 8.2: a sentence
 * rendered from the thing it names cannot drift from it, and one that describes it can.
 */

/** ⚑ The Team page's create button, as it is drawn (`TeamWorkspace.vue`, `data-cy="team-create"`). */
export const NEW_AGENT = 'New agent'

/** ⚑ Where that button is, for a sentence that sends a person to it. */
export const WHERE_AGENTS_ARE_CREATED = `with ${NEW_AGENT} on the Team page`
