import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { AppInfo } from '@brobot2/shared'
import { useModalDepth } from '../components/OverlayHost.vue'
import type VersionButton from '../components/VersionButton.vue'

/** What the rail footer reads. */
export interface RailFooterProps {
  readonly workspaceFolder: AppInfo['workspace'] | null
}

/**
 * The rail footer's two menus — this BroBot's version and updates, and the workspace picker — and
 * the workspace name it shows (S06, moved out of `SideRail.vue` unchanged).
 */
export function useRailFooter(props: RailFooterProps) {
  /**
   * 🔴 **B2 · the footer's menu** — this BroBot's version and its updates ({@link UpdatesMenu}).
   * ⚑ Closed by Esc, a second press, or a press anywhere else; focus goes back to the footer.
   */
  const updatesOpen = ref(false)
  const modalDepth = useModalDepth()
  const footerBox = ref<HTMLElement | null>(null)
  const footerButton = ref<HTMLButtonElement | null>(null)
  const workspacesOpen = ref(false)
  const workspaceDialog = ref<HTMLElement | null>(null)
  const versionButton = ref<InstanceType<typeof VersionButton> | null>(null)
  const footerName = computed(
    () => `${workspaceName.value ?? 'Local workspace'}, choose a workspace`,
  )

  /** ⚑ Esc closes it from anywhere while it is open, wherever focus went after a press. */
  function escapeCloses(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || modalDepth.value > 0) return
    if (updatesOpen.value) closeUpdates()
    else if (workspacesOpen.value) {
      workspacesOpen.value = false
      footerButton.value?.focus()
    }
  }

  function toggleWorkspaces(): void {
    workspacesOpen.value = !workspacesOpen.value
    updatesOpen.value = false
    if (workspacesOpen.value) {
      void nextTick(() => {
        const target =
          workspaceDialog.value?.querySelector<HTMLElement>('button:not(:disabled)') ??
          workspaceDialog.value
        target?.focus()
      })
    }
  }

  function toggleUpdates(): void {
    updatesOpen.value = !updatesOpen.value
    workspacesOpen.value = false
  }

  function closeUpdates(): void {
    updatesOpen.value = false
    versionButton.value?.focus()
  }

  function pressElsewhere(event: PointerEvent): void {
    if (modalDepth.value > 0) return
    if (footerBox.value !== null && !footerBox.value.contains(event.target as Node)) {
      updatesOpen.value = false
      workspacesOpen.value = false
    }
  }

  watch([updatesOpen, workspacesOpen], ([update, workspace]) => {
    if (update || workspace) {
      document.addEventListener('pointerdown', pressElsewhere)
      document.addEventListener('keydown', escapeCloses)
    } else {
      document.removeEventListener('pointerdown', pressElsewhere)
      document.removeEventListener('keydown', escapeCloses)
    }
  })
  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', pressElsewhere)
    document.removeEventListener('keydown', escapeCloses)
  })

  /** ⚑ A3 · a rename made from the menu, said at once; `AppInfo.workspace` is read at launch. */
  const renamedTo = ref<string | null>(null)
  const workspaceName = computed(() => renamedTo.value ?? props.workspaceFolder?.name ?? null)

  /** ⚑ A0 · the workspace name's first letter, by code point, for the footer's avatar. */
  const workspaceInitial = computed(
    () => [...(workspaceName.value?.trim() ?? '')][0]?.toUpperCase() ?? '',
  )

  return {
    updatesOpen,
    footerBox,
    footerButton,
    workspacesOpen,
    workspaceDialog,
    versionButton,
    footerName,
    toggleWorkspaces,
    toggleUpdates,
    closeUpdates,
    renamedTo,
    workspaceName,
    workspaceInitial,
  }
}
