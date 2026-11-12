export interface UpdateWorkspaceId {
  readonly folder: string
  readonly pid: number
}

export interface UpdateWorkspace extends UpdateWorkspaceId {
  readonly executable: string
  readonly name: string
  readonly startedAt: number
  readonly ready: boolean
  readonly owner: UpdateWorkspaceId | null
}

export type WorkspaceUpdateRequest =
  | { readonly kind: 'update'; readonly installer: UpdateWorkspaceId; readonly version: string }
  | { readonly kind: 'prepare' | 'quit' | 'cancel'; readonly owner: UpdateWorkspaceId }
  | {
      readonly kind: 'install'
      readonly owner: UpdateWorkspaceId
      readonly version: string
      readonly folders: readonly string[]
    }

interface WorkspaceUpdateDeps {
  readonly self: Omit<UpdateWorkspace, 'owner' | 'ready'>
  ready(): boolean
  discover(): Promise<readonly UpdateWorkspace[]>
  request(peer: UpdateWorkspaceId, request: WorkspaceUpdateRequest): Promise<void>
  prepare(): Promise<void>
  remember(version: string, folders: readonly string[]): void
  report(error: unknown): void
  quit(): void
  install(): void
}

const same = (a: UpdateWorkspaceId, b: UpdateWorkspaceId): boolean =>
  a.folder === b.folder && a.pid === b.pid

/** All workspace requests use the existing presence connection and normal quit preparation. */
export function workspaceUpdate(deps: WorkspaceUpdateDeps) {
  let owner: UpdateWorkspaceId | null = null
  let operation: Promise<void> | null = null
  let preparation: Promise<void> | null = null
  let installChosen = false
  let installed = false
  let quitChosen = false
  let installRequested = false

  const quit = (): void => {
    if (quitChosen) return
    quitChosen = true
    deps.quit()
  }

  const details = (): UpdateWorkspace => ({ ...deps.self, ready: deps.ready(), owner })
  const participants = async (): Promise<readonly UpdateWorkspace[]> => {
    const peers = await deps.discover()
    if (!peers.some((peer) => same(peer, deps.self))) {
      throw new Error('This workspace could not be found among the running copies of BroCrew')
    }
    return peers
  }
  const call = (peer: UpdateWorkspaceId, request: WorkspaceUpdateRequest): Promise<void> =>
    same(peer, deps.self) ? receive(request) : deps.request(peer, request)

  async function receive(request: WorkspaceUpdateRequest): Promise<void> {
    if (request.kind === 'update') {
      if (owner !== null && !same(owner, deps.self)) {
        throw new Error('Another workspace is already preparing the update')
      }
      owner = deps.self
      operation ??= perform(request.installer, request.version).catch((error: unknown) => {
        if (!installRequested) {
          operation = null
          owner = null
        }
        throw error
      })
      return operation
    }
    if (owner !== null && !same(owner, request.owner)) {
      throw new Error('This workspace is already preparing an update with another workspace')
    }
    if (request.kind === 'cancel') {
      owner = null
      return
    }
    owner = request.owner
    preparation ??= deps.prepare().catch((error: unknown) => {
      preparation = null
      throw error
    })
    await preparation
    if (request.kind === 'prepare') return
    if (request.kind === 'install') {
      if (!deps.ready()) throw new Error('The chosen workspace no longer has the update ready')
      deps.remember(request.version, request.folders)
      installChosen = true
    }
    quit()
  }

  async function perform(installer: UpdateWorkspaceId, version: string): Promise<void> {
    const peers = await participants()
    const chosen = peers.find((peer) => same(peer, installer))
    if (chosen === undefined || !chosen.ready) {
      throw new Error('The workspace with the downloaded update could not be reached')
    }
    try {
      await Promise.all(peers.map((peer) => call(peer, { kind: 'prepare', owner: deps.self })))
      const folders = [
        chosen.folder,
        ...peers.filter((peer) => !same(peer, chosen)).map((peer) => peer.folder),
      ]
      for (const peer of peers) {
        if (!same(peer, deps.self) && !same(peer, chosen)) {
          await call(peer, { kind: 'quit', owner: deps.self })
        }
      }
      installRequested = true
      try {
        await call(chosen, { kind: 'install', owner: deps.self, version, folders })
      } catch (error) {
        if (!(error as { updateRequestSent?: boolean }).updateRequestSent) {
          installRequested = false
          throw error
        }
        // The installer may already be waiting for this owner to exit.
        deps.report(error)
      }
      if (!same(chosen, deps.self)) quit()
    } catch (error) {
      if (!installRequested) {
        await Promise.allSettled(
          peers.map((peer) => call(peer, { kind: 'cancel', owner: deps.self })),
        )
      }
      throw error
    }
  }

  return {
    details,
    holdsQuit: () => owner !== null && !quitChosen,
    receive,
    plan: participants,
    restart: async (version: string): Promise<void> => {
      const peers = await participants()
      const active = peers.find((peer) => peer.owner !== null)?.owner
      if (active && peers.some((peer) => peer.owner !== null && !same(peer.owner, active))) {
        throw new Error('The running workspaces disagree about which update is in progress')
      }
      const leader =
        active === undefined || active === null
          ? [...peers].sort(
              (a, b) => a.startedAt - b.startedAt || a.folder.localeCompare(b.folder),
            )[0]!
          : peers.find((peer) => same(peer, active))
      if (leader === undefined)
        throw new Error('The workspace preparing the update is no longer reachable')
      await call(leader, { kind: 'update', installer: deps.self, version })
    },
    finishQuit: (): boolean => {
      if (!installChosen) return false
      if (!installed) {
        installed = true
        deps.install()
      }
      return true
    },
  }
}
