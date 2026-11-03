import { useCallback, useEffect, useState } from 'react'
import { getBeirutDate, puzzleNumberFor } from '../../supabase/functions/_shared/beirut'
import { getPastPuzzles } from '../game/api'
import { loadGame, loadPastGame } from '../game/storage'
import type { Puzzle } from '../game/types'
import { Modal } from './Modal'

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; puzzles: Puzzle[] }

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

function prettyDate(dateKey: string): string {
  return dateFormat.format(new Date(`${dateKey}T00:00:00Z`))
}

/** What this device remembers about a puzzle: shown next to its date. */
function progressLabel(dateKey: string, today: boolean): { text: string; tone: 'won' | 'lost' | 'playing' | 'new' } {
  const saved = today ? loadGame(dateKey) : loadPastGame(dateKey)
  if (!saved) return { text: 'Not played', tone: 'new' }
  if (saved.status === 'won') return { text: `Solved ${saved.guesses.length}/6`, tone: 'won' }
  if (saved.status === 'lost') return { text: 'Missed', tone: 'lost' }
  return saved.guesses.length ? { text: `${saved.guesses.length}/6 so far`, tone: 'playing' } : { text: 'Not played', tone: 'new' }
}

interface Props {
  /** The puzzle on screen: a past date, or null for today's. */
  current: string | null
  onPick: (date: string | null) => void
  onClose: () => void
}

/** Today's puzzle plus every earlier one, so a missed day can still be played. */
export function ArchiveModal({ current, onPick, onClose }: Props) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const today = getBeirutDate()

  const fetchList = useCallback(() => {
    setLoad({ kind: 'loading' })
    let cancelled = false
    getPastPuzzles()
      .then((puzzles) => !cancelled && setLoad({ kind: 'ready', puzzles }))
      .catch(() => !cancelled && setLoad({ kind: 'error' }))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => fetchList(), [fetchList])

  function row(dateKey: string, label: string, isToday: boolean) {
    const progress = progressLabel(dateKey, isToday)
    const selected = isToday ? current === null : current === dateKey
    return (
      <li key={dateKey}>
        <button
          type="button"
          className={selected ? 'archive-row current' : 'archive-row'}
          aria-current={selected ? 'true' : undefined}
          onClick={() => onPick(isToday ? null : dateKey)}
        >
          <span className="archive-main">
            <strong>No. {puzzleNumberFor(dateKey)}</strong>
            <span className="archive-date">{label}</span>
          </span>
          <span className={`archive-status ${progress.tone}`}>{progress.text}</span>
        </button>
      </li>
    )
  }

  return (
    <Modal title="Play a past day" onClose={onClose}>
      <div className="modal-body">
        <p>Missed a day? Pick any earlier puzzle. Past days don&apos;t count towards your streak.</p>
        <ul className="archive-list">
          {row(today, `Today, ${prettyDate(today)}`, true)}
          {load.kind === 'ready' && load.puzzles.map((p) => row(p.puzzleDate, prettyDate(p.puzzleDate), false))}
        </ul>
        {load.kind === 'loading' && <p className="community-note">Loading...</p>}
        {load.kind === 'error' && (
          <p className="community-note" role="status">
            Couldn&apos;t load the earlier days.{' '}
            <button type="button" className="link-btn" onClick={fetchList}>
              Try again
            </button>
          </p>
        )}
        {load.kind === 'ready' && load.puzzles.length === 0 && (
          <p className="community-note">There are no earlier days yet. Come back tomorrow!</p>
        )}
      </div>
    </Modal>
  )
}
