/**
 * 🔴 **Opening one resource — the rule, in the one place that holds it** (640; a resource since
 * D-016).
 *
 * ⛔ **`562` counted the derivations behind a document press and found ONE of everything that
 * DECIDES** — *may this be pressed here* · *what the press says* · *where it goes* · *who fetches*
 * · *what a failure shows*. ⚠️ **What was not one was HOW**: three surfaces each held their own
 * `readingDocument`, each mounted their own `OverlayHost` + `CanonicalDocumentViewer`, and each
 * spelled the may-open test for themselves. ⚑ **This module and
 * {@link CanonicalDocumentOverlay} are the fold**; nothing about the five above changed.
 *
 * ⚠️ **The type is here rather than re-spelled at each prop**, because three identical inline
 * function types are three chances for the fourth to differ.
 */
import type { ResourceDrawing, ResourceReading, ResourceReveal } from '../../../shared/runtime-ipc'

/**
 * ⚑ **The door onto a kept resource's bytes**, as a surface receives it (510, 550).
 *
 * ⛔ **It takes no session id.** A resource id is a primary key in main's own table, so the answer
 * does not depend on which conversation — or which room — is on screen; `RuntimeScreen`'s
 * `readResourceForAnySurface` is the one implementation and its docblock says why it carries no
 * `activeId` guard.
 */
export type ResourceReader = (resourceId: string) => Promise<ResourceReading>

/**
 * 🔴 **D-032 · the door onto a kept picture or PDF's bytes, to draw**, by the same id. ⛔ Absent,
 * the file is told about and not drawn.
 */
export type ResourceDrawer = (resourceId: string) => Promise<ResourceDrawing>

/** ⚑ **D-032 · the door that shows a kept file in Finder.** ⛔ Absent, no Show in Finder is drawn. */
export type ResourceRevealer = (resourceId: string) => Promise<ResourceReveal>

/**
 * 🔴 **May this surface open a resource? — the ONE place that answers it** (640).
 *
 * ⛔ **The rule is `106`/`118`, and it has not changed**: the press is ABSENT rather than dead
 * where the surface was given no door. ⚑ Before this module the same sentence was spelled on
 * several surfaces, among them `ConversationPane` and `ReadingPane`; a surface that had drifted to `!== null` or to a boolean somebody remembered would
 * have drawn a control that does nothing when pressed.
 *
 * ⚠️ **A type guard and not a `boolean`**, so the caller that passes the test may CALL the reader
 * without a second check — {@link CanonicalDocumentOverlay}'s `open` is that caller, and a
 * separate `if (!read) return` beside this would be the second reading this fold exists to remove.
 */
export function aSurfaceMayOpenADocument(read: ResourceReader | undefined): read is ResourceReader {
  return read !== undefined
}
