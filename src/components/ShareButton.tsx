import { useEffect, useRef, useState } from 'react'
import { Check, Share2 } from 'lucide-react'
import { shareResult, type ShareOutcome } from '../game/share'

export function ShareButton({ text }: { text: string }) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null)
  const timer = useRef<number>(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function share() {
    const result = await shareResult(text)
    if (result === 'cancelled') return
    setOutcome(result)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOutcome(null), 2500)
  }

  const copied = outcome === 'copied'
  const message =
    outcome === 'copied'
      ? 'Result copied. Paste it anywhere!'
      : outcome === 'shared'
        ? 'Shared!'
        : outcome === 'failed'
          ? "Couldn't copy. Please try again."
          : ''

  return (
    <>
      <button className="btn btn-primary" onClick={share}>
        {copied ? <Check size={18} aria-hidden="true" /> : <Share2 size={18} aria-hidden="true" />}
        {copied ? 'Copied' : 'Share'}
      </button>
      <span className="sr-only" role="status">
        {message}
      </span>
      {message && (
        <span className="share-note" aria-hidden="true">
          {message}
        </span>
      )}
    </>
  )
}
