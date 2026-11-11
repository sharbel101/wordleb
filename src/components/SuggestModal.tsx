import { useState, type FormEvent } from 'react'
import { ApiError, submitSuggestion } from '../game/api'
import { ARABIZI_DIGITS, WORD_LENGTH, isWellFormedGuess } from '../game/logic'
import { MAX_DIGITS } from '../../supabase/functions/_shared/validate'
import { Modal } from './Modal'

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.kind) {
      case 'network':
        return "Couldn't reach the server. Check your connection and try again."
      case 'config':
        return 'The game is not connected to Supabase yet.'
      case 'invalid':
      case 'rate_limited':
      case 'already_exists':
      case 'already_suggested':
        return err.message
    }
  }
  return 'Something went wrong. Please try again.'
}

export function SuggestModal({ onClose, initialWord = '' }: { onClose: () => void; initialWord?: string }) {
  // Never more than five characters, however the text arrives (typing, paste, autocorrect, voice).
  const [word, setWord] = useState(initialWord.slice(0, WORD_LENGTH))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const clean = word.trim().toLowerCase()
    if (!isWellFormedGuess(clean)) {
      setError(`Use exactly ${WORD_LENGTH} characters: letters a-z or the digits ${ARABIZI_DIGITS.join(', ')}, with at most ${MAX_DIGITS} numbers.`)
      return
    }

    setBusy(true)
    try {
      await submitSuggestion({ word: clean })
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Suggest a word" onClose={onClose}>
      {sent ? (
        <div className="modal-body">
          <p>
            Merci! <strong>{word.trim().toUpperCase()}</strong> is on the list for review.
          </p>
          <div className="modal-footer">
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="modal-body form" onSubmit={onSubmit} noValidate>
          <p>Know a great Lebanese word? Type how you&apos;d write it in Arabizi. That&apos;s all we need.</p>
          <label>
            Word ({WORD_LENGTH} characters)
            <input
              value={word}
              onChange={(e) => {
                // maxLength alone is not enough: some mobile keyboards insert past it.
                setWord(e.target.value.slice(0, WORD_LENGTH))
                setError('')
              }}
              maxLength={WORD_LENGTH}
              placeholder="e.g. yalla"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'suggest-error' : undefined}
            />
          </label>
          {error && (
            <p id="suggest-error" className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Sending...' : 'Suggest it'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
