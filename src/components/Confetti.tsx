import { useEffect, useRef } from 'react'

interface Props {
  onDone: () => void
}

/** Lebanese flag colours, plus a darker green for the cedar. */
const COLOURS = ['#ed1c24', '#ffffff', '#00a651', '#1b7f3b', '#d62828']
const DURATION_MS = 5200
const COUNT = 170

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rot: number
  vr: number
  colour: string
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * A short burst of flag-coloured confetti. Purely decorative: it ignores the pointer, is hidden from
 * screen readers (the result dialog carries the greeting as text) and does not animate for people who
 * asked their device for less motion.
 */
export function Confetti({ onDone }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const reduced = prefersReducedMotion()
    const stop = window.setTimeout(onDone, reduced ? 3500 : DURATION_MS)
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (reduced || !el || !ctx) return () => window.clearTimeout(stop)

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      el.width = window.innerWidth * dpr
      el.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const w = () => window.innerWidth
    const h = () => window.innerHeight
    // Two bursts from the lower corners, then a light shower from the top.
    const pieces: Piece[] = Array.from({ length: COUNT }, (_, i) => {
      const fromLeft = i % 2 === 0
      const burst = i < COUNT * 0.6
      return {
        x: burst ? (fromLeft ? 0 : w()) : Math.random() * w(),
        y: burst ? h() * 0.75 : -20 - Math.random() * h() * 0.3,
        vx: burst ? (fromLeft ? 1 : -1) * (4 + Math.random() * 9) : (Math.random() - 0.5) * 3,
        vy: burst ? -(9 + Math.random() * 11) : 1 + Math.random() * 3,
        size: 6 + Math.random() * 7,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.35,
        colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      }
    })

    const started = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = now - started
      ctx.clearRect(0, 0, w(), h())
      const fade = t > DURATION_MS - 1200 ? Math.max(0, (DURATION_MS - t) / 1200) : 1
      for (const p of pieces) {
        p.vy += 0.22 // gravity
        p.vx *= 0.995
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        ctx.save()
        ctx.globalAlpha = fade
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.colour
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        if (p.colour === '#ffffff') {
          ctx.strokeStyle = 'rgba(0,0,0,0.25)'
          ctx.strokeRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        }
        ctx.restore()
      }
      if (t < DURATION_MS) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      window.clearTimeout(stop)
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [onDone])

  return (
    <div className="celebrate" aria-hidden="true" data-testid="celebration">
      <canvas ref={canvas} className="celebrate-canvas" />
    </div>
  )
}
