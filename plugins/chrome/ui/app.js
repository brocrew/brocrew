const channel = 'brocrew-plugin-ui:v1'
const pending = new Map()
let revision = 0
let next = 0
let closed = false
let deleting = null
let deletionError = ''
let deletionPending = false
let lastSnapshot = null
// Cards the person opened; every redraw keeps them open.
const expanded = new Set()
const status = document.querySelector('#status')
function say(words, tone) {
  status.textContent = words
  status.dataset.tone = tone
}
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
async function propose(payload, afterSuccess) {
  try {
    await rpc('proposeConfig', payload)
    afterSuccess?.()
    await refresh()
  } catch {
    say('Plugin unavailable. Try again.', 'warn')
  }
}
// The page redraws every refresh, so each control carries a key that lets focus come back to it.
function focusKey(node, key) {
  node.dataset.focus = key
  return node
}
function action(label, payload) {
  const button = focusKey(text('button', label), `${payload.action}:${payload.profile}`)
  button.addEventListener('click', () => propose(payload))
  return button
}
function checkbox(label, checked, key, onChange) {
  const control = text('label', label)
  control.className = 'check'
  const box = focusKey(document.createElement('input'), key)
  box.type = 'checkbox'
  box.checked = checked
  box.addEventListener('change', () => onChange(box.checked))
  control.prepend(box)
  return control
}
function stateTone(profile) {
  if (profile.status === 'deleting' || profile.status === 'moving') return 'warn'
  return profile.inUseIn || profile.open ? 'live' : 'idle'
}
async function confirmDelete(profile, displayedConfirmation, shared) {
  if (deletionPending) return
  const wasEnabled = lastSnapshot.profiles.find((value) => value.name === profile)?.enabled === true
  deletionPending = true
  deletionError = ''
  draw(lastSnapshot)
  try {
    await rpc('proposeConfig', {
      action: 'delete-profile',
      profile,
      confirm: profile,
      ...(shared ? { deleteConfirmation: displayedConfirmation } : {}),
    })
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
  say('Running', 'live')
  const focused = document.activeElement?.dataset?.focus
  const profiles = document.querySelector('#profiles')
  profiles.replaceChildren()
  for (const profile of snapshot.profiles.slice(0, 128)) {
    if (!/^[a-z0-9-]{1,32}$/.test(profile.name)) continue
    const row = document.createElement('article')
    row.dataset.profile = profile.name
    if (!profile.enabled) row.dataset.off = 'true'
    const details = document.createElement('div')
    details.className = 'profile-details'
    if (profile.shared) {
      const settings = document.createElement('fieldset')
      settings.append(text('legend', 'Applies to this profile in every workspace'))
      for (const [flag, label] of [
        ['allowSync', 'Allow sync'],
        ['allowExtensions', 'Allow extensions'],
        ['allowSettings', 'Allow settings'],
      ])
        settings.append(
          checkbox(label, profile[flag] === true, `${flag}:${profile.name}`, (checked) =>
            propose({ action: 'set-flags', profile: profile.name, [flag]: checked }),
          ),
        )
      details.append(
        settings,
        checkbox(
          'Keep running here. While on, workspaces with a separate Chrome setup cannot use this profile.',
          profile.keepRunning === true,
          `keepRunning:${profile.name}`,
          (checked) =>
            propose({ action: 'set-flags', profile: profile.name, keepRunning: checked }),
        ),
      )
      const notes = document.createElement('div')
      notes.className = 'profile-notes'
      notes.append(
        text(
          'p',
          'Workspaces using the default Chrome setup share these switches. Workspaces with their own Chrome setup have separate switches.',
        ),
      )
      if (profile.migratedFrom && profile.migratedFrom !== profile.name)
        notes.append(text('p', `Renamed from ${profile.migratedFrom}.`))
      if (profile.appliesAtNextLaunch)
        notes.append(
          text(
            'p',
            'Launch settings apply when this profile next starts. Revoked agent access applies to new work immediately.',
          ),
        )
      details.append(notes)
    } else if (profile.migration)
      details.append(
        text(
          'p',
          profile.migration === 'qualification-required'
            ? 'Sharing awaits migration qualification.'
            : `Profile migration: ${profile.migration}.`,
        ),
      )
    const tabs = document.createElement('ul')
    tabs.className = 'profile-tabs'
    for (const tab of snapshot.tabs.slice(0, 200)) {
      if (tab.profile !== profile.name) continue
      const item = document.createElement('li')
      const title = text('span', String(tab.title).slice(0, 512))
      title.className = 'tab-title'
      const url = text('span', String(tab.url).slice(0, 2048))
      url.className = 'tab-url'
      item.title = `${title.textContent}\n${url.textContent}`
      item.append(title, url)
      tabs.append(item)
    }
    const tabCount = tabs.childElementCount
    if (tabCount) details.append(text('h2', 'Open tabs'), tabs)
    const heading = document.createElement('header')
    heading.className = 'profile-heading'
    // A card with nothing to fold shows its name; any other card folds on its name.
    let name
    if (details.childElementCount) {
      const open = expanded.has(profile.name)
      name = focusKey(text('button', profile.name), `toggle:${profile.name}`)
      name.className = 'profile-toggle'
      name.ariaExpanded = String(open)
      name.addEventListener('click', () => {
        if (expanded.has(profile.name)) expanded.delete(profile.name)
        else expanded.add(profile.name)
        draw(lastSnapshot)
      })
      details.hidden = !open
    } else {
      name = text('strong', profile.name)
      name.className = 'profile-name'
    }
    const state = text(
      'span',
      profile.inUseIn
        ? `In use in ${profile.inUseIn}`
        : profile.status === 'deleting'
          ? 'Deletion incomplete; name reserved'
          : profile.status === 'moving'
            ? 'Migration pending'
            : profile.open
              ? 'Open'
              : 'Closed',
    )
    state.className = 'profile-state'
    state.dataset.tone = stateTone(profile)
    const actions = document.createElement('div')
    actions.className = 'profile-actions'
    const openWindow = action('Open window', { action: 'open-window', profile: profile.name })
    openWindow.className = 'primary'
    actions.append(
      action(
        profile.shared
          ? profile.enabled
            ? 'Switch off here'
            : 'Switch on here'
          : profile.enabled
            ? 'Disable'
            : 'Enable',
        {
          action: 'set-enabled',
          profile: profile.name,
          enabled: !profile.enabled,
        },
      ),
      openWindow,
    )
    const remove = focusKey(text('button', 'Delete'), `delete:${profile.name}`)
    remove.className = 'quiet-danger'
    remove.addEventListener('click', () => {
      if (deletionPending) return
      deleting = profile.name
      deletionError = ''
      draw(lastSnapshot)
    })
    actions.append(remove)
    heading.append(name, state, actions)
    const summary = [
      ...(profile.shared ? [`On in ${(profile.onIn ?? []).join(', ') || 'no workspaces'}`] : []),
      ...(tabCount ? [tabCount === 1 ? '1 open tab' : `${tabCount} open tabs`] : []),
    ]
    if (summary.length) {
      const line = text('p', summary.join(' · '))
      line.className = 'profile-summary'
      heading.append(line)
    }
    row.append(heading)
    if (profile.enabled && profile.helperOff === true) {
      const helper = document.createElement('p')
      helper.className = 'profile-helper'
      helper.append(
        text('span', 'Helper off.'),
        action('Turn on', { action: 'helper-on', profile: profile.name }),
      )
      row.append(helper)
    }
    if (deleting === profile.name) {
      const confirmation = document.createElement('section')
      confirmation.className = 'profile-delete-confirmation'
      confirmation.append(
        text(
          'p',
          profile.shared
            ? `Delete “${profile.name}” for every workspace? It is on in ${(profile.onIn ?? []).join(', ') || 'no workspaces'}. This removes its Chrome data, sign-ins and history. This cannot be undone.`
            : `Delete “${profile.name}”? This removes its browsing data, cookies, sign-ins and profile downloads. Agents can no longer use it.`,
        ),
      )
      const cancel = focusKey(text('button', 'Cancel'), `cancel-delete:${profile.name}`)
      cancel.disabled = deletionPending
      cancel.addEventListener('click', () => {
        if (deletionPending) return
        deleting = null
        deletionError = ''
        draw(lastSnapshot)
      })
      const confirm = focusKey(
        text(
          'button',
          deletionPending ? 'Deleting…' : deletionError ? 'Try again' : 'Delete profile',
        ),
        `confirm-delete:${profile.name}`,
      )
      confirm.className = 'danger'
      confirm.disabled = deletionPending
      confirm.addEventListener(
        'click',
        () => void confirmDelete(profile.name, profile.deleteConfirmation, profile.shared === true),
      )
      confirmation.append(cancel, confirm)
      if (deletionError) confirmation.append(text('p', deletionError))
      row.append(confirmation)
    }
    if (details.childElementCount) row.append(details)
    profiles.append(row)
  }
  if (snapshot.profiles.length === 0) {
    const empty = text('p', 'No profiles yet. Create one to get started.')
    empty.className = 'profiles-empty'
    profiles.append(empty)
  }
  if (focused) profiles.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus()
}
async function refresh() {
  try {
    draw(await rpc('read', { surface: 'chrome' }))
  } catch {
    say('Plugin unavailable. Try again.', 'warn')
  }
}
document.querySelector('#create').addEventListener('submit', (event) => {
  event.preventDefault()
  const input = document.querySelector('#name')
  if (input.checkValidity())
    void propose({ action: 'create-profile', profile: input.value }, () => {
      input.value = ''
    })
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
