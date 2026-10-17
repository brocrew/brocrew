/**
 * 🔴 **718 · `710` F-9 — what the screen does when a start from the StartAsAgent sheet settles.**
 *
 * ⛔ **The sheet used to close BEFORE the launch was asked**, and a refusal was then drawn only by
 * the launcher — not on screen while a person starts a conversation from a Team card — so it showed
 * nowhere. ⚑ Now the sheet stays up while its launch runs and the two moments it can settle in are
 * decided here, as data, because `RuntimeScreen` is mounted by no test (`211` §11):
 *
 * | settled | the sheet that asked is still up | it is not (another overlay replaced it — a close CANCELS the launch, `RuntimeScreen.closeOverlay`) |
 * |---|---|---|
 * | the conversation **opened** | close it — the conversation is what the person asked for | leave the overlay alone: it is somebody else's now |
 * | the host **refused** | nothing here: the sheet draws the refusal itself (`store.placedError`) | say it in the window-wide notice |
 *
 * ⚠️ **The notice is `overlays.notify`'s lane, never the frame's own `.toast`**: this is exactly the
 * case where an overlay may be up, and that toast paints UNDER `OverlayHost`'s scrim.
 * ⛔ **A Cancel is neither** — the person asked for it, so nothing is closed and nothing is said
 * (`102`); the sheet hands its words back itself.
 */
export type PlacedLaunchEnded =
  { readonly kind: 'opened' } | { readonly kind: 'refused'; readonly sentence: string }

/** What the screen does about it — see the table above. */
export interface AfterAPlacedLaunch {
  readonly close: boolean
  readonly notice: string | null
}

export function afterAPlacedLaunch(
  ended: PlacedLaunchEnded,
  sheetStillThere: boolean,
): AfterAPlacedLaunch {
  if (ended.kind === 'opened') return { close: sheetStillThere, notice: null }
  return { close: false, notice: sheetStillThere ? null : ended.sentence }
}
