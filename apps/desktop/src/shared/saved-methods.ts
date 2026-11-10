/**
 * A profile's saved methods: short, tested ways of doing a recurring task, kept as one file each in
 * the profile's own folder, with one index line per method. Every launch of the profile's
 * conversations is given the index as it was read then.
 */

/** The most the index sent to a conversation may take, in UTF-8 bytes; a larger one is not sent. */
export const SAVED_METHODS_MOST_INDEX_BYTES = 4096

/** The most one method's file may hold; an index line naming a larger one is left out. */
export const SAVED_METHODS_MOST_METHOD_BYTES = 16 * 1024

/** Why a launch was given no index from a profile's saved methods. */
export type SavedMethodsRefusal =
  | { readonly kind: 'too-large'; readonly bytes: number }
  | { readonly kind: 'a-link'; readonly what: 'the-folder' | 'the-index' | 'a-method' }
  | { readonly kind: 'not-a-file'; readonly what: 'the-folder' | 'the-index' }
  | { readonly kind: 'index-file-too-large' }
  | { readonly kind: 'unreadable' }

/** What one launch was given from its profile's saved methods. */
export type SavedMethodsUse =
  | { readonly given: 'none' }
  | {
      readonly given: 'index'
      readonly folder: string
      readonly methods: number
      /** The index lines left out because they were not in the saved-method form. */
      readonly leftOut: number
      readonly bytes: number
      /** The index as sent. */
      readonly index: string
      readonly readAt: number
    }
  | { readonly given: 'refused'; readonly refusal: SavedMethodsRefusal; readonly readAt: number }

export function savedMethodsRefusalSaid(refusal: SavedMethodsRefusal): string {
  switch (refusal.kind) {
    case 'too-large':
      return `it came to ${refusal.bytes.toLocaleString('en-US')} bytes, over the ${String(SAVED_METHODS_MOST_INDEX_BYTES / 1024)} KiB limit`
    case 'a-link':
      return `${refusal.what === 'the-folder' ? 'the folder' : refusal.what === 'the-index' ? 'index.md' : 'a method’s file'} is a link, which this app does not follow`
    case 'not-a-file':
      return refusal.what === 'the-folder'
        ? 'the saved-methods path is not a folder'
        : 'index.md is not a plain file'
    case 'index-file-too-large':
      return 'index.md is too large to read'
    case 'unreadable':
      return 'its folder could not be read'
  }
}

/** The popup's line for what a launch was given from the profile's saved methods. */
export function savedMethodsUseSaid(use: SavedMethodsUse, at: (time: number) => string): string[] {
  switch (use.given) {
    case 'none':
      return ['Saved methods: none saved for this profile yet.']
    case 'index':
      return [
        use.methods === 0
          ? `Saved methods: none in the index, read at ${at(use.readAt)}.`
          : `Saved methods: ${String(use.methods)}, ${use.bytes.toLocaleString('en-US')} bytes, read at ${at(use.readAt)}.`,
        ...(use.leftOut === 0
          ? []
          : [
              `${String(use.leftOut)} ${use.leftOut === 1 ? 'line' : 'lines'} of the index ${use.leftOut === 1 ? 'was' : 'were'} not in the saved-method form and ${use.leftOut === 1 ? 'was' : 'were'} left out.`,
            ]),
      ]
    case 'refused':
      return [
        `The saved-methods index was not sent: ${savedMethodsRefusalSaid(use.refusal)}. Read at ${at(use.readAt)}.`,
      ]
  }
}
