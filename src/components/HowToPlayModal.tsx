import { ARABIZI_DIGITS, ARABIZI_HINTS, MAX_ATTEMPTS, type TileState } from '../game/logic'
import { Modal } from './Modal'

function ExampleRow({ word, state, note }: { word: string; state: TileState; note: string }) {
  return (
    <div className="example">
      <div className="example-row" aria-hidden="true">
        {[...word].map((ch, i) => (
          <div key={i} className={`tile filled mini ${i === 0 ? state : ''}`}>
            {ch.toUpperCase()}
          </div>
        ))}
      </div>
      <p>{note}</p>
    </div>
  )
}

export function HowToPlayModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <div className="modal-body">
        <p>
          Guess the Lebanese word of the day in {MAX_ATTEMPTS} tries. Every word has five characters, written in
          Arabizi, the way we text.
        </p>
        <ul className="plain-list">
          <li>Each guess must be five characters long.</li>
          <li>
            The colour of a tile shows how close your guess was: green with a ✓ is the right spot, amber with a ○
            is the wrong spot, grey is not in the word.
          </li>
          <li>A new word arrives every day at midnight.</li>
        </ul>

        <h3>Examples</h3>
        <ExampleRow word="yalla" state="correct" note="Y is in the word and in the right spot." />
        <ExampleRow word="ba7ar" state="present" note="B is in the word but in the wrong spot." />
        <ExampleRow word="kteer" state="absent" note="K is not in the word at all." />

        <h3>Numbers are letters</h3>
        <p>Arabizi uses digits for sounds Latin letters can&apos;t make:</p>
        <div className="digit-guide">
          {ARABIZI_DIGITS.map((d) => (
            <span key={d} className="digit-chip">
              <strong>{d}</strong> {ARABIZI_HINTS[d]}
            </span>
          ))}
        </div>
      </div>
    </Modal>
  )
}
