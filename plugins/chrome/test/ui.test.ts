import fs from 'node:fs'
import vm from 'node:vm'
import { expect, it } from 'vitest'
function screen() {
  class Element {
    textContent = ''
    dataset: Record<string, string> = {}
    get childElementCount() {
      return this.children.length
    }
    children: Element[] = []
    listeners = new Map<string, (event: unknown) => void>()
    value = 'fern'
    append(...nodes: Element[]) {
      this.children.push(...nodes)
    }
    prepend(...nodes: Element[]) {
      this.children.unshift(...nodes)
    }
    replaceChildren(...nodes: Element[]) {
      this.children = nodes
    }
    addEventListener(type: string, callback: (event: unknown) => void) {
      this.listeners.set(type, callback)
    }
    checkValidity() {
      return true
    }
    focus() {}
    select() {}
  }
  const nodes = new Map(
    ['#status', '#profiles', '#tabs', '#create', '#name'].map((id) => [id, new Element()]),
  )
  const events = new Map<string, (event: unknown) => void>()
  const packets: Record<string, unknown>[] = []
  const origin = 'brocrew-plugin://fictional-view'
  let interval = () => {}
  const window = {
    addEventListener: (type: string, callback: (event: unknown) => void) =>
      events.set(type, callback),
    postMessage: (packet: Record<string, unknown>, target: string) => {
      expect(target).toBe(origin)
      packets.push(packet)
    },
  }
  vm.runInNewContext(
    fs.readFileSync('plugins/shared/ui/settings-load-state.js', 'utf8') +
      '\n' +
      fs.readFileSync('plugins/chrome/ui/app.js', 'utf8'),
    {
      window,
      location: { origin },
      document: {
        querySelector: (id: string) => nodes.get(id),
        querySelectorAll: () => [nodes.get('#profiles'), nodes.get('#create')],
        createElement: () => new Element(),
      },
      setTimeout: () => 1,
      clearTimeout() {},
      setInterval: (callback: () => void) => {
        interval = callback
        return 1
      },
      clearInterval() {},
      CSS: { escape: (value: string) => value },
    },
  )
  return {
    nodes,
    events,
    packets,
    tick: () => interval(),
    reply(result: unknown, source: unknown = window, packet = packets[0], ok = true) {
      events.get('message')!({
        source,
        origin,
        data: {
          channel: 'brocrew-plugin-ui:v1',
          requestId: packet.requestId,
          ok,
          data: result,
        },
      })
    },
  }
}
it('uses only bounded DOM RPC, displays current windows/tabs as text, and proposes opening without a login state', async () => {
  const view = screen()
  expect(view.packets).toEqual([
    {
      channel: 'brocrew-plugin-ui:v1',
      requestId: '1',
      method: 'read',
      payload: { surface: 'chrome' },
      configRevision: 0,
    },
  ])
  const snapshot = {
    configRevision: 3,
    profiles: [{ name: 'fern', enabled: true, open: true }],
    tabs: [
      { profile: 'fern', title: '<script>fictional</script>', url: 'https://fictional.invalid/' },
    ],
  }
  view.reply(snapshot, {})
  await Promise.resolve()
  expect(view.nodes.get('#profiles')!.children).toHaveLength(0)
  view.reply(snapshot)
  await settle()
  const row = view.nodes.get('#profiles')!.children[0]
  expect(row.dataset.profile).toBe('fern')
  const heading = row.children[0]
  expect(heading.children.slice(0, 2).map((child) => child.textContent)).toEqual(['fern', 'Open'])
  const actions = heading.children[2]
  expect(actions.children.map((child) => child.textContent)).toEqual([
    'On',
    'Open window',
    'Rename',
    'Delete',
  ])
  expect(actions.children[0]).toMatchObject({
    role: 'switch',
    ariaChecked: 'true',
    ariaLabel: 'fern: on',
  })
  const details = row.children[1]
  expect(details.children[0].textContent).toBe('Open tabs')
  const tab = details.children[1].children[0]
  expect(tab.children.map((child) => child.textContent)).toEqual([
    '<script>fictional</script>',
    'https://fictional.invalid/',
  ])
  actions.children[1].listeners.get('click')!({})
  expect(view.packets.at(-1)).toEqual({
    channel: 'brocrew-plugin-ui:v1',
    requestId: '2',
    method: 'proposeConfig',
    payload: { action: 'open-window', profile: 'fern' },
    configRevision: 3,
  })
  expect(view.packets.every((packet) => !JSON.stringify(packet).includes('Token'))).toBe(true)
  view.events.get('pagehide')!({})
})
it('offers "Turn on" for the BroCrew helper only where the person turned it off', async () => {
  const view = screen()
  view.reply({
    configRevision: 1,
    profiles: [
      { name: 'fern', enabled: true, open: true, helperOff: true },
      { name: 'willow', enabled: true, open: true, helperOff: false },
      { name: 'aspen', enabled: false, open: false, helperOff: true },
      { name: 'birch', enabled: true, open: false },
    ],
    tabs: [],
  })
  await settle()
  const [fern, willow, aspen, birch] = view.nodes.get('#profiles')!.children
  expect(fern.children).toHaveLength(2)
  const line = fern.children[1]
  expect(line.children.map((child) => child.textContent)).toEqual(['Helper off.', 'Turn on'])
  for (const row of [willow, aspen, birch]) expect(row.children).toHaveLength(1)
  line.children[1].listeners.get('click')!({})
  expect(view.packets.at(-1)).toMatchObject({
    method: 'proposeConfig',
    payload: { action: 'helper-on', profile: 'fern' },
    configRevision: 1,
  })
  view.events.get('pagehide')!({})
})
it('shows the reviewed empty-profile message', async () => {
  const view = screen()
  view.reply({ configRevision: 0, profiles: [], tabs: [] })
  await settle()
  expect(view.nodes.get('#profiles')!.children[0].textContent).toBe(
    'No profiles yet. Create one to get started.',
  )
})
it('names the profile and deleted data before the person confirms, and Cancel sends no proposal', async () => {
  const { view } = await profileView({ configRevision: 3 })
  view.nodes
    .get('#profiles')!
    .children[0].children[0].children[2].children[3].listeners.get('click')!({})
  const confirmation = view.nodes.get('#profiles')!.children[0].children[1]
  expect(confirmation.children[0].textContent).toBe(
    'Delete “fern”? This removes its browsing data, cookies, sign-ins and profile downloads. Agents can no longer use it.',
  )
  expect(view.packets).toHaveLength(1)
  confirmation.children[1].listeners.get('click')!({})
  expect(view.nodes.get('#profiles')!.children[0].children).toHaveLength(1)
  expect(view.packets).toHaveLength(1)
  view.events.get('pagehide')!({})
})
it('sends only the confirmed person proposal and keeps a plain retry message on refusal', async () => {
  const { view, snapshot } = await profileView({ configRevision: 3, open: true })
  view.nodes
    .get('#profiles')!
    .children[0].children[0].children[2].children[3].listeners.get('click')!({})
  const confirmation = view.nodes.get('#profiles')!.children[0].children[1]
  confirmation.children[2].listeners.get('click')!({})
  const proposal = view.packets.at(-1)!
  expect(proposal).toMatchObject({
    method: 'proposeConfig',
    payload: { action: 'delete-profile', profile: 'fern', confirm: 'fern' },
    configRevision: 3,
  })
  view.reply(undefined, undefined, proposal, false)
  await settle()
  expect(view.packets.at(-1)?.method).toBe('read')
  view.reply(snapshot, undefined, view.packets.at(-1))
  await settle()
  const refusal = view.nodes.get('#profiles')!.children[0].children[1]
  expect(refusal.children.at(-1)!.textContent).toContain(
    'Turn it off and wait for agent work to finish',
  )
  expect(view.packets.filter((p) => p.method === 'proposeConfig')).toHaveLength(1)
  view.events.get('pagehide')!({})
})

it.each([true, false])(
  'explains a failed delete using the actual enabled transition: %s',
  async (wasEnabled) => {
    const view = screen()
    view.reply({
      configRevision: 3,
      profiles: [{ name: 'fern', enabled: wasEnabled, open: false }],
      tabs: [],
    })
    await settle()
    view.nodes
      .get('#profiles')!
      .children[0].children[0].children[2].children[3].listeners.get('click')!({})
    view.nodes.get('#profiles')!.children[0].children[1].children[2].listeners.get('click')!({})
    view.reply(undefined, undefined, view.packets.at(-1), false)
    await settle()
    expect(view.packets.at(-1)?.method).toBe('read')
    view.reply(
      { configRevision: 4, profiles: [{ name: 'fern', enabled: false, open: false }], tabs: [] },
      undefined,
      view.packets.at(-1),
    )
    await settle()
    const confirmation = view.nodes.get('#profiles')!.children[0].children[1]
    expect(confirmation.children.at(-1)?.textContent).toBe(
      wasEnabled
        ? 'Couldn’t remove all of this profile’s data; it’s turned off. Try again.'
        : 'Couldn’t delete this profile. It’s turned off. Wait for agent work to finish, then try again.',
    )
    expect(
      view.nodes.get('#profiles')!.children[0].children[0].children[2].children[0],
    ).toMatchObject({ textContent: 'On', role: 'switch', ariaChecked: 'false' })
    expect(view.packets.filter((packet) => packet.method === 'proposeConfig')).toHaveLength(1)
    expect(confirmation.children[2].textContent).toBe('Try again')
    view.events.get('pagehide')!({})
  },
)

it.each([true, false])(
  'clears the created profile name only after a successful reply (success=%s)',
  async (success) => {
    const view = screen()
    view.reply({ configRevision: 1, profiles: [], tabs: [] })
    await settle()
    const input = view.nodes.get('#name')!
    input.value = 'fern'
    view.nodes.get('#create')!.listeners.get('submit')!({ preventDefault() {} })
    const create = view.packets.at(-1)!
    expect(create.payload).toEqual({ action: 'create-profile', profile: 'fern' })
    expect(input.value).toBe('fern')
    view.reply(undefined, undefined, create, success)
    await settle()
    expect(input.value).toBe(success ? '' : 'fern')
    if (success) {
      expect(view.packets.at(-1)?.method).toBe('read')
      // A follow-up refresh failure does not undo an acknowledged creation.
      view.reply(undefined, undefined, view.packets.at(-1), false)
      await settle()
      expect(input.value).toBe('')
    }
    view.events.get('pagehide')!({})
  },
)

type Drawn = {
  textContent: string
  className?: string
  hidden?: boolean
  disabled?: boolean
  value?: string
  children: Drawn[]
  listeners: Map<string, (event: unknown) => void>
}
async function profileView({ configRevision = 1, enabled = true, open = false } = {}) {
  const view = screen()
  const snapshot = {
    configRevision,
    profiles: [{ name: 'fern', enabled, open }],
    tabs: [],
  }
  view.reply(snapshot)
  await settle()
  const row = () => view.nodes.get('#profiles')!.children[0] as unknown as Drawn
  return { view, snapshot, row }
}

const words = (node: Drawn): string[] => [node.textContent, ...node.children.flatMap(words)]
async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

it('keeps the plain sharing warning on a folded card and never shows a migration code', async () => {
  const view = screen()
  view.reply({
    configRevision: 2,
    profiles: [
      { name: 'fern', enabled: true, open: false, migration: 'chrome-unknown' },
      { name: 'willow', enabled: true, open: false, migration: 'folder-identity-conflict' },
    ],
    tabs: [{ profile: 'fern', title: 'Fictional', url: 'https://fictional.invalid/' }],
  })
  await settle()
  const [fern, willow] = view.nodes.get('#profiles')!.children as unknown as Drawn[]
  expect(fern.children[1]).toMatchObject({
    className: 'profile-notice',
    textContent:
      "This profile is still only in this workspace because Chrome couldn't be checked. You can keep using it here. We'll try to share it again next time the plugin starts.",
  })
  expect(fern.children.at(-1)).toMatchObject({ className: 'profile-details', hidden: true })
  expect(words(willow)).toContain(
    'This profile is still only in this workspace. You can keep using it here.',
  )
  for (const row of [fern, willow]) {
    expect(words(row).join(' ')).not.toContain('chrome-unknown')
    expect(words(row).join(' ')).not.toContain('folder-identity-conflict')
  }
  view.events.get('pagehide')!({})
})

it('checks a new profile name with the approved words before the person proposes it', async () => {
  const view = screen()
  const snapshot = {
    configRevision: 5,
    profiles: [
      { name: 'fern', displayName: 'Work', enabled: true, open: false },
      { name: 'willow', enabled: true, open: false },
    ],
    tabs: [],
  }
  view.reply(snapshot)
  await settle()
  const rows = () => view.nodes.get('#profiles')!.children as unknown as Drawn[]
  expect(
    rows()[0]
      .children[0].children.slice(0, 2)
      .map((child) => child.textContent),
  ).toEqual(['Work', 'fern'])
  rows()[1].children[0].children[2].children[2].listeners.get('click')!({})
  const form = () => rows()[1].children[1]
  const input = form().children[0]
  expect(input.value).toBe('willow')
  const save = async (value: string) => {
    input.value = value
    form().listeners.get('submit')!({ preventDefault() {} })
    await settle()
    return form().children[3]?.textContent
  }
  expect(await save('   ')).toBe('Profile name must be 1–60 characters.')
  expect(await save('x'.repeat(61))).toBe('Profile name must be 1–60 characters.')
  expect(await save(' work ')).toBe('Another profile already uses that name.')
  expect(view.packets).toHaveLength(1)
  await save(` ${'🌿'.repeat(60)} `)
  const proposal = view.packets.at(-1)!
  expect(proposal).toMatchObject({
    method: 'proposeConfig',
    payload: { action: 'rename-profile', profile: 'willow', newName: '🌿'.repeat(60) },
    configRevision: 5,
  })
  view.reply(undefined, undefined, proposal, false)
  await settle()
  expect(view.packets.at(-1)?.method).toBe('read')
  view.reply(
    {
      ...snapshot,
      profiles: [snapshot.profiles[0], { ...snapshot.profiles[1], status: 'deleting' }],
    },
    undefined,
    view.packets.at(-1),
  )
  await settle()
  expect(form().children[3].textContent).toBe(
    'This profile is being deleted. Try again after deletion finishes.',
  )
  expect(form().children[1].disabled).toBe(true)
  expect(rows()[1].children[0].children[2].children[2].disabled).toBe(true)
  expect(view.packets.filter((packet) => packet.method === 'proposeConfig')).toHaveLength(1)
  view.events.get('pagehide')!({})
})

it('closes the rename field on Escape without proposing anything', async () => {
  const { view, row } = await profileView()
  row().children[0].children[2].children[2].listeners.get('click')!({})
  expect(row().children[1].className).toBe('profile-rename')
  row().children[1].children[0].listeners.get('keydown')!({ key: 'Escape' })
  expect(row().children).toHaveLength(1)
  expect(view.packets).toHaveLength(1)
  view.events.get('pagehide')!({})
})

it('holds a read that arrives mid-composition and draws it once the word is finished', async () => {
  const { view, snapshot, row } = await profileView()
  row().children[0].children[2].children[2].listeners.get('click')!({})
  const form = row().children[1]
  const input = form.children[0]
  view.tick()
  const read = view.packets.at(-1)!
  expect(read.method).toBe('read')
  input.listeners.get('compositionstart')!({})
  view.reply({ ...snapshot, profiles: [{ ...snapshot.profiles[0], open: true }] }, undefined, read)
  await settle()
  expect(row().children[1]).toBe(form)
  expect(row().children[0].children[1].textContent).toBe('Closed')
  view.tick()
  expect(view.packets.at(-1)).toBe(read)
  input.listeners.get('compositionend')!({})
  expect(row().children[0].children[1].textContent).toBe('Open')
  expect(row().children[1].children[0]).toBe(input)
  view.events.get('pagehide')!({})
})

it('holds the redraw after a refused rename while the person is composing a word', async () => {
  const { view, snapshot, row } = await profileView()
  row().children[0].children[2].children[2].listeners.get('click')!({})
  const input = row().children[1].children[0]
  input.value = 'Garden'
  row().children[1].listeners.get('submit')!({ preventDefault() {} })
  const form = row().children[1]
  input.listeners.get('compositionstart')!({})
  view.reply(undefined, undefined, view.packets.at(-1), false)
  await settle()
  expect(view.packets.at(-1)?.method).toBe('read')
  view.reply(snapshot, undefined, view.packets.at(-1))
  await settle()
  await settle()
  expect(row().children[1]).toBe(form)
  expect(form.children).toHaveLength(3)
  input.listeners.get('compositionend')!({})
  expect(row().children[1].children[0]).toBe(input)
  expect(row().children[1].children[3].textContent).toBe('Plugin unavailable. Try again.')
  view.events.get('pagehide')!({})
})

it('turns a profile on here with one switch press, shows it busy, and puts it back on a refusal', async () => {
  const view = screen()
  const snapshot = {
    configRevision: 2,
    profiles: [
      { name: 'fern', displayName: 'Work', shared: true, enabled: false, open: false },
      { name: 'willow', enabled: true, open: false },
    ],
    tabs: [],
  }
  view.reply(snapshot)
  await settle()
  const control = (index: number) =>
    (view.nodes.get('#profiles')!.children as unknown as Drawn[])[index].children[0].children.find(
      (child) => child.className === 'profile-actions',
    )!.children[0] as Drawn & Record<string, unknown>
  expect(control(0)).toMatchObject({
    textContent: 'On here',
    role: 'switch',
    ariaChecked: 'false',
    ariaLabel: 'Work: on here',
  })
  expect(control(0).ariaBusy).toBeUndefined()
  expect(control(1)).toMatchObject({
    textContent: 'On',
    ariaChecked: 'true',
    ariaLabel: 'willow: on',
  })
  control(0).listeners.get('click')!({})
  const proposal = view.packets.at(-1)!
  expect(proposal).toMatchObject({
    method: 'proposeConfig',
    payload: { action: 'set-enabled', profile: 'fern', enabled: true },
    configRevision: 2,
  })
  expect(control(0)).toMatchObject({ ariaChecked: 'true', ariaBusy: 'true', ariaDisabled: 'true' })
  control(0).listeners.get('click')!({})
  view.tick()
  expect(view.packets.filter((packet) => packet.method === 'proposeConfig')).toHaveLength(1)
  expect(view.packets.at(-1)).toBe(proposal)
  view.reply(undefined, undefined, proposal, false)
  await settle()
  expect(control(0)).toMatchObject({ ariaChecked: 'false' })
  expect(control(0).ariaBusy).toBeUndefined()
  expect(view.nodes.get('#status')!.textContent).toBe('Plugin unavailable. Try again.')
  control(0).listeners.get('click')!({})
  const retry = view.packets.at(-1)!
  expect(retry.payload).toEqual({ action: 'set-enabled', profile: 'fern', enabled: true })
  view.reply(undefined, undefined, retry)
  await settle()
  expect(view.packets.at(-1)?.method).toBe('read')
  view.reply(
    { ...snapshot, profiles: [{ ...snapshot.profiles[0], enabled: true }, snapshot.profiles[1]] },
    undefined,
    view.packets.at(-1),
  )
  await settle()
  expect(control(0)).toMatchObject({ ariaChecked: 'true' })
  expect(control(0).ariaBusy).toBeUndefined()
  view.events.get('pagehide')!({})
})

it('holds the switch put-back after a refusal while the person is composing a name', async () => {
  const { view, row } = await profileView()
  const control = () => row().children[0].children[2].children[0] as Drawn & Record<string, unknown>
  control().listeners.get('click')!({})
  const proposal = view.packets.at(-1)!
  row().children[0].children[2].children[2].listeners.get('click')!({})
  const input = row().children[1].children[0]
  input.listeners.get('compositionstart')!({})
  view.reply(undefined, undefined, proposal, false)
  await settle()
  expect(row().children[1].children[0]).toBe(input)
  expect(control()).toMatchObject({ ariaChecked: 'false', ariaBusy: 'true' })
  expect(view.nodes.get('#status')!.textContent).toBe('Plugin unavailable. Try again.')
  input.listeners.get('compositionend')!({})
  expect(row().children[1].children[0]).toBe(input)
  expect(control()).toMatchObject({ ariaChecked: 'true' })
  expect(control().ariaBusy).toBeUndefined()
  expect(view.nodes.get('#status')!.textContent).toBe('Plugin unavailable. Try again.')
  view.events.get('pagehide')!({})
})

it('keeps an accepted switch change on every redraw when the read after it fails', async () => {
  const { view, row } = await profileView({ enabled: false })
  const control = () => row().children[0].children[2].children[0] as Drawn & Record<string, unknown>
  control().listeners.get('click')!({})
  view.reply(undefined, undefined, view.packets.at(-1))
  await settle()
  const read = view.packets.at(-1)!
  expect(read.method).toBe('read')
  expect(control()).toMatchObject({ ariaChecked: 'true' })
  expect(control().ariaBusy).toBeUndefined()
  view.reply(undefined, undefined, read, false)
  await settle()
  expect(view.nodes.get('#status')!.textContent).toBe('Plugin unavailable. Try again.')
  row().children[0].children[2].children[2].listeners.get('click')!({})
  expect(row().children[1].className).toBe('profile-rename')
  expect(control()).toMatchObject({ ariaChecked: 'true' })
  expect(control().ariaBusy).toBeUndefined()
  control().listeners.get('click')!({})
  expect(view.packets.at(-1)).toMatchObject({
    method: 'proposeConfig',
    payload: { action: 'set-enabled', profile: 'fern', enabled: false },
  })
  view.events.get('pagehide')!({})
})

it('lets a later read that lands before the switch is accepted keep its own state', async () => {
  const { view, snapshot, row } = await profileView({ enabled: false })
  const control = () => row().children[0].children[2].children[0] as Drawn & Record<string, unknown>
  control().listeners.get('click')!({})
  const proposal = view.packets.at(-1)!
  row().children[0].children[2].children[2].listeners.get('click')!({})
  row().children[1].children[0].value = 'Garden'
  row().children[1].listeners.get('submit')!({ preventDefault() {} })
  view.reply(undefined, undefined, view.packets.at(-1), false)
  await settle()
  const reread = view.packets.at(-1)!
  expect(reread.method).toBe('read')
  view.reply({ ...snapshot, configRevision: 2 }, undefined, reread)
  await settle()
  expect(control()).toMatchObject({ ariaChecked: 'true', ariaBusy: 'true' })
  view.reply(undefined, undefined, proposal)
  await settle()
  expect(control()).toMatchObject({ ariaChecked: 'false' })
  expect(control().ariaBusy).toBeUndefined()
  expect(view.packets.at(-1)?.method).toBe('read')
  view.events.get('pagehide')!({})
})
