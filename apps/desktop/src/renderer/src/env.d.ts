import type { PluginsClient } from '../../shared/plugin-settings'
import type { TranscriptRetention } from '../../shared/transcript-retention'
import type { AttentionSignal } from '../../shared/attention-signals'
import type { DockLabel, DockLabelChange } from '../../shared/dock-label'
/// <reference types="vite/client" />
import type { AppInfo, Provider } from '@brobot2/shared'
import type {
  ChosenAttachment,
  ChosenCwd,
  DroppedPathVerdict,
  HandedPath,
  RuntimeBridge,
} from '../../shared/runtime-ipc'
import type { PagePerformanceReport, PageReportAnswer } from '../../shared/page-performance'
import type { WindowControl, WindowControlEffect } from '../../shared/window-controls'
import type { SavedDrafts } from '../../shared/saved-drafts'
import type { LocalZone } from '../../shared/local-time'
import type { UpdatesSettingsChange, UpdatesSnapshot } from '../../shared/updates'
import type {
  NewWorkspace,
  WorkspaceChanged,
  WorkspaceDeleted,
  WorkspaceDeleteVerdict,
  WorkspaceFolderVerdict,
  WorkspaceOpened,
  WorkspaceRename,
  WorkspaceRow,
} from '../../shared/workspaces'
import type { SnapshotAnswer, SnapshotCatalogue } from '../../shared/provider-snapshots'
import type { RecoveryBridge } from '../../shared/recovery'
import type { ThemesBridge } from '../../shared/theme-library'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

declare global {
  interface Window {
    // Exposed by src/preload/index.ts across the context bridge.
    api: {
      getAppInfo: () => Promise<AppInfo>
      themes: ThemesBridge
      plugins?: PluginsClient
      /** The page's own freeze report, for the stall log beside main's stalls. */
      recordPagePerformance: (report: PagePerformanceReport) => Promise<PageReportAnswer>
      /** 🔴 **B1 · updates** — every call answers the new snapshot (`shared/updates.ts`). */
      updates: {
        read: () => Promise<UpdatesSnapshot>
        checkNow: () => Promise<UpdatesSnapshot>
        set: (change: UpdatesSettingsChange) => Promise<UpdatesSnapshot>
        download: () => Promise<UpdatesSnapshot>
        restartWhenQuiet: () => Promise<UpdatesSnapshot>
        cancelRestart: () => Promise<UpdatesSnapshot>
        onChanged: (listener: (snapshot: UpdatesSnapshot) => void) => () => void
      }
      /**
       * 🔴 **Close, minimise or zoom this window** (385 §1) — the only pointing gesture that closes
       * a `frame: false` app. `shared/window-controls.ts` carries the vocabulary and the argument.
       */
      attentionSignals: (signal: AttentionSignal) => Promise<void>
      /** This workspace's short name and colour on the Dock icon (`shared/dock-label.ts`). */
      transcriptRetention?: {
        read: () => Promise<TranscriptRetention>
        set: (period: TranscriptRetention) => Promise<TranscriptRetention>
      }
      dockLabel?: {
        read: () => Promise<DockLabel>
        set: (change: DockLabelChange) => Promise<DockLabel>
      }
      windowControl: (control: WindowControl) => Promise<WindowControlEffect>
      /** 🔴 **744 · R100** — the drafts the last run left, each for its own slot; `null`: not read. */
      savedDrafts: () => Promise<SavedDrafts | null>
      /** 🔴 **744 · R100** — keep the whole draft book in the app's own userData. */
      saveDrafts: (saved: SavedDrafts) => Promise<void>
      /** 🔴 **744** — the quit asks for the book once more, after the conversations are closed. */
      onLastDraftSave: (listener: () => void) => () => void
      /** 🔴 **D-031** — the Mac's own time zone, as main read it; `null`: not read. */
      localZone: () => Promise<LocalZone | null>
      /** 🔴 **D-031** — the Mac's time zone moved: the zone main read again, whole. */
      onLocalZone: (listener: (zone: LocalZone) => void) => () => void
      /** The native folder picker for a new conversation's cwd (076). `null` when cancelled. */
      chooseCwd: () => Promise<ChosenCwd>
      /** The native file picker for a session bundle (214 §1). `null` when cancelled. */
      chooseBundle: () => Promise<string | null>
      /** The native picker for a file or folder to hand the agent (216 §2). `null` when cancelled. */
      chooseAttachment: (input?: { cwd?: string }) => Promise<ChosenAttachment>
      /** Re-decide the `outside` caption for already-chosen paths against a changed folder (217 §2). */
      classifyAttachments: (input: { handed: HandedPath[]; cwd?: string }) => Promise<HandedPath[]>
      /**
       * ⛔ **The path under a DROPPED file** (218 §2) — `''` when there is none on this machine.
       *
       * ⚠️ **Synchronous, and that matters.** `dataTransfer.files` is only readable during the drop
       * event; an `await` before reading it hands back an empty list. See `PromptComposer`'s own
       * note — the paths are resolved first, and only then does anything asynchronous happen.
       */
      pathForDroppedFile: (file: File) => string
      /**
       * Classify dropped paths through the picker's own rule (218 §2) — one answer per path, plus
       * ⚑ **one trailing refusal when more were dropped than main will look at** (232 §3): a cap
       * is fine, a silent cap is `106`.
       */
      handDroppedPaths: (input: { paths: string[]; cwd?: string }) => Promise<DroppedPathVerdict[]>
      /**
       * ⛔ **Write the clipboard's picture down and classify the path** (254 §2) — one verdict.
       *
       * ⚠️ **The renderer never sees the bytes.** It knows only that the paste carried an entry with
       * no path on this machine; main reads the clipboard and answers with the same
       * `{ handed } | { refusal }` a drop gets.
       */
      pasteImage: (input?: { cwd?: string }) => Promise<DroppedPathVerdict>
      onNavigate: (listener: (direction: 'back' | 'forward') => void) => () => void
      /**
       * 🔴 **The app is closing** (271 §2) — subscribe, and unsubscribe with the returned function.
       *
       * ⚠️ **It arrives once and is never withdrawn**: a quit that has begun cannot be cancelled, so
       * a listener that saw it may treat the app as ending for good.
       */
      onClosing: (listener: () => void) => () => void
      runtime: RuntimeBridge
      /**
       * 🔴 **W4.109 · B1 — updates** (`main/updates.ts` decides): every call answers the new
       * snapshot, and `onChanged` is told every move.
       */
      updates: {
        read: () => Promise<UpdatesSnapshot>
        checkNow: () => Promise<UpdatesSnapshot>
        set: (change: UpdatesSettingsChange) => Promise<UpdatesSnapshot>
        download: () => Promise<UpdatesSnapshot>
        restartWhenQuiet: () => Promise<UpdatesSnapshot>
        cancelRestart: () => Promise<UpdatesSnapshot>
        onChanged: (listener: (snapshot: UpdatesSnapshot) => void) => () => void
      }
      /**
       * 🔴 **W4.131 · A2 — workspaces** (`main/workspaces.ts` decides). ⛔ None of this chooses where
       * this window runs.
       */
      workspaces: {
        list: () => Promise<WorkspaceRow[]>
        open: (path: string) => Promise<WorkspaceOpened>
        create: (input: NewWorkspace) => Promise<WorkspaceOpened>
        rename: (input: WorkspaceRename) => Promise<WorkspaceChanged>
        remove: (path: string) => Promise<WorkspaceChanged>
        checkFolder: (path: string, toMake?: boolean) => Promise<WorkspaceFolderVerdict | null>
        folderFor: (name: string) => Promise<string>
        chooseFolder: () => Promise<string | null>
        /** W4.151 · whether a workspace may be deleted, and what would go to the Trash. */
        checkDelete: (path: string) => Promise<WorkspaceDeleteVerdict>
        /** W4.151 · its folder to the Trash, and its row off the list. */
        delete: (path: string) => Promise<WorkspaceDeleted>
      }
      /** W4.164 · what a bundled provider puts in front of its model on its own, per model. */
      providerSnapshots: {
        list: () => Promise<SnapshotCatalogue[]>
        forModel: (provider: Provider, model: string | null) => Promise<SnapshotAnswer>
      }
    }
    /** Present only in the recovery window, from its own preload. */
    recovery?: RecoveryBridge
  }
}

export {}
