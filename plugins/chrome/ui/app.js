const channel = 'brocrew-plugin-ui:v1'
const pending = new Map()
let revision = 0
let next = 0
let closed = false
let deleting = null
let deletionError = ''
let deletionPending = false
let lastSnapshot = null
const status = document.querySelector('#status')
function rpc(method, payload) {
  if (pending.size >= 4 || closed) return Promise.reject(new Error('busy'))
  const requestId = String(++next)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('timeout'))
    }, 10000)
    pending.set(requestId, { resolve, reject, timer })
    window.postMessage(
      { channel, requestId, method, payload, configRevision: revision },
      location.origin,
    )
  })
}
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return
  const packet = event.data
  if (!packet || packet.channel !== channel || typeof packet.ok !== 'boolean') return
  const request = pending.get(packet.requestId)
  if (!request) return
  clearTimeout(request.timer)
  pending.delete(packet.requestId)
  if (!packet.ok) request.reject(new Error('unavailable'))
  else request.resolve(packet.data)
})
function text(tag, value) {
  const node = document.createElement(tag)
  node.textContent = value
  return node
}
async function propose(payload) {
  try {
    await rpc('proposeConfig', payload)
    await refresh()
  } catch {
    status.textContent = 'Plugin unavailable. Try again.'
  }
}
function action(label, payload) {
  const button = text('button', label)
  button.addEventListener('click', () => propose(payload))
  return button
}
async function confirmDelete(profile) {
  if (deletionPending) return
  const wasEnabled = lastSnapshot.profiles.find((value) => value.name === profile)?.enabled === true
  deletionPending = true
  deletionError = ''
  draw(lastSnapshot)
  try {
    await rpc('proposeConfig', { action: 'delete-profile', profile, confirm: profile })
    deleting = null
    await refresh()
  } catch {
    deletionError =
      'Couldn’t delete this profile. Turn it off and wait for agent work to finish, then try again.'
    try {
      const snapshot = await rpc('read', { surface: 'chrome' })
      draw(snapshot)
      const retained = snapshot.profiles.find((value) => value.name === profile)
      if (!retained) deleting = null
      else if (retained.enabled === false)
        deletionError = wasEnabled
          ? 'Couldn’t remove all of this profile’s data; it’s turned off. Try again.'
          : 'Couldn’t delete this profile. It’s turned off. Wait for agent work to finish, then try again.'
    } catch {
      // Keep the refusal and the last known state when the fresh read is unavailable.
    }
  } finally {
    deletionPending = false
    if (lastSnapshot) draw(lastSnapshot)
  }
}
function draw(snapshot) {
  if (
    !snapshot ||
    !Number.isSafeInteger(snapshot.configRevision) ||
    !Array.isArray(snapshot.profiles) ||
    !Array.isArray(snapshot.tabs)
  )
    throw new Error('invalid')
  revision = snapshot.configRevision
  lastSnapshot = snapshot
  status.textContent = 'Running'
  const profiles = document.querySelector('#profiles')
  profiles.replaceChildren()
  for (const profile of snapshot.profiles.slice(0, 128)) {
    if (!/^[a-z0-9-]{1,32}$/.test(profile.name)) continue
    const row = document.createElement('article')
    row.dataset.profile = profile.name
    const heading = document.createElement('header')
    heading.className = 'profile-heading'
    const name = text('strong', profile.name)
    name.className = 'profile-name'
    const state = text('span', profile.open ? 'Open' : 'Closed')
    state.className = 'profile-state'
    const actions = document.createElement('div')
    actions.className = 'profile-actions'
    actions.append(
      action(profile.enabled ? 'Disable' : 'Enable', {
        action: 'set-enabled',
        profile: profile.name,
        enabled: !profile.enabled,
      }),
      action('Open window', { action: 'open-window', profile: profile.name }),
    )
    const remove = text('button', 'Delete')
    remove.addEventListener('click', () => {
      if (deletionPending) return
      deleting = profile.name
      deletionError = ''
      draw(lastSnapshot)
    })
    actions.append(remove)
    heading.append(name, state, actions)
    row.append(heading)
    if (deleting === profile.name) {
      const confirmation = document.createElement('section')
      confirmation.className = 'profile-delete-confirmation'
      confirmation.append(
        text(
          'p',
          `Delete “${profile.name}”? This removes its browsing data, cookies, sign-ins and profile downloads. Agents can no longer use it.`,
        ),
      )
      const cancel = text('button', 'Cancel')
      cancel.disabled = deletionPending
      cancel.addEventListener('click', () => {
        if (deletionPending) return
        deleting = null
        deletionError = ''
        draw(lastSnapshot)
      })
      const confirm = text(
        'button',
        deletionPending ? 'Deleting…' : deletionError ? 'Try again' : 'Delete profile',
      )
      confirm.disabled = deletionPending
      confirm.addEventListener('click', () => void confirmDelete(profile.name))
      confirmation.append(cancel, confirm)
      if (deletionError) confirmation.append(text('p', deletionError))
      row.append(confirmation)
    }
    const tabs = document.createElement('ul')
    tabs.className = 'profile-tabs'
    for (const tab of snapshot.tabs.slice(0, 200)) {
      if (tab.profile !== profile.name) continue
      const item = document.createElement('li')
      const title = text('span', String(tab.title).slice(0, 512))
      title.className = 'tab-title'
      const url = text('span', String(tab.url).slice(0, 2048))
      url.className = 'tab-url'
      item.append(title, url)
      tabs.append(item)
    }
    if (tabs.childElementCount) row.append(text('h2', 'Open tabs'), tabs)
    profiles.append(row)
  }
  if (snapshot.profiles.length === 0)
    profiles.append(text('p', 'No profiles yet. Create one to get started.'))
}
async function refresh() {
  try {
    draw(await rpc('read', { surface: 'chrome' }))
  } catch {
    status.textContent = 'Plugin unavailable. Try again.'
  }
}
document.querySelector('#create').addEventListener('submit', (event) => {
  event.preventDefault()
  const input = document.querySelector('#name')
  if (input.checkValidity()) void propose({ action: 'create-profile', profile: input.value })
})
const timer = setInterval(() => {
  if (!closed && pending.size === 0) void refresh()
}, 1500)
window.addEventListener('pagehide', () => {
  closed = true
  clearInterval(timer)
  for (const p of pending.values()) {
    clearTimeout(p.timer)
    p.reject(new Error('closed'))
  }
  pending.clear()
})
void refresh()
