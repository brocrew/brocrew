import { onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { GraphView, GraphControls, Point } from '../lib/team-profile-graph'
import { GraphBins, labelBudget, matchesAgent, graphWords } from '../lib/team-profile-graph'
import type { LayoutCommand } from '../lib/team-profile-layout'
import { parseLayoutReply } from '../lib/team-profile-layout-replies'
import { DEFAULT_PROFILE_ID } from '../../../shared/runtime-ipc'

export function useTeamProfileCanvas(options: {
  canvas: Ref<HTMLCanvasElement | null>
  view: () => GraphView | null
  controls: GraphControls
  active: () => boolean
  selected: () => string | null
  focused: () => string | null
  query: () => string
  select: (id: string, opener: HTMLElement) => void
  close: () => void
}) {
  const paused = ref(false),
    reduced = ref(false),
    forcedColors = ref(false),
    failed = ref(false),
    hiddenLabels = ref(0)
  const hovered = ref<string | null>(null)
  let pendingPin: Extract<LayoutCommand, { type: 'pin' }> | null = null
  let worker: Worker | undefined,
    generation = 0,
    raf = 0,
    animation = 0,
    pending: Float64Array | null = null
  let points: Point[] = [],
    bins = new GraphBins(),
    width = 0,
    height = 0,
    ratio = 1
  let transform = { x: 0, y: 0, k: 1 },
    observer: ResizeObserver | undefined,
    theme: MutationObserver | undefined
  let media: MediaQueryList | undefined,
    forced: MediaQueryList | undefined,
    previous: GraphView | null = null
  let drag:
    | {
        pointer: number
        index: number
        x: number
        y: number
        startX: number
        startY: number
        max: number
        panX: number
        panY: number
      }
    | undefined
  function post(message: LayoutCommand): void {
    worker?.postMessage(message)
  }
  function stop(): void {
    paused.value = true
    cancelAnimationFrame(raf)
    cancelAnimationFrame(animation)
    raf = 0
    animation = 0
    pending = null
    post({ type: 'pause', generation })
    post({ type: 'ack', generation })
  }
  function endDrag(): void {
    if (!drag) return
    pendingPin = null
    const point = points[drag.index]
    if (point)
      post({ type: 'pin', generation, index: drag.index, x: point.x, y: point.y, held: false })
    const canvas = options.canvas.value
    const pointer = drag.pointer
    drag = undefined
    if (canvas?.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer)
  }
  function terminate(): void {
    endDrag()
    cancelAnimationFrame(raf)
    cancelAnimationFrame(animation)
    raf = 0
    animation = 0
    pending = null
    worker?.terminate()
    worker = undefined
    generation++
  }
  function palette() {
    const css = getComputedStyle(options.canvas.value!)
    return {
      text: css.getPropertyValue('--text').trim(),
      muted: css.getPropertyValue('--muted').trim(),
      accent: css.getPropertyValue('--accent').trim(),
      line: css.getPropertyValue('--line-strong').trim(),
      paper: css.getPropertyValue('--panel').trim(),
    }
  }
  const screen = (point: Point): Point => ({
    x: point.x * transform.k + transform.x,
    y: point.y * transform.k + transform.y,
  })
  function draw(): void {
    const canvas = options.canvas.value,
      view = options.view(),
      ctx = canvas?.getContext('2d')
    if (
      !canvas ||
      !view ||
      view.tooLarge ||
      forcedColors.value ||
      failed.value ||
      !ctx ||
      !width ||
      !height ||
      !options.active() ||
      document.hidden
    )
      return
    const colors = palette(),
      index = new Map(view.nodes.map((n, i) => [n.id, i])),
      words = graphWords(options.query())
    const focus = hovered.value ?? options.focused() ?? options.selected()
    const neighbours = new Set<string>(focus ? [focus] : [])
    if (focus)
      for (const edge of view.edges) {
        if (edge.source === focus) neighbours.add(edge.target)
        if (edge.target === focus) neighbours.add(edge.source)
      }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const shown = points.map(screen)
    ctx.lineCap = 'round'
    ctx.strokeStyle = colors.line
    ctx.fillStyle = colors.line
    for (const edge of view.edges) {
      const a = index.get(edge.source)!,
        b = index.get(edge.target)!,
        s = shown[a],
        t = shown[b]
      if (!s || !t) continue
      const dx = t.x - s.x,
        dy = t.y - s.y,
        d = Math.hypot(dx, dy)
      if (d < 1) continue
      const start = view.radii[a]! * transform.k + 2,
        end = view.radii[b]! * transform.k + 5
      if (d <= start + end) continue
      const sx = s.x + (dx / d) * start,
        sy = s.y + (dy / d) * start,
        tx = t.x - (dx / d) * end,
        ty = t.y - (dy / d) * end
      ctx.globalAlpha =
        focus && (!neighbours.has(edge.source) || !neighbours.has(edge.target)) ? 0.2 : 1
      ctx.beginPath()
      ctx.lineWidth = edge.width
      ctx.moveTo(sx, sy)
      if (options.controls.directions) {
        const cx = (sx + tx) / 2 - dy * 0.12,
          cy = (sy + ty) / 2 + dx * 0.12
        ctx.quadraticCurveTo(cx, cy, tx, ty)
        ctx.stroke()
        const angle = Math.atan2(ty - cy, tx - cx),
          arrow = 5 + edge.width
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(tx - arrow * Math.cos(angle - 0.45), ty - arrow * Math.sin(angle - 0.45))
        ctx.lineTo(tx - arrow * Math.cos(angle + 0.45), ty - arrow * Math.sin(angle + 0.45))
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.lineTo(tx, ty)
        ctx.stroke()
      }
    }
    bins = new GraphBins()
    const priority: number[] = [],
      ordinary: number[] = []
    const budgets = labelBudget(view.nodes.length, options.controls.badges)
    for (let i = 0; i < view.nodes.length; i++) {
      const node = view.nodes[i]!,
        p = shown[i],
        r = view.radii[i]! * transform.k
      if (!p) continue
      bins.add(i, p.x, p.y, Math.max(10, r))
      const chosen = node.id === options.selected(),
        match = words.length > 0 && matchesAgent(node, words)
      if (chosen || match || neighbours.has(node.id)) priority.push(i)
      else ordinary.push(i)
      if (p.x + r < 0 || p.x - r > width || p.y + r < 0 || p.y - r > height) continue
      ctx.globalAlpha =
        (words.length > 0 && !match && !chosen) || (focus && !neighbours.has(node.id)) ? 0.35 : 1
      ctx.strokeStyle = chosen || match ? colors.accent : colors.muted
      ctx.fillStyle = node.kind === 'unknown' ? colors.paper : colors.accent
      ctx.lineWidth = chosen ? 3 : 1
      ctx.beginPath()
      if (node.kind === 'service') {
        ctx.moveTo(p.x, p.y - r)
        ctx.lineTo(p.x + r, p.y)
        ctx.lineTo(p.x, p.y + r)
        ctx.lineTo(p.x - r, p.y)
        ctx.closePath()
      } else ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      if (node.profile === DEFAULT_PROFILE_ID) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    const order = [...priority, ...ordinary],
      occupied = new GraphBins(80),
      rectangles: { x: number; y: number; w: number; h: number }[] = []
    const size = parseFloat(getComputedStyle(canvas).fontSize) || 13
    ctx.font = `${size}px ${getComputedStyle(canvas).fontFamily}`
    let textDraws = 0,
      nameDraws = 0,
      ordinaryDraws = 0
    function text(value: string, i: number, badge: boolean): boolean {
      const p = shown[i]!,
        r = view!.radii[i]! * transform.k,
        w = ctx!.measureText(value).width,
        h = size + 3
      const x = p.x + r + 5,
        y = p.y + (badge ? -h : 4)
      if (x < 0 || x + w > width || y - h < 0 || y > height) return false
      const nearby = new Set<number>()
      for (let cx = x; cx <= x + w + 80; cx += 80)
        for (let cy = y - h; cy <= y + 80; cy += 80)
          for (const j of occupied.at(cx, cy)) nearby.add(j)
      if (
        !badge &&
        [...nearby].some((j) => {
          const b = rectangles[j]!
          return x < b.x + b.w && x + w > b.x && y - h < b.y + b.h && y > b.y
        })
      )
        return false
      rectangles.push({ x, y: y - h, w, h })
      occupied.add(rectangles.length - 1, x + w / 2, y - h / 2, Math.max(w, h) / 2)
      ctx!.fillStyle = badge ? colors.accent : colors.text
      ctx!.fillText(value, x, y)
      textDraws++
      return true
    }
    if (options.controls.badges)
      for (const i of order.slice(0, budgets.badges)) {
        const n = view.nodes[i]!,
          value = n.descendants
        text(String(value), i, true)
      }
    for (const i of order) {
      if (textDraws >= 300 || nameDraws >= budgets.names) break
      const ordinaryNode = !priority.includes(i)
      if (ordinaryNode && ordinaryDraws >= budgets.ordinary) continue
      if (text(view.nodes[i]!.name, i, false)) {
        nameDraws++
        if (ordinaryNode) ordinaryDraws++
      }
    }
    hiddenLabels.value = Math.max(
      0,
      view.nodes.length * (options.controls.badges ? 2 : 1) - textDraws,
    )
  }
  function requestDraw(): void {
    if (raf || !options.active() || document.hidden) return
    raf = requestAnimationFrame(() => {
      raf = 0
      if (pendingPin) {
        post(pendingPin)
        pendingPin = null
      }
      if (pending) {
        const pinned =
          drag && drag.index >= 0 ? { index: drag.index, point: points[drag.index]! } : null
        if (!paused.value)
          points = Array.from({ length: pending.length / 2 }, (_, i) => ({
            x: pending![i * 2]!,
            y: pending![i * 2 + 1]!,
          }))
        if (pinned) points[pinned.index] = pinned.point
        pending = null
        post({ type: 'ack', generation })
      }
      draw()
    })
  }
  function resize(): void {
    const canvas = options.canvas.value
    if (!canvas) return
    const box = canvas.getBoundingClientRect()
    width = box.width
    height = box.height
    ratio = Math.min(2, devicePixelRatio || 1, Math.sqrt(8_000_000 / Math.max(1, width * height)))
    canvas.width = Math.floor(width * ratio)
    canvas.height = Math.floor(height * ratio)
    requestDraw()
  }
  function fit(): void {
    cancelAnimationFrame(animation)
    if (!points.length) return
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity
    points.forEach((p, i) => {
      const r = options.view()!.radii[i]! + 24
      left = Math.min(left, p.x - r)
      right = Math.max(right, p.x + r)
      top = Math.min(top, p.y - r)
      bottom = Math.max(bottom, p.y + r)
    })
    const canvas = options.canvas.value!,
      css = getComputedStyle(canvas),
      textSize = parseFloat(css.fontSize) || 13,
      context = canvas.getContext('2d')
    if (context) context.font = `${textSize}px ${css.fontFamily}`
    const badgeWidth = options
      .view()!
      .nodes.reduce(
        (maximum, node) =>
          Math.max(maximum, context?.measureText(String(node.descendants)).width ?? 0),
        0,
      )
    // Keep CSS-pixel text space even when badges are toggled after fitting.
    const padLeft = 12,
      padRight = 17 + badgeWidth,
      padTop = 12 + 2 * (textSize + 3),
      padBottom = 12,
      availableWidth = Math.max(1, width - padLeft - padRight),
      availableHeight = Math.max(1, height - padTop - padBottom)
    const k = Math.max(
      0.15,
      Math.min(
        5,
        availableWidth / Math.max(1, right - left),
        availableHeight / Math.max(1, bottom - top),
      ),
    )
    transform = {
      x: padLeft + availableWidth / 2 - ((left + right) / 2) * k,
      y: padTop + availableHeight / 2 - ((top + bottom) / 2) * k,
      k,
    }
    requestDraw()
  }
  function zoom(factor: number, x = width / 2, y = height / 2): void {
    cancelAnimationFrame(animation)
    const k = Math.max(0.15, Math.min(5, transform.k * factor)),
      f = k / transform.k
    transform = { x: x - (x - transform.x) * f, y: y - (y - transform.y) * f, k }
    requestDraw()
  }
  function center(id: string): void {
    const index = options.view()?.nodes.findIndex((n) => n.id === id) ?? -1,
      point = points[index]
    if (!point) return
    cancelAnimationFrame(animation)
    const target = {
      ...transform,
      x: width / 2 - point.x * transform.k,
      y: height / 2 - point.y * transform.k,
    }
    if (paused.value || reduced.value) {
      transform = target
      requestDraw()
      return
    }
    const start = performance.now(),
      from = { ...transform }
    function step(now: number): void {
      const t = Math.min(1, (now - start) / 180)
      transform = {
        k: from.k,
        x: from.x + (target.x - from.x) * t,
        y: from.y + (target.y - from.y) * t,
      }
      requestDraw()
      if (t < 1) animation = requestAnimationFrame(step)
    }
    animation = requestAnimationFrame(step)
  }
  function rebuild(): void {
    endDrag()
    const view = options.view()
    if (
      !options.canvas.value ||
      !view ||
      view.tooLarge ||
      forcedColors.value ||
      !options.active()
    ) {
      terminate()
      previous = view
      return
    }
    const old = new Map(
      previous?.nodes.map((n, i) => [n.id, { createdAt: n.createdAt, point: points[i] }]) ?? [],
    )
    const same =
      points.length === view.nodes.length &&
      previous?.nodes.length === view.nodes.length &&
      previous.nodes.every(
        (n, i) => n.id === view.nodes[i]!.id && n.createdAt === view.nodes[i]!.createdAt,
      )
    points = view.nodes.map((n, i) => {
      const kept = old.get(n.id)
      return kept?.createdAt === n.createdAt && kept.point
        ? { ...kept.point }
        : {
            x: Math.cos(i * 2.399963) * Math.sqrt(i + 1) * 24,
            y: Math.sin(i * 2.399963) * Math.sqrt(i + 1) * 24,
          }
    })
    previous = view
    generation++
    pending = null
    failed.value = false
    try {
      worker ??= new Worker(new URL('../workers/team-profile-layout.worker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onerror = () => {
        failed.value = true
        stop()
        terminate()
      }
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const value = parseLayoutReply(event.data)
        if (value === null) {
          failed.value = true
          stop()
          terminate()
          return
        }
        if (value.generation !== generation) return
        if (value.type === 'positions') {
          if (
            !(value.positions instanceof Float64Array) ||
            value.positions.length !== points.length * 2 ||
            value.positions.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e8)
          ) {
            failed.value = true
            terminate()
            return
          }
          if (paused.value || !options.active() || document.hidden) {
            post({ type: 'ack', generation })
            return
          }
          pending = value.positions
          requestDraw()
        } else if (value.type === 'paused') {
          paused.value = true
          requestDraw()
        } else {
          failed.value = true
          terminate()
        }
      }
      post({
        type: 'init',
        generation,
        nodes: points.map((p, i) => ({ ...p, radius: view.radii[i]! })),
        links: view.links.map((l) => ({ ...l })),
        distance: options.controls.distance,
        repulsion: options.controls.repulsion,
        messages: options.controls.proximity === 'messages',
        running: !paused.value && !document.hidden,
        alpha: same ? 0.5 : 0.85,
      })
      if (!same) fit()
      else requestDraw()
    } catch {
      failed.value = true
      terminate()
    }
  }
  function resume(): void {
    if (!options.active() || document.hidden || options.view()?.tooLarge || forcedColors.value)
      return
    paused.value = false
    if (!worker) rebuild()
    post({ type: 'run', generation })
    requestDraw()
  }
  const local = (event: PointerEvent | WheelEvent): Point => {
    const box = options.canvas.value!.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const world = (p: Point): Point => ({
    x: (p.x - transform.x) / transform.k,
    y: (p.y - transform.y) / transform.k,
  })
  function hit(p: Point): number {
    const view = options.view()
    for (const i of [...bins.at(p.x, p.y)].reverse()) {
      const s = screen(points[i]!)
      if (Math.hypot(p.x - s.x, p.y - s.y) <= Math.max(10, (view?.radii[i] ?? 4) * transform.k))
        return i
    }
    return -1
  }
  function down(event: PointerEvent): void {
    if (event.button !== 0) return
    cancelAnimationFrame(animation)
    const p = local(event),
      index = hit(p)
    drag = {
      pointer: event.pointerId,
      index,
      x: index >= 0 ? points[index]!.x - world(p).x : 0,
      y: index >= 0 ? points[index]!.y - world(p).y : 0,
      startX: p.x,
      startY: p.y,
      max: 0,
      panX: transform.x,
      panY: transform.y,
    }
    options.canvas.value!.setPointerCapture(event.pointerId)
    if (index >= 0) {
      const point = points[index]!
      post({ type: 'pin', generation, index, x: point.x, y: point.y, held: true })
    }
  }
  function move(event: PointerEvent): void {
    if (!drag) {
      const index = hit(local(event))
      hovered.value = index >= 0 ? (options.view()?.nodes[index]?.id ?? null) : null
      requestDraw()
      return
    }
    if (drag.pointer !== event.pointerId) return
    const p = local(event)
    drag.max = Math.max(drag.max, Math.hypot(p.x - drag.startX, p.y - drag.startY))
    if (drag.index < 0) {
      transform.x = drag.panX + p.x - drag.startX
      transform.y = drag.panY + p.y - drag.startY
    } else {
      const at = world(p)
      const point = { x: at.x + drag.x, y: at.y + drag.y }
      points[drag.index] = point
      pendingPin = { type: 'pin', generation, index: drag.index, ...point, held: true }
    }
    requestDraw()
  }
  function up(event: PointerEvent): void {
    if (!drag || drag.pointer !== event.pointerId) return
    const chosen =
      drag.index >= 0 && drag.max <= 4 ? options.view()?.nodes[drag.index]?.id : undefined
    endDrag()
    if (chosen) options.select(chosen, options.canvas.value!)
    requestDraw()
  }
  function wheel(event: WheelEvent): void {
    event.preventDefault()
    const p = local(event)
    zoom(Math.exp(-event.deltaY * 0.001), p.x, p.y)
  }
  function key(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      options.close()
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoom(1.2)
    } else if (event.key === '-') {
      event.preventDefault()
      zoom(1 / 1.2)
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault()
      fit()
    }
  }
  const visibility = (): void => {
    if (document.hidden) {
      endDrag()
      stop()
    }
  }
  const motion = (): void => {
    reduced.value = media?.matches ?? false
    stop()
  }
  const contrast = (): void => {
    forcedColors.value = forced?.matches ?? false
    rebuild()
  }
  onMounted(() => {
    media = matchMedia('(prefers-reduced-motion: reduce)')
    forced = matchMedia('(forced-colors: active)')
    reduced.value = media.matches
    forcedColors.value = forced.matches
    paused.value = reduced.value
    media.addEventListener('change', motion)
    forced.addEventListener('change', contrast)
    document.addEventListener('visibilitychange', visibility)
    observer = new ResizeObserver(resize)
    if (options.canvas.value) observer.observe(options.canvas.value)
    theme = new MutationObserver(requestDraw)
    let ancestor: HTMLElement | null = options.canvas.value
    while (ancestor) {
      theme.observe(ancestor, {
        attributes: true,
        attributeFilter: ['style', 'class', 'data-theme', 'data-chat-theme'],
      })
      ancestor = ancestor.parentElement
    }
    resize()
    rebuild()
  })
  watch(
    options.canvas,
    (element) => {
      observer?.disconnect()
      if (element) {
        observer?.observe(element)
        let ancestor: HTMLElement | null = element
        while (ancestor) {
          theme?.observe(ancestor, {
            attributes: true,
            attributeFilter: ['style', 'class', 'data-theme', 'data-chat-theme'],
          })
          ancestor = ancestor.parentElement
        }
        resize()
        rebuild()
      }
    },
    { flush: 'post' },
  )
  watch(
    () => [
      options.view(),
      options.controls.distance,
      options.controls.repulsion,
      options.controls.proximity,
    ],
    rebuild,
  )
  watch(
    () => [options.query(), options.selected(), options.focused(), options.controls.badges],
    requestDraw,
  )
  watch(options.active, (active) => {
    if (!active) {
      endDrag()
      stop()
    } else {
      resize()
      rebuild()
    }
  })
  onScopeDispose(() => {
    terminate()
    observer?.disconnect()
    theme?.disconnect()
    media?.removeEventListener('change', motion)
    forced?.removeEventListener('change', contrast)
    document.removeEventListener('visibilitychange', visibility)
  })
  return {
    paused,
    reduced,
    forcedColors,
    failed,
    hiddenLabels,
    hovered,
    leave: () => {
      hovered.value = null
      requestDraw()
    },
    stop,
    resume,
    fit,
    zoom,
    center,
    down,
    move,
    up,
    cancel: endDrag,
    wheel,
    key,
  }
}
