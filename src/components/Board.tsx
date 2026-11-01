import { memo, type CSSProperties } from 'react'
import { MAX_ATTEMPTS, WORD_LENGTH, type TileState } from '../game/logic'

interface Props {
  guesses: string[]
  /** Server-scored result for each submitted guess. */
  results: TileState[][]
  current: string
  /** Row currently playing its flip animation, if any. */
  revealingRow: number | null
  /** Increments to re-trigger the shake on the active row. */
  shakeKey: number
  /** Play the win bounce on the last row. */
  celebrate: boolean
  /** Play a gentle shake on the last row after a loss. */
  lose: boolean
  /** The active row is waiting for the server. */
  pending: boolean
  playing: boolean
}

interface TileProps {
  char: string
  col: number
  state?: TileState
  flip?: boolean
  pop?: boolean
  bounce?: boolean
}

// Memoised: typing a letter re-renders one tile, not all thirty.
const Tile = memo(function Tile({ char, col, state, flip, pop, bounce }: TileProps) {
  const classes = ['tile']
  if (char) classes.push('filled')
  if (state) classes.push(state)
  if (flip) classes.push('flip')
  if (pop) classes.push('pop')
  if (bounce) classes.push('bounce')

  const label = char ? `${char.toUpperCase()}${state ? `, ${state}` : ''}` : 'empty'
  return (
    <div
      className={classes.join(' ')}
      style={{ '--col': col } as CSSProperties}
      role="gridcell"
      aria-label={label}
    >
      {char.toUpperCase()}
    </div>
  )
})

export function Board({
  guesses,
  results,
  current,
  revealingRow,
  shakeKey,
  celebrate,
  lose,
  pending,
  playing,
}: Props) {
  const activeRow = playing ? guesses.length : -1

  return (
    <div className="board" role="grid" aria-label="Guess grid" aria-rowcount={MAX_ATTEMPTS}>
      {Array.from({ length: MAX_ATTEMPTS }, (_, row) => {
        const submitted = row < guesses.length
        const isActive = row === activeRow && revealingRow === null
        const states = submitted ? results[row] : null
        const isLast = row === guesses.length - 1
        const rowClasses = ['row']
        if (isActive && shakeKey > 0) rowClasses.push('shake')
        if (isActive && pending) rowClasses.push('pending')
        if (lose && isLast) rowClasses.push('lose')

        return (
          <div
            key={isActive ? `active-${shakeKey}` : row}
            className={rowClasses.join(' ')}
            role="row"
            aria-label={`Guess ${row + 1} of ${MAX_ATTEMPTS}`}
          >
            {Array.from({ length: WORD_LENGTH }, (_, col) => {
              if (submitted && states) {
                return (
                  <Tile
                    key={col}
                    char={guesses[row][col]}
                    col={col}
                    state={states[col]}
                    flip={row === revealingRow}
                    bounce={celebrate && isLast}
                  />
                )
              }
              const char = isActive ? (current[col] ?? '') : ''
              return <Tile key={col} char={char} col={col} pop={isActive && col === current.length - 1} />
            })}
          </div>
        )
      })}
    </div>
  )
}
