import { MAX_ATTEMPTS } from '../game/logic'
import { useCountdown } from '../game/useCountdown'

interface Props {
  attemptsLeft: number
  puzzleNumber: number | null
  finished: boolean
  onViewResult: () => void
}

export function InfoBar({ attemptsLeft, puzzleNumber, finished, onViewResult }: Props) {
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
        <span className="info-label">{puzzleNumber ? `No. ${puzzleNumber}` : ' '}</span>
        <span className="info-label">
          Next word <time className="countdown">{countdown}</time>
        </span>
      </div>
    </div>
  )
}
