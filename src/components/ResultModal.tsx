import type { GameStatus } from '../game/logic'
import type { AnswerInfo } from '../game/types'
import { useCountdown } from '../game/useCountdown'
import { Modal } from './Modal'
import { ShareButton } from './ShareButton'

interface Props {
  answer: AnswerInfo
  status: GameStatus
  attempts: number
  shareText: string
  onStats: () => void
  onClose: () => void
}

export function ResultModal({ answer, status, attempts, shareText, onStats, onClose }: Props) {
  const countdown = useCountdown()
  const won = status === 'won'

  return (
    <Modal title={won ? 'You got it' : 'Not this time'} onClose={onClose}>
      <div className="modal-body result">
        <p className="result-lead">
          {won
            ? `Solved in ${attempts} ${attempts === 1 ? 'try' : 'tries'}.`
            : "Tomorrow's a new word. Today's was:"}
        </p>

        <div className="result-word" aria-label={`The word was ${answer.word}`}>
          {[...answer.word].map((ch, i) => (
            <div key={i} className="tile filled mini correct">
              {ch.toUpperCase()}
            </div>
          ))}
        </div>

        {answer.arabic && (
          <p className="result-arabic" lang="ar" dir="rtl">
            {answer.arabic}
          </p>
        )}
        {answer.meaning && <p className="result-meaning">{answer.meaning}</p>}
        {answer.example && (
          <blockquote className="result-example">
            <p>{answer.example}</p>
            {answer.translation && <p className="result-translation">{answer.translation}</p>}
          </blockquote>
        )}

        <div className="modal-footer">
          <div className="next-word">
            <span>Next word in</span>
            <strong className="countdown">{countdown}</strong>
          </div>
          <div className="btn-group">
            <button className="btn" onClick={onStats}>
              Stats
            </button>
            <ShareButton text={shareText} />
          </div>
        </div>
      </div>
    </Modal>
  )
}
