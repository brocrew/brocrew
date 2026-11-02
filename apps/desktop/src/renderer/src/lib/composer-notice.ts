/** A reason Send can't go, in a person's words, with the press that fixes it when there is one. */
export interface SendBlock {
  words: string
  fix?: { label: string; press: () => void }
}
