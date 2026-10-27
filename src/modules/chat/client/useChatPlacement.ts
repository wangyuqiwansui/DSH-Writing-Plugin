import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'

interface Point { x: number; y: number }
interface Drag { id: number; start: Point; origin: Point; previous: Point | null; handle: HTMLElement }

/** Coordinates belong to the positioned content region, never the host window or chat data. */
function constrain(point: Point, panel: HTMLElement): Point {
  const container = panel.parentElement
  if (!container) return point
  const limit = (value: number, available: number) => {
    const margin = Math.min(8, Math.max(0, available / 2))
    return Math.min(Math.max(margin, value), Math.max(margin, available - margin))
  }
  return { x: limit(point.x, container.clientWidth - panel.offsetWidth), y: limit(point.y, container.clientHeight - panel.offsetHeight) }
}
function origin(panel: HTMLElement): Point {
  const rect = panel.getBoundingClientRect(), parent = panel.parentElement!.getBoundingClientRect()
  return { x: rect.left - parent.left, y: rect.top - parent.top }
}

/** Local presentation state; closing retains placement, unmounting resets to fixed. */
export function useChatPlacement(open: boolean) {
  const panel = useRef<HTMLElement>(null), drag = useRef<Drag | null>(null)
  const [fixed, setFixed] = useState(true), [position, setPosition] = useState<Point | null>(null), [dragging, setDragging] = useState(false)
  const release = useCallback(() => {
    const current = drag.current
    drag.current = null
    if (current?.handle.hasPointerCapture(current.id)) current.handle.releasePointerCapture(current.id)
  }, [])
  const finish = useCallback(() => { release(); setDragging(false) }, [release])
  const cancelDrag = useCallback(() => {
    const current = drag.current
    if (!current) return false
    setPosition(current.previous && panel.current ? constrain(current.previous, panel.current) : current.previous)
    finish(); return true
  }, [finish])
  useLayoutEffect(() => {
    setDragging(false)
    const element = panel.current, container = element?.parentElement
    if (!open || !element || !container) return
    const keepVisible = () => setPosition(current => {
      if (!current) return current
      const next = constrain(current, element)
      return next.x === current.x && next.y === current.y ? current : next
    })
    keepVisible()
    const observer = new ResizeObserver(keepVisible)
    observer.observe(container); observer.observe(element)
    window.addEventListener('blur', finish)
    return () => { observer.disconnect(); window.removeEventListener('blur', finish); release() }
  }, [open, finish, release])

  const toggleFixed = () => { finish(); setPosition(null); setFixed(value => !value) }
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0 || drag.current || (event.target as Element).closest('button')) return
    event.preventDefault()
    if (fixed || !panel.current) return
    drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: origin(panel.current), previous: position, handle: event.currentTarget }
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId || !panel.current) return
    event.preventDefault()
    setPosition(constrain({ x: current.origin.x + event.clientX - current.start.x, y: current.origin.y + event.clientY - current.start.y }, panel.current))
  }
  const onPointerUp = (event: PointerEvent<HTMLElement>) => { if (drag.current?.id === event.pointerId) finish() }
  const onPointerCancel = (event: PointerEvent<HTMLElement>) => { if (drag.current?.id === event.pointerId) cancelDrag() }
  const onMoveKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (fixed || drag.current || !panel.current || event.altKey || event.ctrlKey || event.metaKey) return
    const directions: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }
    const direction = directions[event.key]
    if (!direction) return
    event.preventDefault(); event.stopPropagation()
    const current = origin(panel.current), step = event.shiftKey ? 40 : 10
    setPosition(constrain({ x: current.x + direction.x * step, y: current.y + direction.y * step }, panel.current))
  }
  const style: CSSProperties | undefined = position ? { left: position.x, top: position.y, right: 'auto' } : undefined
  return { panel, fixed, dragging, style, toggleFixed, cancelDrag, onMoveKeyDown,
    headerEvents: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerUp },
  }
}
