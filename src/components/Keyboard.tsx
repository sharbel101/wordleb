import { memo, type MouseEvent } from 'react'
import { Delete } from 'lucide-react'
import { ARABIZI_DIGITS, ARABIZI_HINTS, type TileState } from '../game/logic'

interface Props {
  keyStates: Record<string, TileState>
  onKey: (ch: string) => void
  onEnter: () => void
  onBackspace: () => void
}

const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

// Memoised: it only re-renders when a key colour changes, not on every typed letter.
export const Keyboard = memo(function Keyboard({ keyStates, onKey, onEnter, onBackspace }: Props) {
  // Keep focus off mouse/touch-pressed keys so a physical Enter never re-clicks them.
  const noFocus = (e: MouseEvent) => e.preventDefault()

  function charKey(ch: string, hint?: string) {
    const state = keyStates[ch]
    return (
      <button
        key={ch}
        type="button"
        className={`key ${state ?? ''}`}
        onMouseDown={noFocus}
        onClick={() => onKey(ch)}
        aria-label={`${ch}${state ? `, ${state}` : ''}`}
      >
        {ch.toUpperCase()}
        {hint && (
          <span className="key-hint" aria-hidden="true">
            {hint}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="keyboard" aria-label="Keyboard">
      <div className="key-row key-row-digits">
        {ARABIZI_DIGITS.map((d) => charKey(d, ARABIZI_HINTS[d]))}
      </div>
      <div className="key-row">{[...LETTER_ROWS[0]].map((c) => charKey(c))}</div>
      <div className="key-row">
        <span className="key-spacer" />
        {[...LETTER_ROWS[1]].map((c) => charKey(c))}
        <span className="key-spacer" />
      </div>
      <div className="key-row">
        <button type="button" className="key key-wide" onMouseDown={noFocus} onClick={onEnter}>
          Enter
        </button>
        {[...LETTER_ROWS[2]].map((c) => charKey(c))}
        <button
          type="button"
          className="key key-wide"
          onMouseDown={noFocus}
          onClick={onBackspace}
          aria-label="Backspace"
        >
          <Delete size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
})
