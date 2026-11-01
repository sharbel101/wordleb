import type { Toast as ToastData } from '../game/useGame'

export function Toast({ toast }: { toast: ToastData | null }) {
  return (
    <div className="toast-region" aria-live="polite" role="status">
      {toast && (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      )}
    </div>
  )
}
