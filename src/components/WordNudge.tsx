import { X } from 'lucide-react'

interface Props {
  word: string
  onSuggest: () => void
  onDismiss: () => void
}

/**
 * Shown after the server scored a guess it did not recognise. The guess still counted, so this
 * is only an invitation to add the word to the dictionary, never a warning.
 */
export function WordNudge({ word, onSuggest, onDismiss }: Props) {
  return (
    <div className="nudge" role="status">
      <span>
        <strong>{word.toUpperCase()}</strong> isn&apos;t in our word list yet.
      </span>
      <button type="button" className="nudge-action" onClick={onSuggest}>
        Suggest it
      </button>
      <button type="button" className="icon-btn nudge-close" onClick={onDismiss} aria-label="Dismiss">
        <X size={18} />
      </button>
    </div>
  )
}
