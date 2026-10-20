export interface ClosablePage {
  on(event: 'close', listener: () => void): unknown
}
export interface PagesSource {
  pages(): readonly ClosablePage[]
  on(event: 'page', listener: (page: ClosablePage) => void): unknown
}
export function allPagesClosed(source: PagesSource, settleMs = 300): Promise<'pages-closed'> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (source.pages().length === 0) resolve('pages-closed')
      }, settleMs)
    }
    const watch = (page: ClosablePage): void => {
      page.on('close', check)
    }
    source.pages().forEach(watch)
    source.on('page', watch)
  })
}
