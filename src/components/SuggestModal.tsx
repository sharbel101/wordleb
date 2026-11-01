import { useState, type FormEvent } from 'react'
import { ApiError, submitSuggestion } from '../game/api'
import { ARABIZI_DIGITS, WORD_LENGTH, isWellFormedGuess } from '../game/logic'
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

export function SuggestModal({ onClose }: { onClose: () => void }) {
  const [word, setWord] = useState('')
  const [meaning, setMeaning] = useState('')
  const [arabic, setArabic] = useState('')
  const [example, setExample] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const clean = word.trim().toLowerCase()
    if (!isWellFormedGuess(clean)) {
      setError(`Use exactly ${WORD_LENGTH} characters: letters a-z or the digits ${ARABIZI_DIGITS.join(', ')}.`)
      return
    }
    if (meaning.trim().length < 2) {
      setError('Please tell us what the word means.')
      return
    }

    setBusy(true)
    try {
      await submitSuggestion({
        word: clean,
        meaning: meaning.trim(),
        arabicSpelling: arabic.trim(),
        exampleSentence: example.trim(),
      })
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
          <p>Know a great Lebanese word? Tell us how you&apos;d write it in Arabizi.</p>
          <label>
            Word ({WORD_LENGTH} characters)
            <input
              value={word}
              onChange={(e) => {
                setWord(e.target.value)
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
          <label>
            Meaning
            <input
              value={meaning}
              onChange={(e) => {
                setMeaning(e.target.value)
                setError('')
              }}
              maxLength={200}
              placeholder="What does it mean?"
              autoComplete="off"
            />
          </label>
          <label>
            Arabic spelling (optional)
            <input
              value={arabic}
              onChange={(e) => setArabic(e.target.value)}
              maxLength={40}
              lang="ar"
              dir="rtl"
              placeholder="يلا"
              autoComplete="off"
            />
          </label>
          <label>
            Example sentence (optional)
            <textarea
              value={example}
              onChange={(e) => setExample(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Use it in a sentence"
            />
          </label>
          {error && (
            <p id="suggest-error" className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Sending...' : 'Send suggestion'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
