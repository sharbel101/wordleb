import { useCallback, useEffect, useState } from 'react'
import { getCommunityStats, type CommunityBucket, type CommunityStats as Stats } from '../game/api'

type Scope = 'today' | 'allTime'

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; stats: Stats }

/**
 * Anonymous totals across everyone who plays: how many people solved the puzzle in 1, 2, ... 6
 * guesses. Shown inside the Statistics window and loaded only when it is opened.
 */
export function CommunityStats() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [scope, setScope] = useState<Scope>('today')

  const fetchStats = useCallback(() => {
    setLoad({ kind: 'loading' })
    let cancelled = false
    getCommunityStats()
      .then((stats) => !cancelled && setLoad({ kind: 'ready', stats }))
      .catch(() => !cancelled && setLoad({ kind: 'error' }))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => fetchStats(), [fetchStats])

  return (
    <section className="community" aria-labelledby="community-title">
      <div className="community-head">
        <h3 id="community-title">All players</h3>
        <div className="segmented" role="group" aria-label="Time range">
          {(['today', 'allTime'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}>
              {s === 'today' ? 'Today' : 'All time'}
            </button>
          ))}
        </div>
      </div>

      {load.kind === 'loading' && <p className="community-note">Loading...</p>}
      {load.kind === 'error' && (
        <p className="community-note" role="status">
          Community stats aren&apos;t available right now.{' '}
          <button type="button" className="link-btn" onClick={fetchStats}>
            Try again
          </button>
        </p>
      )}
      {load.kind === 'ready' && <Distribution bucket={load.stats[scope]} scope={scope} />}
    </section>
  )
}

function Distribution({ bucket, scope }: { bucket: CommunityBucket; scope: Scope }) {
  if (bucket.players === 0) {
    return (
      <p className="community-note">
        {scope === 'today' ? "Nobody has finished today's puzzle yet." : 'Nobody has finished a puzzle yet.'}
      </p>
    )
  }

  const rows = [...bucket.solved.map((count, i) => ({ label: String(i + 1), count })), { label: 'X', count: bucket.missed }]
  const max = Math.max(1, ...rows.map((r) => r.count))

  return (
    <>
      <p className="community-note">
        <strong>{bucket.players}</strong> {bucket.players === 1 ? 'player' : 'players'} finished
        {scope === 'today' ? ' today' : ''}
      </p>
      <div className="dist" role="list" aria-label="Players by number of guesses">
        {rows.map((r) => (
          <div
            key={r.label}
            className="dist-row"
            role="listitem"
            aria-label={`${r.label === 'X' ? 'Did not solve' : `Solved in ${r.label}`}: ${r.count} ${r.count === 1 ? 'player' : 'players'}`}
          >
            <span className="dist-n" aria-hidden="true">
              {r.label}
            </span>
            <div className="dist-track" aria-hidden="true">
              <div className={r.label === 'X' ? 'dist-bar miss' : 'dist-bar'} style={{ width: `${Math.max(8, (r.count / max) * 100)}%` }}>
                {r.count}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
