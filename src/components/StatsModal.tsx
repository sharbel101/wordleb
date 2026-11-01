import { useCountdown } from '../game/useCountdown'
import type { Stats } from '../game/storage'
import { Modal } from './Modal'
import { ShareButton } from './ShareButton'

interface Props {
  stats: Stats
  shareText: string | null
  highlight: number | null
  onClose: () => void
}

export function StatsModal({ stats, shareText, highlight, onClose }: Props) {
  const countdown = useCountdown()
  const winRate = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0
  const max = Math.max(1, ...stats.distribution)

  const summary = [
    { label: 'Played', value: stats.played },
    { label: 'Win %', value: winRate },
    { label: 'Streak', value: stats.currentStreak },
    { label: 'Best', value: stats.maxStreak },
  ]

  return (
    <Modal title="Statistics" onClose={onClose}>
      <div className="modal-body">
        <div className="stat-grid">
          {summary.map((s) => (
            <div key={s.label} className="stat">
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </div>
          ))}
        </div>

        <h3>Guess distribution</h3>
        <div className="dist">
          {stats.distribution.map((count, i) => (
            <div key={i} className="dist-row">
              <span className="dist-n">{i + 1}</span>
              <div className="dist-track">
                <div
                  className={`dist-bar ${highlight === i + 1 ? 'hl' : ''}`}
                  style={{ width: `${Math.max(8, (count / max) * 100)}%` }}
                >
                  {count}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <div className="next-word">
            <span>Next word in</span>
            <strong className="countdown">{countdown}</strong>
          </div>
          {shareText && <ShareButton text={shareText} />}
        </div>
      </div>
    </Modal>
  )
}
