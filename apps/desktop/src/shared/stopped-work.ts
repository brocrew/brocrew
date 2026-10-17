/**
 * A piece a conversation gave whose holder has stopped with it open, as *Waiting on you* draws it:
 * the holder's turn ended with the piece open, it asked no question about it and handed none of it
 * out, it isn't parked on purpose, nothing is on its way to it, and its giver was told it stalled.
 * ⚑ Work nobody was told about is `StalledWork`'s, so each piece reaches *Waiting on you* once.
 * ⚑ A person can look at it, or take it back for its giver (`takeBackWork`).
 */
export interface StoppedWorkForAPerson {
  /** The piece, by id. */
  readonly piece: string
  /** The label a person says out loud, such as `W6.4.1`. */
  readonly label: string
  /** Its title, as it stands now. */
  readonly title: string
  /** The conversation holding it, by id. */
  readonly holder: string
  /** What to call that conversation: its agent's name. */
  readonly holderName: string
  /** The conversation that gave it, by id. */
  readonly giver: string
  /** What to call the giver: its agent's name. */
  readonly giverName: string
  /** When it stopped, epoch ms. */
  readonly at: number
}
