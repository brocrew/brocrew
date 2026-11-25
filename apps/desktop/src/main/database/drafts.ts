import type { SavedDrafts } from '../../shared/saved-drafts'

export interface DraftStorage {
  readonly open: boolean
  read(): unknown
  /** Resolves after the slot changes have committed. A closed store drops the packet. */
  persist(packet: SavedDrafts): Promise<'saved' | 'closed'>
}
