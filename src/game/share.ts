export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

interface ShareEnv {
  nav: Pick<Navigator, 'share' | 'clipboard'> & Partial<Navigator>
  isTouch: boolean
  legacyCopy: (text: string) => boolean
}

function defaultEnv(): ShareEnv {
  return {
    nav: navigator,
    // The native share sheet is great on phones but clumsy on desktop browsers.
    isTouch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    legacyCopy,
  }
}

/** Last-resort copy for non-secure contexts or older browsers. */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}

/**
 * Shares a result: native share sheet on touch devices, otherwise (or if that
 * fails) the clipboard. Dismissing the share sheet is not an error.
 */
export async function shareResult(text: string, env: ShareEnv = defaultEnv()): Promise<ShareOutcome> {
  if (env.isTouch && typeof env.nav.share === 'function') {
    try {
      await env.nav.share({ text })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      // Any other failure: fall through to copying.
    }
  }
  try {
    await env.nav.clipboard.writeText(text)
    return 'copied'
  } catch {
    return env.legacyCopy(text) ? 'copied' : 'failed'
  }
}
