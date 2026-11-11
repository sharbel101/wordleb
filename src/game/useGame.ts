import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBeirutDate, puzzleNumberFor } from '../../supabase/functions/_shared/beirut'
import { ApiError, getDailyPuzzle, submitGuess } from './api'
import {
  MAX_ATTEMPTS,
  WORD_LENGTH,
  describeGuess,
  getKeyStates,
  isValidChar,
  type GameStatus,
  type TileState,
} from './logic'
import {
  clearCachedPuzzle,
  getPlayerId,
  loadCachedPuzzle,
  loadGame,
  loadPastGame,
  loadStats,
  recordResult,
  saveCachedPuzzle,
  saveGame,
  savePastGame,
} from './storage'
import type { AnswerInfo, Puzzle } from './types'
import { validateGuess } from './validateGuess'

/** Matches the CSS flip animation: per-tile stagger plus the flip itself. */
const REVEAL_MS = (WORD_LENGTH - 1) * 300 + 600
/** With reduced motion the tiles change instantly, so don't make the player wait. */
const REDUCED_REVEAL_MS = 200

const WIN_MESSAGES = ['Ya salam!', 'Bravo!', 'Mabrouk!', 'Helo!', 'Mnih!', 'Bel zabet!']

export interface Toast {
  id: number
  text: string
}

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'no-puzzle' }
  | { kind: 'error'; message: string }

function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'config') return 'The game is not connected to Supabase yet. Check the environment variables.'
    if (err.kind === 'network') return "Can't reach the server. Check your connection and try again."
  }
  return "Something went wrong loading today's puzzle. Please try again."
}

function revealDelay(): number {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return reduced ? REDUCED_REVEAL_MS : REVEAL_MS
}

export function useGame(inputEnabled: boolean) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null)
  /** null = today's puzzle; a date = replaying that past puzzle. */
  const [viewDate, setViewDate] = useState<string | null>(null)

  const [guesses, setGuesses] = useState<string[]>([])
  const [results, setResults] = useState<TileState[][]>([])
  const [status, setStatus] = useState<GameStatus>('playing')
  const [answer, setAnswer] = useState<AnswerInfo | null>(null)
  const [stateToken, setStateToken] = useState<string | null>(null)
  const [restoredFinished, setRestoredFinished] = useState(false)
  const [current, setCurrent] = useState('')
  // Rows already revealed. A restored game starts fully revealed (no animation).
  const [revealedCount, setRevealedCount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [stats, setStats] = useState(loadStats)
  const [shakeKey, setShakeKey] = useState(0)
  const [toast, setToast] = useState<Toast | null>(null)
  const [announcement, setAnnouncement] = useState('')
  /** A guess the server accepted but did not recognise: we offer to suggest it. */
  const [unknownGuess, setUnknownGuess] = useState<string | null>(null)

  const timers = useRef<number[]>([])
  const toastId = useRef(0)
  /** Synchronous guard: state updates are async, so two quick Enters could both pass `canType`. */
  const inFlight = useRef(false)
  const loadedAt = useRef(Date.now())
  /** The puzzle on screen. A slow response or timer for a puzzle we have since left must not touch the board. */
  const activeDate = useRef<string | null>(null)

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(window.clearTimeout)
  }, [])

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  const showToast = useCallback(
    (text: string, ms = 1600) => {
      const id = ++toastId.current
      setToast({ id, text })
      later(() => setToast((t) => (t?.id === id ? null : t)), ms)
    },
    [later],
  )

  // Load the puzzle on screen (today's, or a past one being replayed) and restore local progress.
  useEffect(() => {
    let cancelled = false
    const today = getBeirutDate()

    function start(p: Puzzle) {
      const saved = viewDate ? loadPastGame(p.puzzleDate) : loadGame(p.puzzleDate)
      activeDate.current = p.puzzleDate
      setUnknownGuess(null)
      setAnnouncement('')
      setStats(loadStats())
      setPuzzle(p)
      setGuesses(saved?.guesses ?? [])
      setResults(saved?.results ?? [])
      setStatus(saved?.status ?? 'playing')
      setAnswer(saved?.answer ?? null)
      setStateToken(saved?.stateToken ?? null)
      setRevealedCount(saved?.guesses.length ?? 0)
      setRestoredFinished(!!saved && saved.status !== 'playing')
      setCurrent('')
      loadedAt.current = Date.now()
      setLoadState({ kind: 'ready' })
    }

    // A past puzzle needs no lookup: its number follows from its date, and the server checks the rest.
    if (viewDate) {
      start({ puzzleDate: viewDate, puzzleNumber: puzzleNumberFor(viewDate) })
      return
    }

    // Same-day reloads skip the network entirely (the metadata is not secret).
    const cached = loadCachedPuzzle(today)
    if (cached) {
      start(cached)
      return
    }

    setLoadState({ kind: 'loading' })
    getDailyPuzzle()
      .then((p) => {
        if (cancelled) return
        saveCachedPuzzle(p)
        start(p)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.kind === 'no_puzzle') {
          setLoadState({ kind: 'no-puzzle' })
        } else if (err instanceof ApiError && err.kind === 'network' && loadGame(today)) {
          // Offline, but this device already has today's game: let the player view it.
          start({ puzzleDate: today, puzzleNumber: puzzleNumberFor(today) })
          showToast("You're offline. Showing your saved game.", 3000)
        } else {
          setLoadState({ kind: 'error', message: loadErrorMessage(err) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [loadAttempt, viewDate, showToast])

  const retry = useCallback(() => setLoadAttempt((n) => n + 1), [])

  // Reconnect automatically after an error screen.
  const errored = loadState.kind === 'error'
  useEffect(() => {
    if (!errored) return
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [errored, retry])

  // A tab left open past Beirut midnight must not keep playing yesterday's puzzle.
  const puzzleDate = puzzle?.puzzleDate
  const archive = viewDate !== null
  useEffect(() => {
    if (!puzzleDate || archive) return
    function check() {
      const stale = getBeirutDate() > puzzleDate!
      // The 60s guard stops a badly wrong device clock from reloading on every tab switch.
      if (document.visibilityState === 'visible' && stale && Date.now() - loadedAt.current > 60_000) {
        window.location.reload()
      }
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [puzzleDate, archive])

  const revealing = revealedCount < guesses.length
  const canType = inputEnabled && loadState.kind === 'ready' && status === 'playing' && !revealing && !submitting

  const addLetter = useCallback(
    (ch: string) => {
      if (!canType || !isValidChar(ch)) return
      setUnknownGuess(null)
      setCurrent((c) => (c.length < WORD_LENGTH ? c + ch.toLowerCase() : c))
    },
    [canType],
  )

  const backspace = useCallback(() => {
    if (!canType) return
    setCurrent((c) => c.slice(0, -1))
  }, [canType])

  const reject = useCallback(
    (text: string) => {
      setShakeKey((k) => k + 1)
      showToast(text)
    },
    [showToast],
  )

  /** Discards this puzzle's local progress (never statistics) and starts it over. */
  const resetGame = useCallback((dateKey: string, past: boolean) => {
    setGuesses([])
    setResults([])
    setStatus('playing')
    setAnswer(null)
    setStateToken(null)
    setRevealedCount(0)
    setCurrent('')
    const blank = { dateKey, guesses: [], results: [], status: 'playing' as const, answer: null, stateToken: null }
    if (past) savePastGame(blank)
    else saveGame(blank)
  }, [])

  const submit = useCallback(async () => {
    if (inFlight.current || !canType || !puzzle) return

    // Cheap local checks first: nonsense never costs a network round trip.
    const check = validateGuess(current, guesses)
    if (!check.valid) return reject(check.error)
    const guess = check.normalizedGuess.toLowerCase()

    const dateAtSubmit = puzzle.puzzleDate
    const past = archive
    const stillHere = () => activeDate.current === dateAtSubmit

    inFlight.current = true
    setSubmitting(true)
    try {
      const res = await submitGuess({
        guess,
        stateToken,
        puzzleDate: dateAtSubmit,
        archive: past,
        playerId: getPlayerId(),
      })
      // The player moved to another puzzle while this was in flight: leave the board alone.
      if (!stillHere()) return
      // Not an approved word: no attempt is spent and the row stays editable.
      if (!res.valid) return reject('Not in word list')

      // A spelling variant is scored (and shown) in its canonical spelling, so the tiles describe
      // exactly the letters on the board.
      const played = res.canonical ?? guess
      const nextGuesses = [...guesses, played]
      const nextResults = [...results, res.result]
      const nextStatus: GameStatus = res.won ? 'won' : res.lost ? 'lost' : 'playing'
      const nextAnswer = res.answer ?? answer
      const nextToken = res.stateToken

      setGuesses(nextGuesses)
      setResults(nextResults)
      setStatus(nextStatus)
      setAnswer(nextAnswer)
      setStateToken(nextToken)
      setCurrent('')
      const saved = {
        dateKey: dateAtSubmit,
        guesses: nextGuesses,
        results: nextResults,
        status: nextStatus,
        answer: nextAnswer,
        stateToken: nextToken,
      }
      if (past) savePastGame(saved)
      else saveGame(saved)

      // Persist stats now (survives a refresh mid-animation) but show them after the reveal.
      // Replaying a past puzzle never touches streaks or totals.
      const finishedNow = nextStatus !== 'playing'
      const nextStats = finishedNow && !past ? recordResult(dateAtSubmit, nextStatus === 'won', nextGuesses.length) : null

      // Offer to suggest the word once its tiles have been revealed, and tidy the prompt away later.
      if (!res.known) {
        later(() => stillHere() && setUnknownGuess(played), revealDelay())
        later(() => setUnknownGuess((g) => (g === played ? null : g)), revealDelay() + 10_000)
      }

      later(() => {
        if (!stillHere()) return
        setRevealedCount(nextGuesses.length)
        const summary = describeGuess(played, res.result, nextGuesses.length)
        if (!finishedNow) {
          setAnnouncement(summary)
          return
        }
        if (nextStats) setStats(nextStats)
        setAnnouncement(
          nextStatus === 'won'
            ? `${summary} You solved it in ${nextGuesses.length} ${nextGuesses.length === 1 ? 'try' : 'tries'}.`
            : `${summary} Out of tries. The word was ${(nextAnswer?.word ?? '').toUpperCase()}.`,
        )
        showToast(
          nextStatus === 'won' ? WIN_MESSAGES[nextGuesses.length - 1] : (nextAnswer?.word ?? '').toUpperCase(),
          2200,
        )
      }, revealDelay())
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'puzzle_changed') {
        clearCachedPuzzle()
        showToast('A new puzzle is ready. Refreshing...', 2500)
        later(() => window.location.reload(), 1500)
      } else if (err instanceof ApiError && err.kind === 'bad_state') {
        // The saved session can no longer be verified (e.g. it predates an update). Start this
        // puzzle over rather than leave the player stuck; finished games never reach this path.
        resetGame(dateAtSubmit, past)
        showToast('Your saved game could not be resumed. Starting over.', 3500)
      } else if (err instanceof ApiError && err.kind === 'no_puzzle') {
        showToast("That puzzle isn't available right now.", 2500)
      } else {
        showToast("Couldn't reach the server. Try again.", 2500)
      }
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }, [canType, puzzle, archive, current, guesses, results, answer, stateToken, reject, later, showToast, resetGame])

  const submitNow = useCallback(() => void submit(), [submit])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      if (e.key === 'Enter') {
        // A focused button handles Enter itself via its click event.
        if (target?.tagName === 'BUTTON') return
        submitNow()
      } else if (e.key === 'Backspace') {
        backspace()
      } else if (e.key.length === 1) {
        addLetter(e.key.toLowerCase())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addLetter, backspace, submitNow])

  const revealedGuesses = useMemo(() => guesses.slice(0, revealedCount), [guesses, revealedCount])
  const keyStates = useMemo(() => getKeyStates(revealedGuesses, results), [revealedGuesses, results])

  return {
    loadState,
    retry,
    puzzle,
    /** True while replaying a past puzzle (it does not count towards streaks or stats). */
    archive,
    /** Switch to a past puzzle by date, or back to today with null. Ignored while a guess is being scored. */
    playDate: (date: string | null) => {
      if (inFlight.current) return
      setViewDate(date)
    },
    answer,
    guesses,
    results,
    current,
    status,
    stats,
    keyStates,
    shakeKey,
    toast,
    announcement,
    unknownGuess,
    dismissUnknownGuess: () => setUnknownGuess(null),
    submitting,
    restoredFinished,
    revealingRow: revealing ? guesses.length - 1 : null,
    /** True once the final row's reveal animation has finished. */
    settled: !revealing,
    attemptsLeft: MAX_ATTEMPTS - guesses.length,
    addLetter,
    backspace,
    submit: submitNow,
  }
}
