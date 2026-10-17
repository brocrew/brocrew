import type { DocumentForm, ResourceRole } from '../../../shared/documents'
import type { KeptFile } from '../../../shared/runtime-ipc'
import { WORK_FILE_GROUPS, type WorkFileGroup } from '../../../shared/work-file-groups'

/**
 * # ⚑ UI-002 · where files show — the files kept on the work, as the window draws them
 *
 * Use the same {@link KeptFile} rows where files change hands, on the agent card and in the conversation's Files tab. Each answers a different scope question while `filesKept` and the states channel supply consistent file wording.
 *
 * ⛔ **Nothing here opens a file or reads its bytes.** A row names a file by its `resourceId`, and
 * the one viewer reads it (`CanonicalDocumentOverlay`), which never runs what it shows.
 */

/**
 * ⚑ **One scope's answer, for the conversation it was asked about** — `TheCast.treeFiles` and
 * `TheCast.cardFiles`. ⚠️ `answered: false` is *the newest read did not answer*: `files` are then
 * the last ones that did, for this same conversation.
 */
export interface FilesRead {
  readonly conversation: string
  readonly files: readonly KeptFile[]
  readonly answered: boolean
}

/**
 * ⚑ **The newest read did not answer** — said once under a list kept from the last read that did
 * (`FilesRead.answered`), the band's rule (`THE_READ_DID_NOT_ANSWER`) in a Files box's words.
 */
export const FILES_DID_NOT_ANSWER =
  'This did not answer just now, so these are the last files this window had.'

/** ⚑ What a file is to its piece, in the words each row says it with. */
export const ROLE_WORD: Readonly<Record<ResourceRole, string>> = {
  made: 'made',
  input: 'input',
}

/**
 * ⚑ **A file's size as a row says it** — `70 B`, `2 KB`, `1.4 MB`, in the 1024-based units the
 * app's other sizes use (`process-memory.ts`).
 */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

/**
 * ⚑ **A row's title, and what its tooltip adds** — the title is the file's first heading or its
 * name (D-026), so a tooltip that repeated one of them would say nothing; ⚑ it names the file too
 * where the title is not its name.
 */
export function fileTitleSays(file: Pick<KeptFile, 'title' | 'name'>): string {
  return file.title === file.name ? file.title : `${file.title} — ${file.name}`
}

/**
 * ⚑ **A scope's answer, kept by the band's rule** (`RuntimeScreen.readTheCast`): an answer is the
 * list; ⚠️ a read that did not answer keeps the last list for the SAME conversation, marked, and
 * ⛔ one for a conversation never answered about has nothing to keep.
 */
export function filesReadFor(
  conversation: string,
  files: readonly KeptFile[] | null,
  kept: FilesRead | null,
): FilesRead | null {
  if (files !== null) return { conversation, files, answered: true }
  return kept?.conversation === conversation ? { ...kept, answered: false } : null
}

/** Another piece that kept the same bytes, and the conversation that holds that piece. */
export interface AlsoKeptOn {
  readonly piece: string
  readonly label: string
  /** `null` where no conversation holding it is known. */
  readonly conversation: string | null
}

/** One file of the Files tab: drawn once, with the other pieces that kept the same bytes. */
export interface TreeFileLine {
  readonly file: KeptFile
  readonly alsoOn: readonly AlsoKeptOn[]
}

/** One piece of the tree and its lines, in the door's order. */
export interface TreeFileGroup {
  readonly piece: string
  readonly label: string
  readonly pieceTitle: string | null
  /**
   * ⚑ **How many DRAWN pieces it stands under** — `W1.3.1` is 2 under `W1` and `W1.3` when both are
   * drawn, 1 when only `W1` is; ⛔ a piece above it with no file is not drawn and sets nothing in.
   */
  readonly depth: number
  readonly lines: readonly TreeFileLine[]
  readonly sections: readonly {
    readonly group: WorkFileGroup | null
    readonly lines: readonly TreeFileLine[]
  }[]
}

/**
 * Which keep of the same bytes a file's one row stands at: the main result, else the first section
 * in Result, Brief, Attachments, Working files order (then none), else the piece highest in the
 * tree, else the earliest keep.
 */
const SECTION_RANK: readonly (WorkFileGroup | null)[] = [
  'result',
  'brief',
  'attachments',
  'working',
  null,
]
function mattersMore(a: KeptFile, b: KeptFile): boolean {
  if (Boolean(a.mainResult) !== Boolean(b.mainResult)) return Boolean(a.mainResult)
  const section = SECTION_RANK.indexOf(a.group ?? null) - SECTION_RANK.indexOf(b.group ?? null)
  if (section !== 0) return section < 0
  const depth = a.label.split('.').length - b.label.split('.').length
  if (depth !== 0) return depth < 0
  return a.keptAt < b.keptAt
}

/**
 * ⚑ **The Files tab: grouped by piece in tree order** (`07` §2 item 3) — the door's own order (a
 * piece before the pieces under it, oldest first within one). Each file, by its bytes, is drawn
 * once, at the keep that matters most, with the other pieces that kept the same bytes.
 */
export function treeFileGroups(
  files: readonly KeptFile[],
  holderOf: (piece: string) => string | null = () => null,
): readonly TreeFileGroup[] {
  const kept = new Map<string, KeptFile[]>()
  for (const file of files) {
    const same = kept.get(file.sha256)
    if (same === undefined) kept.set(file.sha256, [file])
    else same.push(file)
  }
  const lines = new Map<KeptFile, TreeFileLine>()
  for (const same of kept.values()) {
    const file = same.reduce((best, one) => (mattersMore(one, best) ? one : best))
    const alsoOn = new Map<string, AlsoKeptOn>()
    for (const one of same) {
      if (one.piece === file.piece || alsoOn.has(one.piece)) continue
      // The conversation holding the piece; else the one that made the file on it, which holds it.
      // An input's keeper is its giver, which holds another piece.
      const maker = same.find((keep) => keep.piece === one.piece && keep.role === 'made')
      alsoOn.set(one.piece, {
        piece: one.piece,
        label: one.label,
        conversation: holderOf(one.piece) ?? maker?.addedBy?.conversation ?? null,
      })
    }
    lines.set(file, { file, alsoOn: [...alsoOn.values()] })
  }
  const groups = new Map<string, { head: KeptFile; lines: TreeFileLine[] }>()
  for (const file of files) {
    const line = lines.get(file)
    if (line === undefined) continue
    const group = groups.get(file.piece)
    if (group === undefined) groups.set(file.piece, { head: file, lines: [line] })
    else group.lines.push(line)
  }
  const drawn = new Set([...groups.values()].map(({ head }) => head.label))
  const order = [...new Set(files.map((file) => file.piece))]
  return order.flatMap((piece) => {
    const found = groups.get(piece)
    if (found === undefined) return []
    const { head, lines: inPiece } = found
    const parts = head.label.split('.')
    const depth = parts
      .slice(1)
      .filter((_, index) => drawn.has(parts.slice(0, index + 1).join('.'))).length
    const sections = [...WORK_FILE_GROUPS, null].flatMap((group) => {
      const inGroup = inPiece.filter((line) => (line.file.group ?? null) === group)
      return inGroup.length === 0 ? [] : [{ group, lines: inGroup }]
    })
    return [
      {
        piece: head.piece,
        label: head.label,
        pieceTitle: head.pieceTitle,
        depth,
        lines: inPiece,
        sections,
      },
    ]
  })
}

/** The other pieces that kept a file, in a row's words: "Also kept on W1.1.1, W1.1.2." */
export const ALSO_KEPT_ON = 'Also kept on'

/** ⚑ **How many files the tree holds** — distinct bytes, the Files tab's count (`07`: 11 kept, 8 files). */
export function distinctFiles(files: readonly KeptFile[]): number {
  return new Set(files.map((file) => file.sha256)).size
}

/** ⚑ The Files tab's three filters (`07` §2 item 3). */
export const FILE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'made', label: 'Made' },
  { id: 'input', label: 'Inputs' },
] as const
export type FileFilter = (typeof FILE_FILTERS)[number]['id']

/**
 * ⚑ **The files under one filter, by their role** — filtered BEFORE they are grouped, so where a
 * filter hides the keep a file's row would stand at, the keep it shows that matters most is its row.
 */
export function filtered(files: readonly KeptFile[], filter: FileFilter): readonly KeptFile[] {
  return filter === 'all' ? files : files.filter((file) => file.role === filter)
}

/** ⚑ What a filter that leaves nothing says — ⛔ never *no files*, which the tree does not claim. */
export const NONE_UNDER: Readonly<Record<Exclude<FileFilter, 'all'>, string>> = {
  made: 'Nothing on this work was made yet — only inputs were handed over.',
  input: 'No inputs were handed over on this work.',
}

/** ⚑ Who added a file, in a row's words — ⛔ `null` is a person, and the person is *you*. */
export const addedBySays = (file: Pick<KeptFile, 'addedBy'>): string => file.addedBy?.name ?? 'You'

/**
 * ⚑ **UI-002 · the files a conversation's cards can name** (`07` §2 item 1) — its tree's files, by
 * id for a reply's `resources`, and by piece label for the inputs a give handed over. ⛔ `null`
 * where the tree has not been read: every card then draws what it drew before.
 */
export interface FilesOnScreen {
  readonly byId: ReadonlyMap<string, KeptFile>
  /**
   * The inputs kept on the piece that label names, in the door's order — ⚑ only those kept by
   * `until` where it is given, so a card lists what was handed over WITH it and not the inputs its
   * giver added to the piece later (`update_work`).
   */
  readonly inputsOn: (label: string, until?: number) => readonly KeptFile[]
}

export function filesOnScreen(files: readonly KeptFile[] | null): FilesOnScreen | null {
  if (files === null) return null
  const byId = new Map(files.map((file) => [file.resourceId, file]))
  return {
    byId,
    inputsOn: (label, until) =>
      files.filter(
        (file) =>
          file.label === label &&
          file.role === 'input' &&
          (until === undefined || file.keptAt <= until),
      ),
  }
}

/**
 * ⚑ **A reply's files, split by what the tree says of them** — the ids it read become rows, and
 * ⛔ an id it has not read yet keeps the press the card drew before (`510`), never a row guessed.
 */
export function namedBy(
  ids: readonly string[],
  onScreen: FilesOnScreen | null,
): { readonly rows: readonly KeptFile[]; readonly unread: readonly string[] } {
  const rows: KeptFile[] = []
  const unread: string[] = []
  for (const id of ids) {
    const file = onScreen?.byId.get(id)
    if (file === undefined) unread.push(id)
    else rows.push(file)
  }
  return { rows, unread }
}

/**
 * ⚑ **UI-002 · how many files each piece holds** (`07` §2 item 3: *"in the Graph tab, a piece with
 * files shows a small count that opens this tab at that piece"*) — distinct bytes, as the tab counts.
 */
export function filesPerPiece(files: readonly KeptFile[]): ReadonlyMap<string, number> {
  const bytes = new Map<string, Set<string>>()
  for (const file of files) {
    const held = bytes.get(file.piece)
    if (held === undefined) bytes.set(file.piece, new Set([file.sha256]))
    else held.add(file.sha256)
  }
  return new Map([...bytes].map(([piece, held]) => [piece, held.size]))
}

/** ⚑ The count's press, in words — what it opens. */
export const showFilesOn = (count: number, label: string): string =>
  count === 1 ? `Show the file kept on ${label}` : `Show the ${count} files kept on ${label}`

/** ⚑ **UI-002 · a file's kind, as the viewer's header says it** (`07` §3). */
export const FORM_WORD: Readonly<Record<DocumentForm, string>> = {
  markdown: 'Markdown',
  page: 'Page',
  image: 'Image',
  pdf: 'PDF',
}

/**
 * ⚑ **UI-002 · where a file came from, in the viewer's header** (`07` §3): *"Made by Ali for W1.9 ·
 * List the open findings in a small table"* — or *handed over by*, for an input; ⛔ a person is *you*.
 */
export function whereFrom(
  file: Pick<KeptFile, 'role' | 'addedBy' | 'label' | 'pieceTitle'>,
): string {
  const who = file.addedBy?.name ?? 'you'
  const act = file.role === 'made' ? 'Made' : 'Handed over'
  const piece = file.pieceTitle === null ? file.label : `${file.label} · ${file.pieceTitle}`
  return `${act} by ${who} for ${piece}`
}

/** ⚑ **A conversation's own root and the files kept on it** — for the Graph tab's count. */
export interface RootFiles {
  readonly conversation: string
  readonly piece: string
  readonly label: string
  readonly count: number
}

/**
 * ⚑ **UI-002 · the files on this conversation's own root** (`W1`) — a root is never a task line on
 * the Graph tab (D-016 · R1: it shows through its conversation), so its count sits on the
 * conversation's own card. ⚑ A root's label has no dot, and the only root in a conversation's tree
 * is its own. ⛔ `null` where it holds none.
 */
export function rootFilesOf(conversation: string, files: readonly KeptFile[]): RootFiles | null {
  const onRoot = files.filter((file) => !file.label.includes('.'))
  const head = onRoot[0]
  if (head === undefined) return null
  return {
    conversation,
    piece: head.piece,
    label: head.label,
    count: distinctFiles(onRoot.filter((file) => file.piece === head.piece)),
  }
}

/** ⚑ W4.183 · a file's kind by its name — its tile and its popup row tint its glyph by it. */
export function fileKindOf(file: { readonly name: string }): 'image' | 'pdf' | 'svg' | 'text' {
  const dot = file.name.lastIndexOf('.')
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'svg') return 'svg'
  return 'text'
}
