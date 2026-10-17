import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NativeImage } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DOCK_ICON_SIZE,
  DOCK_LABEL_BAND_TOP,
  DOCK_LABEL_FILE,
  DOCK_LABEL_FILE_BYTES,
  dockLabelColours,
  dockLabelOf,
  layOutDockLabel,
  paintDockLabel,
  readDockLabelFile,
  startDockLabel,
  carefulWorkspaceName,
  startingColourAmong,
  startingColourFromList,
  WORKSPACE_LIST_BYTES,
  writeDockLabelFile,
  type DockLabelImages,
} from '../src/main/dock-label'
import {
  DOCK_LABEL_COLOURS,
  DOCK_LABEL_MAX,
  defaultDockLabelColour,
  defaultDockLabelColours,
  defaultDockLabelName,
  dockLabelInk,
  dockLabelName,
  isDockLabelChange,
  type DockLabelColour,
  type DockLabelWorkspace,
} from '../src/shared/dock-label'
import { contrastRatio } from '../src/shared/themes/colour'

/**
 * Pipes (`mkfifo`) and symbolic links a test can make: not on Windows, as the other pipe tests in
 * this tree say (`workspace.test.ts`).
 */
const NO_PIPES_OR_LINKS = process.platform === 'win32'

/**
 * A person running several workspaces tells their Dock icons apart by a coloured band along the
 * bottom of each, with the workspace's short name in it. Each workspace keeps its own name and
 * colour; turning the label off gives the plain icon back. Only the icon is ever set, so the
 * Dock's count badge stays, and the band leaves the icon's top-right corner, where the badge sits,
 * as it was.
 */

let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'brocrew-dock-label-'))
})
afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

/** A stand-in for the app's own icon: 512 px of a steady grey-blue, fully opaque. */
const ICON_RGBA = [40, 70, 110, 255] as const

/**
 * A `nativeImage` stand-in. Bitmaps come back as blue-green-red-alpha, as on a Mac (the one-pixel
 * red probe reads so); the icon decodes to {@link ICON_RGBA}; every image made is kept.
 */
function fakeImages() {
  const made: { bitmap: Buffer; scaleFactor?: number }[] = []
  const image = (width: number, height: number, bitmap: Buffer): NativeImage =>
    ({
      isEmpty: () => width === 0,
      getSize: () => ({ width, height }),
      toBitmap: () => bitmap,
      resize: (to: { width: number; height: number }) =>
        image(
          to.width,
          to.height,
          Buffer.concat(Array(to.width * to.height).fill(bitmap.subarray(0, 4))),
        ),
    }) as unknown as NativeImage
  const [r, g, b, a] = ICON_RGBA
  const images: DockLabelImages = {
    createFromPath: (path) =>
      path.endsWith('icon-1024.png')
        ? image(1024, 1024, Buffer.from([b, g, r, a]))
        : image(0, 0, Buffer.alloc(0)),
    createFromBuffer: () => image(1, 1, Buffer.from([0, 0, 255, 255])),
    createFromBitmap: (bitmap, { width, height, scaleFactor }) => {
      made.push({ bitmap, scaleFactor })
      return image(width, height, bitmap)
    },
  }
  return { images, made }
}

/** A Dock stand-in that keeps its badge and counts every call made on it. */
function fakeDock() {
  const calls: string[] = []
  const dock = {
    badge: '',
    shown: [] as NativeImage[],
    setBadge(text: string) {
      this.badge = text
    },
  }
  return {
    dock,
    calls,
    show: (image: NativeImage) => {
      calls.push('show')
      dock.shown.push(image)
    },
    restore: () => calls.push('restore'),
  }
}

/** A pixel of a Mac-order (BGRA) bitmap, as RGBA. */
function pixelOf(bitmap: Buffer, x: number, y: number): number[] {
  const at = (y * DOCK_ICON_SIZE + x) * 4
  return [bitmap[at + 2]!, bitmap[at + 1]!, bitmap[at]!, bitmap[at + 3]!]
}

const hex = (value: string): number[] =>
  [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16))

function started(workspaceName = 'Atlas', withDock = true) {
  const { images, made } = fakeImages()
  const dock = fakeDock()
  const host = startDockLabel({
    folder,
    workspaceName,
    iconPath: '/fictional/icon-1024.png',
    images,
    ...(withDock ? { dock: { show: dock.show, restore: dock.restore } } : {}),
  })
  return { host, made, ...dock }
}

describe('a workspace’s label starts from its name', () => {
  it('the default name follows one rule: first word, its number, vowels dropped to fit', () => {
    const cases: [string, string][] = [
      // First word; the app's own name in a folder's name passed over.
      ['Atlas', 'ATLAS'],
      ['Atlas workspace', 'ATLAS'],
      ['brobot-atlas', 'ATLAS'],
      ['BroBot harvest', 'HARVST'],
      ['brobot', 'BROBOT'],
      ['Cedar', 'CEDAR'],
      // The number that ends the word, or ends the name as a word of its own, is kept.
      ['Test 1', 'TEST1'],
      ['test1', 'TEST1'],
      ['brobot-test-1', 'TEST1'],
      ['Project 12', 'PRJC12'],
      // Too long: vowels after the first two letters dropped, then cut.
      ['Default', 'DEFLT'],
      ['Harbour', 'HARBR'],
      ['brobot-harbour', 'HARBR'],
      // Accents dropped; nothing showable gives BRO.
      ['Café', 'CAFE'],
      ['東京', 'BRO'],
      ['2024 notes', '2024'],
    ]
    for (const [workspace, name] of cases)
      expect(defaultDockLabelName(workspace), workspace).toBe(name)
    for (const [workspace] of cases)
      expect(defaultDockLabelName(workspace).length).toBeLessThanOrEqual(DOCK_LABEL_MAX)
  })

  it('the default colour is picked from the name, the same every time, from the palette', () => {
    const ids = DOCK_LABEL_COLOURS.map((c) => c.id)
    expect(ids.length).toBeGreaterThanOrEqual(6)
    expect(ids.length).toBeLessThanOrEqual(8)
    for (const name of ['ATLAS', 'CEDAR', 'TEST1', 'DEFAULT']) {
      expect(ids).toContain(defaultDockLabelColour(name))
      expect(defaultDockLabelColour(name)).toBe(defaultDockLabelColour(name))
    }
    // Different names spread over the palette rather than landing on one colour.
    const picked = new Set(
      ['ATLAS', 'BIRCH', 'GROVE', 'HAVEN', 'IRIS', 'SAGE', 'ALDER', 'BRO'].map(
        defaultDockLabelColour,
      ),
    )
    expect(picked.size).toBeGreaterThanOrEqual(4)
  })

  it('a new workspace’s label is on, with those defaults; nothing is written until it is changed', async () => {
    const { host } = started('Atlas workspace')
    expect(await host.read()).toEqual({
      on: true,
      name: 'ATLAS',
      colour: defaultDockLabelColour('ATLAS'),
      defaults: { name: 'ATLAS', colour: defaultDockLabelColour('ATLAS') },
    })
    expect(existsSync(join(folder, DOCK_LABEL_FILE))).toBe(false)
  })
})

describe('names and colours', () => {
  it('a long name is cut to fit, and only what the band can draw is kept', () => {
    expect(DOCK_LABEL_MAX).toBe(6)
    expect(dockLabelName('verylongname')).toBe('VERYLO')
    expect(dockLabelName('verylongname')).toHaveLength(DOCK_LABEL_MAX)
    expect(dockLabelName('my-ws 2!')).toBe('MYWS2')
    expect(dockLabelName('DEFAULT')).toBe('DEFAUL')
  })

  it('the widest name fits inside the band, clear of the tile’s rounded corners', () => {
    for (const name of ['WWWWWW', 'MMMMMM', 'PRJC12', 'ATLAS', 'I', '0']) {
      const text = layOutDockLabel(name)
      expect(text.left, name).toBeGreaterThanOrEqual(DOCK_ICON_SIZE / 2 - 150 - 0.01)
      expect(text.right, name).toBeLessThanOrEqual(DOCK_ICON_SIZE / 2 + 150 + 0.01)
      expect(text.top, name).toBeGreaterThan(DOCK_LABEL_BAND_TOP)
      expect(text.bottom, name).toBeLessThan(DOCK_ICON_SIZE - 50)
    }
  })

  it('every letter and digit has a shape', () => {
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      expect(layOutDockLabel(c).segments.length, c).toBeGreaterThan(0)
    }
  })

  it('every swatch, light ones too, gives text at least 4.5 to 1 against its band', () => {
    for (const colour of DOCK_LABEL_COLOURS) {
      const { band, ink } = dockLabelColours(colour.id)
      expect(contrastRatio(ink, band), colour.id).toBeGreaterThanOrEqual(4.5)
    }
    // The light swatch takes dark text.
    expect(dockLabelColours('amber').ink).toMatchObject({ r: 0, g: 0, b: 0 })
  })

  it('…and so would any colour: the darker ink is pure black, so no band falls under 4.5', () => {
    for (let v = 0; v <= 255; v += 5) {
      for (const band of [
        { r: v, g: v, b: v, a: 1 },
        { r: v, g: 255 - v, b: 128, a: 1 },
        { r: 255, g: v, b: 0, a: 1 },
      ]) {
        expect(contrastRatio(dockLabelInk(band), band)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('a change from the window is only what the label holds', () => {
    expect(isDockLabelChange({ on: false })).toBe(true)
    expect(isDockLabelChange({ name: 'CEDAR', colour: 'teal' })).toBe(true)
    expect(isDockLabelChange({ name: null, colour: null })).toBe(true)
    expect(isDockLabelChange({ colour: '#123456' })).toBe(false)
    expect(isDockLabelChange({ on: 'yes' })).toBe(false)
    expect(isDockLabelChange({ path: '/etc' })).toBe(false)
    expect(isDockLabelChange('CEDAR')).toBe(false)
  })
})

describe('painting the band', () => {
  const icon = (): Uint8Array => {
    const out = new Uint8Array(DOCK_ICON_SIZE * DOCK_ICON_SIZE * 4)
    for (let i = 0; i < out.length; i += 4) out.set(ICON_RGBA, i)
    return out
  }
  const at = (rgba: Uint8Array, x: number, y: number): number[] => {
    const i = (y * DOCK_ICON_SIZE + x) * 4
    return [...rgba.subarray(i, i + 4)]
  }

  it('paints the band’s colour across the bottom of the tile, and the name in its ink', () => {
    const rgba = paintDockLabel(icon(), 'ATLAS', 'blue')
    // Beside the text, inside the band: the band's colour.
    expect(at(rgba, 70, 400)).toEqual([...hex('#2563eb'), 255])
    // Some pixels in the band carry the ink: white on blue.
    let inked = 0
    for (let x = 150; x < 360; x++) if (at(rgba, x, 400)[0] === 255) inked++
    expect(inked).toBeGreaterThan(10)
  })

  it('leaves everything above the band, the top-right corner where the badge sits too, as it was', () => {
    const rgba = paintDockLabel(icon(), 'ATLAS', 'red')
    for (const [x, y] of [
      [430, 70],
      [400, 100],
      [256, 256],
      [100, DOCK_LABEL_BAND_TOP - 2],
    ] as const) {
      expect(at(rgba, x, y), `${x},${y}`).toEqual([...ICON_RGBA])
    }
  })

  it('keeps to the tile: the rounded corners and the margin stay as the icon has them', () => {
    const rgba = paintDockLabel(icon(), 'ATLAS', 'green')
    expect(at(rgba, 52, 460)).toEqual([...ICON_RGBA])
    expect(at(rgba, 256, 470)).toEqual([...ICON_RGBA])
  })
})

describe('the Dock follows the setting', () => {
  it('at launch the icon is painted with the label, as a 256-point Retina icon', async () => {
    const { host, calls, made } = started()
    await host.idle()
    expect(calls).toEqual(['show'])
    expect(made[0]!.scaleFactor).toBe(2)
    expect(made[0]!.bitmap.length).toBe(DOCK_ICON_SIZE * DOCK_ICON_SIZE * 4)
    const colour = (await host.read()).colour
    expect(pixelOf(made[0]!.bitmap, 70, 400)).toEqual([
      ...hex(DOCK_LABEL_COLOURS.find((c) => c.id === colour)!.hex),
      255,
    ])
  })

  it('editing the name or the colour saves it and paints the icon again', async () => {
    const { host, calls, made } = started()
    await host.idle()
    // A colour other than the one Atlas starts with (teal), so the change is a change.
    expect((await host.set({ colour: 'violet' })).colour).toBe('violet')
    await host.idle()
    expect(pixelOf(made.at(-1)!.bitmap, 70, 400)).toEqual([...hex('#7c3aed'), 255])
    expect((await host.set({ name: 'cedar' })).name).toBe('CEDAR')
    await host.idle()
    expect(calls).toEqual(['show', 'show', 'show'])
    expect(made[1]!.bitmap.equals(made[2]!.bitmap)).toBe(false)
    expect(await readDockLabelFile(folder)).toEqual({
      name: 'CEDAR',
      colour: 'violet',
    })
  })

  it('the same label again paints nothing new', async () => {
    const { host, calls } = started()
    await host.idle()
    await host.set({ colour: (await host.read()).colour })
    await host.idle()
    expect(calls).toEqual(['show'])
  })

  it('turning it off gives the plain icon back; on again paints it', async () => {
    const { host, calls } = started()
    await host.idle()
    expect((await host.set({ on: false })).on).toBe(false)
    await host.idle()
    expect(calls).toEqual(['show', 'restore'])
    await host.set({ on: true })
    await host.idle()
    expect(calls).toEqual(['show', 'restore', 'show'])
  })

  it('a workspace whose label is off starts with the plain icon, and sets nothing in the Dock', async () => {
    writeFileSync(join(folder, DOCK_LABEL_FILE), '{"on": false}\n')
    const { host, calls } = started()
    await host.idle()
    expect(calls).toEqual([])
    expect((await host.read()).on).toBe(false)
  })

  it('a Dock badge set before a repaint is still there after it: only the icon is ever set', async () => {
    const { host, dock } = started()
    dock.setBadge('3')
    await host.idle()
    await host.set({ colour: 'violet' })
    await host.idle()
    await host.set({ on: false })
    await host.idle()
    expect(dock.shown).toHaveLength(2)
    expect(dock.badge).toBe('3')
  })

  it('a newer change wins: an older paint still under way never reaches the Dock', async () => {
    const { images, made } = fakeImages()
    const dock = fakeDock()
    const waiting: (() => void)[] = []
    const host = startDockLabel({
      folder,
      workspaceName: 'Atlas',
      iconPath: '/fictional/icon-1024.png',
      images,
      dock: { show: dock.show, restore: dock.restore },
      turn: () => new Promise<void>((resolve) => waiting.push(resolve)),
    })
    // The launch's paint is held at its first turn; then the colour changes.
    // The saved settings are read from disk first, so the first turn comes a little later.
    for (let i = 0; i < 1000 && waiting.length === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 2))
    expect(waiting).toHaveLength(1)
    await host.set({ colour: 'pink' })
    let done = false
    void host.idle().then(() => (done = true))
    // Every held turn is let go, one at a time, until the newer paint has finished.
    for (let i = 0; i < 5000 && !done; i++) {
      while (waiting.length > 0) waiting.shift()!()
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(done).toBe(true)
    await host.idle()
    expect(dock.calls).toEqual(['show'])
    expect(pixelOf(made[0]!.bitmap, 70, 400)).toEqual([...hex('#be185d'), 255])
  })

  it('a Dock that refuses the icon keeps the one it had, and the next change tries again', async () => {
    const { images } = fakeImages()
    let refuse = true
    const shown: string[] = []
    const host = startDockLabel({
      folder,
      workspaceName: 'Atlas',
      iconPath: '/fictional/icon-1024.png',
      images,
      dock: {
        show: () => {
          if (refuse) throw new Error('fictional: the Dock refused')
          shown.push('show')
        },
        restore: () => undefined,
      },
    })
    const warn = console.warn
    console.warn = () => undefined
    try {
      await host.idle()
      expect(shown).toEqual([])
      refuse = false
      await host.set({ colour: 'amber' })
      await host.idle()
      expect(shown).toEqual(['show'])
    } finally {
      console.warn = warn
    }
  })

  it('stopping: a paint under way shows nothing', async () => {
    const { host, calls } = started()
    host.stop()
    await host.idle()
    expect(calls).toEqual([])
  })

  it('a launch kept out of the Dock keeps the setting and paints nothing', async () => {
    const { host, made } = started('Atlas', false)
    await host.set({ name: 'TEST1' })
    await host.idle()
    expect(made).toEqual([])
    expect(await readDockLabelFile(folder)).toEqual({ name: 'TEST1' })
  })
})

describe('the file', () => {
  it('a missing, broken or foreign file says nothing, and the defaults stand', async () => {
    const file = join(folder, DOCK_LABEL_FILE)
    expect(await readDockLabelFile(folder)).toEqual({})
    writeFileSync(file, '{"on": tru')
    expect(await readDockLabelFile(folder)).toEqual({})
    writeFileSync(file, '{"on": "no", "name": 4, "colour": "#ff0000"}')
    expect(await readDockLabelFile(folder)).toEqual({})
    expect(dockLabelOf({}, 'Cedar').on).toBe(true)
  })

  it('a name or colour set back to null returns to the default', async () => {
    const { host } = started('Cedar')
    await host.set({ name: 'X1', colour: 'red' })
    const back = await host.set({ name: null, colour: null })
    expect(back.name).toBe('CEDAR')
    expect(back.colour).toBe(defaultDockLabelColour('CEDAR'))
    expect(await readDockLabelFile(folder)).toEqual({})
    await host.idle()
  })

  it('what is saved reads back, and no temporary file is left', async () => {
    const { host } = started()
    await host.set({ name: 'CEDAR', colour: 'teal', on: false })
    expect(readdirSync(folder)).toEqual([DOCK_LABEL_FILE])
    expect(JSON.parse(readFileSync(join(folder, DOCK_LABEL_FILE), 'utf8'))).toEqual({
      name: 'CEDAR',
      colour: 'teal',
      on: false,
    })
    expect(await readDockLabelFile(folder)).toEqual({ name: 'CEDAR', colour: 'teal', on: false })
  })
})

describe('the file is read and written carefully', () => {
  const file = (): string => join(folder, DOCK_LABEL_FILE)

  it.skipIf(NO_PIPES_OR_LINKS)(
    'a pipe at the path does not hang the read: the defaults stand',
    async () => {
      execFileSync('mkfifo', [file()])
      const result = await Promise.race([
        readDockLabelFile(folder),
        new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 3000)),
      ])
      expect(result).toEqual({})
      const { host } = started()
      expect((await host.read()).on).toBe(true)
    },
  )

  it('a file over the limit is not read: the defaults stand', async () => {
    writeFileSync(file(), JSON.stringify({ name: 'BIG', pad: 'x'.repeat(DOCK_LABEL_FILE_BYTES) }))
    expect(await readDockLabelFile(folder)).toEqual({})
    writeFileSync(file(), JSON.stringify({ name: 'OK' }))
    expect(await readDockLabelFile(folder)).toEqual({ name: 'OK' })
  })

  it.skipIf(NO_PIPES_OR_LINKS)('a link at the file is not followed', async () => {
    const elsewhere = join(folder, 'elsewhere.json')
    writeFileSync(elsewhere, JSON.stringify({ name: 'LINKED' }))
    symlinkSync(elsewhere, file())
    expect(await readDockLabelFile(folder)).toEqual({})
  })

  it.skipIf(NO_PIPES_OR_LINKS)(
    'saving over a link replaces the link, and does not write through it',
    async () => {
      const elsewhere = join(folder, 'elsewhere.json')
      writeFileSync(elsewhere, 'untouched')
      symlinkSync(elsewhere, file())
      await writeDockLabelFile(folder, { name: 'SAFE' })
      expect(readFileSync(elsewhere, 'utf8')).toBe('untouched')
      expect(await readDockLabelFile(folder)).toEqual({ name: 'SAFE' })
    },
  )

  it.skipIf(NO_PIPES_OR_LINKS)(
    'a link planted at the old predictable temporary name is not written through',
    async () => {
      const victim = join(folder, 'victim.txt')
      writeFileSync(victim, 'untouched')
      symlinkSync(victim, `${file()}.${String(process.pid)}.tmp`)
      await writeDockLabelFile(folder, { name: 'SAFE' })
      expect(readFileSync(victim, 'utf8')).toBe('untouched')
      expect(await readDockLabelFile(folder)).toEqual({ name: 'SAFE' })
    },
  )

  it('writes to an exclusive, unique temporary file, which the data-folder reset knows', async () => {
    const source = readFileSync(join(__dirname, '../src/main/themes/state.ts'), 'utf8')
    expect(source).toContain('const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`')
    expect(source).toContain("open(temporary, 'wx', 0o600)")
    const part = /^dock-label\.json\.\d+\.[0-9a-f-]{36}\.tmp$/
    expect(part.test(`dock-label.json.4242.${randomUUID()}.tmp`)).toBe(true)
  })

  it('a folder that is not there is not made up: the read says nothing, the save is refused', async () => {
    const gone = join(folder, 'gone')
    expect(await readDockLabelFile(gone)).toEqual({})
    await expect(writeDockLabelFile(gone, { name: 'X' })).rejects.toThrow()
  })

  it('a save that fails leaves the label as it was', async () => {
    const { host } = started('Cedar')
    await host.set({ name: 'ONE' })
    rmSync(folder, { recursive: true, force: true })
    await expect(host.set({ name: 'TWO' })).rejects.toThrow()
    expect((await host.read()).name).toBe('ONE')
  })
})

describe('starting colours never repeat across workspaces', () => {
  const names = (...list: string[]): DockLabelWorkspace[] =>
    list.map((name) => ({ key: `/w/${name}`, name }))
  const colours = (list: DockLabelWorkspace[]): DockLabelColour[] => {
    const all = defaultDockLabelColours(list)
    return list.map((one) => all.get(one.key)!)
  }

  it('ATLAS and CEDAR, which hash to the same colour, get different starting colours', () => {
    expect(defaultDockLabelColour('ATLAS')).toBe(defaultDockLabelColour('CEDAR'))
    const [atlas, cedar] = colours(names('ATLAS', 'CEDAR'))
    expect(atlas).not.toBe(cedar)
  })

  it('four workspaces whose names all hash to one colour get four colours', () => {
    expect(new Set(colours(names('DEFLT', 'ATLAS', 'HARBR', 'TEST1'))).size).toBe(4)
  })

  it('eight names that hash to one colour get eight different colours', () => {
    const same: string[] = []
    for (let i = 0; same.length < 8; i++) {
      const name = `W${String(i)}`
      if (defaultDockLabelColour(name) === 'blue') same.push(name)
    }
    expect(new Set(colours(names(...same))).size).toBe(8)
  })

  it('past eight workspaces the rest take their plain hash, and the first eight stay different', () => {
    const list = names('A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8', 'I9', 'J10')
    const got = colours(list)
    expect(new Set(got.slice(0, 8)).size).toBe(8)
    expect(got[8]).toBe(defaultDockLabelColour('I9'))
    expect(got[9]).toBe(defaultDockLabelColour('J10'))
  })

  it('a chosen colour stays put, and a starting colour steps around it', () => {
    const atlas = defaultDockLabelColour('ATLAS')
    const [alone] = colours(names('CEDAR'))
    expect(alone).toBe(atlas)
    // ATLAS's person chose the colour CEDAR would have started with.
    const list: DockLabelWorkspace[] = [
      { key: '/w/atlas', name: 'ATLAS', chosen: atlas },
      { key: '/w/cedar', name: 'CEDAR' },
    ]
    const got = defaultDockLabelColours(list)
    expect(got.get('/w/atlas')).toBe(atlas)
    expect(got.get('/w/cedar')).not.toBe(atlas)
    // A choice made later in the list still holds, and an earlier start steps around it.
    const later: DockLabelWorkspace[] = [
      { key: '/w/a', name: 'CEDAR' },
      { key: '/w/b', name: 'ZZZ', chosen: atlas },
    ]
    const result = defaultDockLabelColours(later)
    expect(result.get('/w/b')).toBe(atlas)
    expect(result.get('/w/a')).not.toBe(atlas)
  })

  it('the same set of workspaces gives the same colours on every run, whatever order they arrive in', async () => {
    const list = names('ATLAS', 'CEDAR', 'TEST1', 'DEFLT')
    const first = colours(list)
    expect(colours(list)).toEqual(first)
    const known = list.map((one) => ({ path: one.key, name: one.name }))
    const here = known.find((one) => one.name === 'CEDAR')!
    const read = async (): Promise<Record<string, never>> => ({})
    const a = await startingColourAmong(here, known, read)
    const b = await startingColourAmong(here, [...known].reverse(), read)
    expect(b).toBe(a)
  })

  it('this workspace is counted, under its own name, even when the list doesn’t name it', async () => {
    // ATLAS and CEDAR hash to the same colour; CEDAR must step off it.
    expect(defaultDockLabelColour('CEDAR')).toBe(defaultDockLabelColour('ATLAS'))
    const known = [{ path: '/w/ATLAS', name: 'ATLAS' }]
    const colour = await startingColourAmong(
      { path: '/w/CEDAR', name: 'CEDAR' },
      known,
      async () => ({}),
    )
    expect(colour).not.toBe(defaultDockLabelColour('ATLAS'))
  })

  it('each workspace’s chosen colour is read from its own folder', async () => {
    const chosen: Record<string, DockLabelColour> = { '/w/ATLAS': 'orange' }
    const known = [
      { path: '/w/ATLAS', name: 'ATLAS' },
      { path: '/w/CEDAR', name: 'CEDAR' },
    ]
    const colour = await startingColourAmong(known[1]!, known, async (folder) =>
      chosen[folder] ? { colour: chosen[folder] } : {},
    )
    expect(colour).toBe(defaultDockLabelColour('CEDAR'))
    const same = await startingColourAmong(known[1]!, known, async (folder) =>
      folder === '/w/ATLAS' ? { colour: defaultDockLabelColour('CEDAR') } : {},
    )
    expect(same).not.toBe(defaultDockLabelColour('CEDAR'))
  })

  it('the label shows its starting colour, and one that can’t be worked out falls back to the hash', async () => {
    const worked = startDockLabel({
      folder,
      workspaceName: 'Cedar',
      iconPath: '/fictional/icon-1024.png',
      images: fakeImages().images,
      startingColour: async () => 'violet',
    })
    expect((await worked.read()).colour).toBe('violet')
    expect((await worked.read()).defaults.colour).toBe('violet')
    const failed = startDockLabel({
      folder,
      workspaceName: 'Cedar',
      iconPath: '/fictional/icon-1024.png',
      images: fakeImages().images,
      startingColour: async () => {
        throw new Error('the list can’t be read')
      },
    })
    expect((await failed.read()).colour).toBe(defaultDockLabelColour('CEDAR'))
  })
})

describe('the workspace list is read carefully for the starting colours', () => {
  /** This workspace, `brobot-cedar` (CEDAR), and a list file beside it; ATLAS hashes to CEDAR's colour. */
  function aWorkspace() {
    const here = join(folder, 'brobot-cedar')
    mkdirSync(here)
    const lists = join(folder, 'lists')
    mkdirSync(lists)
    const listFile = join(lists, 'workspaces.json')
    const colour = startingColourFromList({
      here,
      listFile,
      defaultFolder: join(folder, 'default'),
    })
    return { here, listFile, colour }
  }
  const listing = (...paths: string[]) => ({
    version: 1,
    workspaces: paths.map((path, i) => ({ path, lastOpenedAt: i })),
  })
  /** Settles with what `work` answers, or `hung` if it hasn't in three seconds. */
  const within = <T>(work: Promise<T>): Promise<T | 'hung'> =>
    Promise.race([work, new Promise<'hung'>((done) => setTimeout(() => done('hung'), 3000))])
  const hashed = defaultDockLabelColour('CEDAR')

  it('a readable list shares out the colours: CEDAR steps off the colour ATLAS has', async () => {
    expect(defaultDockLabelColour('ATLAS')).toBe(hashed)
    const { listFile, colour } = aWorkspace()
    writeFileSync(listFile, JSON.stringify(listing(join(folder, 'brobot-atlas'))))
    expect(await colour()).not.toBe(hashed)
  })

  it.skipIf(NO_PIPES_OR_LINKS)(
    'a pipe at the list doesn’t hold anything up: launch and saves finish with the plain hash',
    async () => {
      const { here, listFile, colour } = aWorkspace()
      execFileSync('mkfifo', [listFile])
      expect(await within(colour().catch(() => 'refused'))).toBe('refused')
      const host = startDockLabel({
        folder: here,
        workspaceName: 'brobot-cedar',
        iconPath: '/fictional/icon-1024.png',
        images: fakeImages().images,
        startingColour: colour,
      })
      const read = await within(host.read())
      expect(read).not.toBe('hung')
      expect((read as Awaited<ReturnType<typeof host.read>>).colour).toBe(hashed)
      const saved = await within(host.set({ name: 'CEDAR2' }))
      expect(saved).not.toBe('hung')
      expect((saved as Awaited<ReturnType<typeof host.set>>).colour).toBe(hashed)
    },
  )

  it('a list over the limit is not read: the plain hash stands', async () => {
    const { listFile, colour } = aWorkspace()
    writeFileSync(
      listFile,
      JSON.stringify({
        ...listing(join(folder, 'brobot-atlas')),
        pad: 'x'.repeat(WORKSPACE_LIST_BYTES),
      }),
    )
    await expect(colour()).rejects.toThrow()
  })

  it.skipIf(NO_PIPES_OR_LINKS)('a link at the list is not followed', async () => {
    const { listFile, colour } = aWorkspace()
    const elsewhere = join(folder, 'elsewhere.json')
    writeFileSync(elsewhere, JSON.stringify(listing(join(folder, 'brobot-atlas'))))
    symlinkSync(elsewhere, listFile)
    await expect(colour()).rejects.toThrow()
  })

  it('no list yet names no other workspace: the plain hash', async () => {
    const { colour } = aWorkspace()
    expect(await colour()).toBe(hashed)
  })
})

describe('the workspace’s name never holds up the label', () => {
  const never = (): Promise<string> => new Promise<string>(() => undefined)
  const within = <T>(work: Promise<T>, ms = 3000): Promise<T | 'hung'> =>
    Promise.race([work, new Promise<'hung'>((done) => setTimeout(() => done('hung'), ms))])

  it('a saved label paints at once while the name is still being read', async () => {
    writeFileSync(join(folder, DOCK_LABEL_FILE), JSON.stringify({ name: 'CEDAR', colour: 'teal' }))
    const dock = fakeDock()
    const host = startDockLabel({
      folder,
      workspaceName: never,
      withinMs: 60_000,
      iconPath: '/fictional/icon-1024.png',
      images: fakeImages().images,
      dock: { show: dock.show, restore: dock.restore },
    })
    expect(await within(host.idle())).not.toBe('hung')
    expect(dock.calls).toEqual(['show'])
    host.stop()
  })

  it('a name that never comes is given up within the limit: reads and saves finish', async () => {
    writeFileSync(join(folder, DOCK_LABEL_FILE), JSON.stringify({ name: 'CEDAR', colour: 'teal' }))
    const host = startDockLabel({
      folder,
      workspaceName: never,
      withinMs: 200,
      iconPath: '/fictional/icon-1024.png',
      images: fakeImages().images,
    })
    const read = await within(host.read())
    expect(read).not.toBe('hung')
    expect(read).toMatchObject({ name: 'CEDAR', colour: 'teal' })
    const saved = await within(host.set({ colour: 'pink' }))
    expect(saved).toMatchObject({ colour: 'pink' })
  })

  it('…and with no saved label, the folder’s own name stands in for it', async () => {
    const here = join(folder, 'brobot-atlas')
    mkdirSync(here)
    const host = startDockLabel({
      folder: here,
      workspaceName: never,
      withinMs: 200,
      iconPath: '/fictional/icon-1024.png',
      images: fakeImages().images,
    })
    expect(await within(host.read())).toMatchObject({ name: 'ATLAS' })
  })

  it.skipIf(NO_PIPES_OR_LINKS)(
    'a pipe at workspace.json is not waited on: the folder’s own name is used',
    async () => {
      const here = join(folder, 'brobot-atlas')
      mkdirSync(here)
      execFileSync('mkfifo', [join(here, 'workspace.json')])
      expect(await within(carefulWorkspaceName(here, false))).toBe('brobot-atlas')
    },
  )
})
