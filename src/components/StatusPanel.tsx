import { RefreshCw } from 'lucide-react'

interface Props {
  title: string
  message: string
  onRetry: () => void
}

/** Shown in place of the board when the puzzle can't be loaded. */
export function StatusPanel({ title, message, onRetry }: Props) {
  return (
    <div className="status-panel" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      <button className="btn btn-primary" onClick={onRetry}>
        <RefreshCw size={18} aria-hidden="true" />
        Try again
      </button>
    </div>
  )
}
