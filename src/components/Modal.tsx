import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ title, onClose, children }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    // Give focus back to whatever opened the dialog, but only for keyboard users.
    // After a mouse or touch open, leaving focus on the opener would make a later
    // Enter press (to submit a guess) re-open the dialog.
    const opener = document.activeElement as HTMLElement | null
    const restoreFocus = !!opener?.matches?.(':focus-visible')
    dialog?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (restoreFocus && opener?.isConnected) opener.focus()
    }
  }, [onClose])

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={dialogRef}>
        <button className="icon-btn modal-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
        <h2 className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}
