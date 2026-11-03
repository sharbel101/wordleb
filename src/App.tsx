import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Board } from './components/Board'
import { Header } from './components/Header'
import { InfoBar } from './components/InfoBar'
import { Keyboard } from './components/Keyboard'
import { StatusPanel } from './components/StatusPanel'
import { Toast } from './components/Toast'
import { WordNudge } from './components/WordNudge'
import { ArchiveModal } from './components/ArchiveModal'
import { buildShareText } from './game/logic'
import { useGame } from './game/useGame'

// Secondary content is split out of the first load; it is fetched when first opened.
const HowToPlayModal = lazy(() => import('./components/HowToPlayModal').then((m) => ({ default: m.HowToPlayModal })))
const StatsModal = lazy(() => import('./components/StatsModal').then((m) => ({ default: m.StatsModal })))
const ResultModal = lazy(() => import('./components/ResultModal').then((m) => ({ default: m.ResultModal })))
const SuggestModal = lazy(() => import('./components/SuggestModal').then((m) => ({ default: m.SuggestModal })))

type ModalName = 'help' | 'stats' | 'suggest' | 'archive' | 'result' | null

const SEEN_HELP_KEY = 'wordleb:seen-help'

function hasSeenHelp(): boolean {
  try {
    return localStorage.getItem(SEEN_HELP_KEY) === '1'
  } catch {
    return true
  }
}

const shortDateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function shortDate(dateKey: string): string {
  return shortDateFormat.format(new Date(`${dateKey}T00:00:00Z`))
}

export default function App() {
  const [modal, setModal] = useState<ModalName>(() => (hasSeenHelp() ? null : 'help'))
  const [suggestSeed, setSuggestSeed] = useState('')
  const game = useGame(modal === null)

  const finished = game.status !== 'playing'

  const closeModal = useCallback(() => {
    setModal((m) => {
      if (m === 'help') {
        try {
          localStorage.setItem(SEEN_HELP_KEY, '1')
        } catch {
          /* ignore */
        }
      }
      return null
    })
  }, [])

  // Open the result once the final row has finished flipping.
  useEffect(() => {
    if (!finished || !game.settled || game.restoredFinished) return
    const id = window.setTimeout(() => setModal('result'), 900)
    return () => window.clearTimeout(id)
  }, [finished, game.settled, game.restoredFinished])

  const shareText =
    finished && game.puzzle ? buildShareText(game.results, game.status, game.puzzle.puzzleNumber) : null

  const { loadState } = game

  return (
    <div className="app">
      <Header
        onHelp={() => setModal('help')}
        onArchive={() => setModal('archive')}
        onStats={() => setModal('stats')}
        onSuggest={() => {
          setSuggestSeed('')
          setModal('suggest')
        }}
      />
      <InfoBar
        attemptsLeft={game.attemptsLeft}
        puzzleNumber={game.puzzle?.puzzleNumber ?? null}
        finished={finished && game.settled}
        onViewResult={() => setModal('result')}
        past={
          game.archive && game.puzzle
            ? { label: shortDate(game.puzzle.puzzleDate), onBackToToday: () => game.playDate(null) }
            : null
        }
      />
      <Toast toast={game.toast} />
      {game.unknownGuess && modal === null && (
        <WordNudge
          word={game.unknownGuess}
          onSuggest={() => {
            setSuggestSeed(game.unknownGuess ?? '')
            game.dismissUnknownGuess()
            setModal('suggest')
          }}
          onDismiss={game.dismissUnknownGuess}
        />
      )}
      {/* Announces each scored guess and the final result to screen readers. */}
      <div className="sr-only" role="status" aria-live="polite">
        {game.announcement}
      </div>

      <main className="stage" aria-busy={loadState.kind === 'loading'}>
        {loadState.kind === 'error' && (
          <StatusPanel title="Connection problem" message={loadState.message} onRetry={game.retry} />
        )}
        {loadState.kind === 'no-puzzle' && (
          <StatusPanel
            title="No puzzle today"
            message="Today's word isn't ready yet. Please check back in a little while."
            onRetry={game.retry}
          />
        )}
        {(loadState.kind === 'loading' || loadState.kind === 'ready') && (
          <div className={loadState.kind === 'loading' ? 'board-wrap loading' : 'board-wrap'}>
            <Board
              guesses={game.guesses}
              results={game.results}
              current={game.current}
              revealingRow={game.revealingRow}
              shakeKey={game.shakeKey}
              celebrate={game.status === 'won' && game.settled && !game.restoredFinished}
              lose={game.status === 'lost' && game.settled && !game.restoredFinished}
              pending={game.submitting}
              playing={game.status === 'playing'}
            />
          </div>
        )}
      </main>

      <Keyboard
        keyStates={game.keyStates}
        onKey={game.addLetter}
        onEnter={game.submit}
        onBackspace={game.backspace}
      />

      <Suspense fallback={null}>
      {modal === 'help' && <HowToPlayModal onClose={closeModal} />}
      {modal === 'archive' && (
        <ArchiveModal
          current={game.archive ? (game.puzzle?.puzzleDate ?? null) : null}
          onPick={(date) => {
            game.playDate(date)
            closeModal()
          }}
          onClose={closeModal}
        />
      )}
      {modal === 'suggest' && <SuggestModal onClose={closeModal} initialWord={suggestSeed} />}
      {modal === 'stats' && (
        <StatsModal
          stats={game.stats}
          shareText={shareText}
          highlight={game.status === 'won' && !game.archive ? game.guesses.length : null}
          onClose={closeModal}
        />
      )}
      {modal === 'result' && finished && shareText && game.answer && (
        <ResultModal
          answer={game.answer}
          status={game.status}
          attempts={game.guesses.length}
          shareText={shareText}
          onStats={() => setModal('stats')}
          onClose={closeModal}
        />
      )}
      </Suspense>
    </div>
  )
}
