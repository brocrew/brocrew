import fs from 'node:fs'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { FakePage, harness } from './fakes.js'

const fixtures: ReturnType<typeof harness>[] = []
afterEach(async () => {
  for (const h of fixtures.splice(0)) {
    await h.browser.close('fern')
    for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(dir, { recursive: true, force: true })
  }
})

function openingFixture(prepare: (page: FakePage) => void) {
  const h = harness()
  fixtures.push(h)
  h.profile('fern', { enabled: true })
  const newPage = h.browser.newPage.bind(h.browser)
  h.browser.newPage = async (profile, options) => {
    const page = await newPage(profile, options)
    prepare(h.browser.pages.get(profile)!.at(-1)!)
    return page
  }
  const open = async () => {
    const { json } = await h.call('open_tab', {
      profile: 'fern',
      url: 'https://fictional.invalid/page',
    })
    return (json as { tabId: string }).tabId
  }
  return { h, open }
}

it('updates a blank title observed by show_tab while the first navigation was pending', async () => {
  const response = Promise.withResolvers<void>()
  const { h, open } = openingFixture((page) => {
    const goto = page.goto.bind(page)
    page.goto = async (url) => {
      await response.promise
      const result = await goto(url)
      page.emit('framenavigated', page.mainFrame())
      return result
    }
    page.title = async () => (page.url() === 'about:blank' ? '' : 'Loaded title')
  })
  const tabId = await open()
  try {
    expect((await h.call('show_tab', { tabId })).json).toMatchObject({ tabId, title: '' })
  } finally {
    response.resolve()
  }
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect((await h.call('list_tabs', { profile: 'fern' })).json).toMatchObject([
    { tabId, title: 'Loaded title' },
  ])
})

it('keeps the newer blank title after the page reloads at the same URL', async () => {
  const started = Promise.withResolvers<void>()
  const title = Promise.withResolvers<string>()
  const { h, open } = openingFixture((page) => {
    page.title = () => {
      page.title = async () => ''
      started.resolve()
      return title.promise
    }
  })
  const tabId = await open()
  try {
    await started.promise
    const page = h.browser.pages.get('fern')![0]
    page.emit('framenavigated', page.mainFrame())
    expect((await h.call('show_tab', { tabId })).json).toMatchObject({ tabId, title: '' })
  } finally {
    title.resolve('Old title')
  }
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect((await h.call('list_tabs', { profile: 'fern' })).json).toMatchObject([
    { tabId, title: '' },
  ])
})

it.each([true, false])(
  'does not replace the loaded title with a late blank read (commit after the read starts: %s)',
  async (newDocument) => {
    const response = Promise.withResolvers<void>()
    const readingBlank = Promise.withResolvers<void>()
    const blank = Promise.withResolvers<string>()
    const { h, open } = openingFixture((page) => {
      let loaded = false
      const goto = page.goto.bind(page)
      page.goto = async (url) => {
        if (newDocument) await response.promise
        const result = await goto(url)
        page.emit('framenavigated', page.mainFrame())
        if (!newDocument) await response.promise
        loaded = true
        return result
      }
      page.title = () => {
        if (loaded) return Promise.resolve('Loaded title')
        readingBlank.resolve()
        return blank.promise
      }
    })
    const tabId = await open()
    const showing = h.call('show_tab', { tabId })
    try {
      await readingBlank.promise
      response.resolve()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect((await h.call('list_tabs', { profile: 'fern' })).json).toMatchObject([
        { tabId, title: 'Loaded title' },
      ])
    } finally {
      response.resolve()
      blank.resolve('')
      await showing
    }
    expect((await h.call('list_tabs', { profile: 'fern' })).json).toMatchObject([
      { tabId, title: 'Loaded title' },
    ])
  },
)

it('keeps the current title when an overlapping read republishes identical text', async () => {
  const committed = Promise.withResolvers<void>()
  const response = Promise.withResolvers<void>()
  const readingBlank = Promise.withResolvers<void>()
  const blank = Promise.withResolvers<string>()
  const { h, open } = openingFixture((page) => {
    const goto = page.goto.bind(page)
    page.goto = async (url) => {
      const result = await goto(url)
      page.emit('framenavigated', page.mainFrame())
      committed.resolve()
      await response.promise
      return result
    }
    let reads = 0
    page.title = () => {
      if (++reads === 2) {
        readingBlank.resolve()
        return blank.promise
      }
      return Promise.resolve('Loaded title')
    }
  })
  const tabId = await open()
  await committed.promise
  expect((await h.call('show_tab', { tabId })).json).toMatchObject({ title: 'Loaded title' })
  const showing = h.call('show_tab', { tabId })
  try {
    await readingBlank.promise
    response.resolve()
    await new Promise<void>((resolve) => setImmediate(resolve))
  } finally {
    response.resolve()
    blank.resolve('')
    await showing
  }
  expect((await h.call('list_tabs', { profile: 'fern' })).json).toMatchObject([
    { tabId, title: 'Loaded title' },
  ])
})
