import { MAX_ATTEMPTS } from '../game/logic'
import { useCountdown } from '../game/useCountdown'

interface Props {
  attemptsLeft: number
  puzzleNumber: number | null
  finished: boolean
  onViewResult: () => void
  /** Set while replaying a past puzzle: its date label, and a way back to today's. */
  past: { label: string; onBackToToday: () => void } | null
}

export function InfoBar({ attemptsLeft, puzzleNumber, finished, onViewResult, past }: Props) {
  const countdown = useCountdown()
  const used = MAX_ATTEMPTS - attemptsLeft

  return (
    <div className="info-bar">
      <div className="info-block">
        <div
          className="pips"
          role="img"
          aria-label={`${attemptsLeft} of ${MAX_ATTEMPTS} attempts remaining`}
        >
          {Array.from({ length: MAX_ATTEMPTS }, (_, i) => (
            <span key={i} className={i < used ? 'pip used' : 'pip'} />
          ))}
        </div>
        <span className="info-label">
          {finished ? (
            <button className="link-btn" onClick={onViewResult}>
              View result
            </button>
          ) : (
            `${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left`
          )}
        </span>
      </div>
      <div className="info-block info-block-end">
        <span className="info-label">
          {puzzleNumber ? `No. ${puzzleNumber}` : '\u00a0'}
          {past && <span className="info-past"> · {past.label}</span>}
        </span>
        <span className="info-label">
          {past ? (
            <button className="link-btn" onClick={past.onBackToToday}>
              Back to today
            </button>
          ) : (
            <>
              Next word <time className="countdown">{countdown}</time>
            </>
          )}
        </span>
      </div>
    </div>
  )
}
