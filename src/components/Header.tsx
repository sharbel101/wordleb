import { ChartNoAxesColumn, CircleHelp, MessageSquarePlus } from 'lucide-react'

interface Props {
  onHelp: () => void
  onStats: () => void
  onSuggest: () => void
}

export function Header({ onHelp, onStats, onSuggest }: Props) {
  return (
    <header className="header">
      <div className="header-side">
        <button className="icon-btn" onClick={onHelp} aria-label="How to play">
          <CircleHelp size={22} />
        </button>
      </div>
      <h1 className="logo" aria-label="WordleB">
        <span aria-hidden="true">WORD</span>
        <span className="logo-leb" aria-hidden="true">
          LEB
        </span>
      </h1>
      <div className="header-side header-side-end">
        <button className="icon-btn" onClick={onSuggest} aria-label="Suggest a word">
          <MessageSquarePlus size={22} />
        </button>
        <button className="icon-btn" onClick={onStats} aria-label="Statistics">
          <ChartNoAxesColumn size={22} />
        </button>
      </div>
    </header>
  )
}
