import { useEffect, useState } from 'react'
import { formatCountdown, msUntilNextPuzzle } from './logic'

/** Live HH:MM:SS until the next daily puzzle. Reloads the page at rollover. */
export function useCountdown(): string {
  const [remaining, setRemaining] = useState(() => msUntilNextPuzzle())

  useEffect(() => {
    const id = window.setInterval(() => {
      const ms = msUntilNextPuzzle()
      setRemaining(ms)
      if (ms <= 1000) window.setTimeout(() => window.location.reload(), 1100)
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  return formatCountdown(remaining)
}
