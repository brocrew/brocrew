window.settingsLoadState = (() => {
  const status = document.querySelector('#status')
  const content = document.querySelectorAll('[data-settings-content]')
  let ready = false
  let closed = false
  window.addEventListener('pagehide', () => (closed = true))
  function settled() {
    status.ariaBusy = 'false'
  }
  return {
    ready() {
      if (closed) return
      settled()
      if (ready) return
      ready = true
      for (const node of content) node.hidden = false
    },
    fail() {
      if (closed) return
      settled()
      status.textContent = 'Plugin unavailable. Try again.'
      status.dataset.tone = 'warn'
    },
  }
})()
