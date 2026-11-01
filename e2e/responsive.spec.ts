import { expect, test, type Page } from '@playwright/test'
import { guess, mockSupabase, openGame, skipHelp } from './mock'

const VIEWPORTS = [
  { width: 320, height: 568, name: 'small phone' },
  { width: 360, height: 640, name: 'android' },
  { width: 375, height: 812, name: 'iPhone X' },
  { width: 390, height: 844, name: 'iPhone 14' },
  { width: 430, height: 932, name: 'large phone' },
  { width: 768, height: 1024, name: 'tablet portrait' },
  { width: 1024, height: 768, name: 'tablet landscape' },
  { width: 1366, height: 768, name: 'laptop' },
  { width: 1920, height: 1080, name: 'wide desktop' },
]

interface Box {
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
}

/** Measures everything the layout checks need in one round trip. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null): Box | null => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }
    }
    const tiles = [...document.querySelectorAll('.tile')].map((t) => box(t)!)
    const keys = [...document.querySelectorAll('.key')]
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      header: box(document.querySelector('.header')),
      info: box(document.querySelector('.info-bar')),
      board: box(document.querySelector('.board')),
      keyboard: box(document.querySelector('.keyboard')),
      tiles,
      keyBoxes: keys.map((k) => box(k)!),
      mainKeyBoxes: [...document.querySelectorAll('.key-row:not(.key-row-digits) .key')].map((k) => box(k)!),
      digitKeyBoxes: [...document.querySelectorAll('.key-row-digits .key')].map((k) => box(k)!),
      clippedKeys: keys.filter((k) => k.scrollWidth > k.clientWidth + 1).map((k) => k.textContent),
      iconButtons: [...document.querySelectorAll('.icon-btn')].map((b) => box(b)!),
    }
  })
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height} (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.width < 600 })

    test.beforeEach(async ({ page }) => {
      await skipHelp(page)
      await mockSupabase(page)
      await openGame(page)
      await expect(page.locator('.tile')).toHaveCount(30)
    })

    test('fits the screen with no scrolling, overflow, overlap or clipping', async ({ page }, info) => {
      const m = await measure(page)

      // No horizontal scrolling, and (for any normal phone/desktop height) no vertical scrolling.
      expect(m.scrollW, 'horizontal overflow').toBeLessThanOrEqual(m.vw)
      expect(m.scrollH, 'vertical overflow').toBeLessThanOrEqual(m.vh + 1)

      // Everything sits inside the viewport, including the bottom keyboard row.
      for (const b of [m.header!, m.info!, m.board!, m.keyboard!]) {
        expect(b.left).toBeGreaterThanOrEqual(0)
        expect(b.right).toBeLessThanOrEqual(m.vw)
        expect(b.top).toBeGreaterThanOrEqual(0)
        expect(b.bottom).toBeLessThanOrEqual(m.vh)
      }
      for (const k of m.keyBoxes) {
        expect(k.right).toBeLessThanOrEqual(m.vw)
        expect(k.bottom).toBeLessThanOrEqual(m.vh)
      }

      // Stacked top to bottom without overlapping.
      expect(m.header!.bottom).toBeLessThanOrEqual(m.info!.top + 1)
      expect(m.info!.bottom).toBeLessThanOrEqual(m.board!.top + 1)
      expect(m.board!.bottom).toBeLessThanOrEqual(m.keyboard!.top + 1)

      // Square tiles of one size, in five aligned columns and six aligned rows.
      for (const t of m.tiles) expect(Math.abs(t.width - t.height)).toBeLessThan(0.6)
      expect(new Set(m.tiles.map((t) => Math.round(t.width))).size).toBe(1)
      expect(new Set(m.tiles.map((t) => Math.round(t.left))).size).toBe(5)
      expect(new Set(m.tiles.map((t) => Math.round(t.top))).size).toBe(6)
      expect(m.tiles[0].width, 'tiles should not be tiny').toBeGreaterThanOrEqual(30)

      // Board is centred in the viewport.
      const centre = (m.board!.left + m.board!.right) / 2
      expect(Math.abs(centre - m.vw / 2)).toBeLessThan(2)

      // Comfortable touch targets, no clipped key labels, nothing touching the screen edge.
      for (const b of m.iconButtons) expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44)
      for (const k of m.mainKeyBoxes) expect(k.height, 'letter key height').toBeGreaterThanOrEqual(40)
      for (const k of m.digitKeyBoxes) expect(k.height, 'digit key height').toBeGreaterThanOrEqual(34)
      expect(m.clippedKeys).toEqual([])
      expect(m.keyboard!.left).toBeGreaterThanOrEqual(3)
      expect(m.vw - m.keyboard!.right).toBeGreaterThanOrEqual(3)

      // Desktop: a comfortable maximum width rather than stretching.
      expect(m.keyboard!.width).toBeLessThanOrEqual(500)
      expect(m.board!.width).toBeLessThanOrEqual(460)

      await page.screenshot({ path: `test-results/layout-${vp.width}x${vp.height}.png` })
      info.annotations.push({ type: 'tile', description: `${Math.round(m.tiles[0].width)}px` })
    })

    test('stays within the viewport mid-game and with a modal open', async ({ page }) => {
      await guess(page, 'yalla')
      await expect(page.locator('.tile.absent').first()).toBeVisible()
      await page.waitForTimeout(2200)
      let m = await measure(page)
      expect(m.scrollW).toBeLessThanOrEqual(m.vw)
      expect(m.scrollH).toBeLessThanOrEqual(m.vh + 1)

      await page.getByRole('button', { name: 'Suggest a word' }).click()
      const modal = page.getByRole('dialog')
      await expect(modal).toBeVisible()
      const box = (await modal.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
      m = await measure(page)
      expect(m.scrollW).toBeLessThanOrEqual(m.vw)
      await page.screenshot({ path: `test-results/modal-${vp.width}x${vp.height}.png` })
    })
  })
}

test.describe('touch behaviour', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('controls disable double-tap zoom but pinch-zoom stays enabled', async ({ page }) => {
    await skipHelp(page)
    await mockSupabase(page)
    await openGame(page)
    const viewportMeta = await page.locator('meta[name=viewport]').getAttribute('content')
    expect(viewportMeta).not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale/i)

    const css = await page.evaluate(() => {
      const get = (sel: string) => {
        const s = getComputedStyle(document.querySelector(sel)!)
        return { touchAction: s.touchAction, userSelect: s.userSelect }
      }
      return { key: get('.key'), tile: get('.board'), body: getComputedStyle(document.body).touchAction }
    })
    expect(css.key.touchAction).toBe('manipulation')
    expect(css.key.userSelect).toBe('none')
    expect(css.tile.userSelect).toBe('none')
    expect(css.body).toBe('auto') // nothing restrictive applied globally
  })

  test('tapping keys and tiles never selects text, and a tap enters exactly one letter', async ({ page }) => {
    await skipHelp(page)
    await mockSupabase(page)
    await openGame(page)
    await page.getByRole('button', { name: 'k', exact: true }).tap()
    await page.locator('.tile').nth(10).tap()
    await page.locator('.tile').nth(11).dblclick()
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
    await expect(page.locator('.tile.filled')).toHaveCount(1)
  })
})

test.describe('accessibility', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ page }) => {
    await skipHelp(page)
  })

  const open = async (page: Page, overrides: Parameters<typeof mockSupabase>[1] = {}) => {
    await mockSupabase(page, overrides)
    await openGame(page)
  }

  test('modals close with Escape and return focus to the opener for keyboard users', async ({ page }) => {
    await open(page)
    const help = page.getByRole('button', { name: 'How to play' })
    await help.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'How to play' })).toBeVisible()
    await expect(page.getByRole('dialog')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(help).toBeFocused()
  })

  test('mouse users keep playing after a modal: focus is not parked on a button', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: 'Statistics' }).click()
    await expect(page.getByRole('dialog', { name: 'Statistics' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.keyboard.type('yalla')
    await expect(page.locator('.tile.filled')).toHaveCount(5)
    await page.keyboard.press('Enter') // must submit the guess, not re-open the modal
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.info-label').first()).toHaveText('5 attempts left')
  })

  test('the grid is described for screen readers and results are announced', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('grid', { name: 'Guess grid' })).toBeVisible()
    await guess(page, 'yalla')
    await expect(page.locator('.sr-only[aria-live]')).toContainText('Guess 1: Y absent, A absent', {
      timeout: 6000,
    })
    await expect(page.getByRole('gridcell', { name: 'Y, absent' })).toBeVisible()
  })

  test('colour is not the only cue: right and wrong spots carry glyphs', async ({ page }) => {
    await open(page, { answer: 'kteer' })
    await guess(page, 'eerie')
    await page.waitForTimeout(2200)
    const glyphs = await page
      .locator('.row')
      .first()
      .locator('.tile')
      .evaluateAll((tiles) => tiles.map((t) => getComputedStyle(t, '::after').content))
    expect(glyphs).toEqual(['"○"', '"○"', '"○"', 'none', 'none'])
  })

  test('feedback colours meet contrast requirements', async ({ page }) => {
    await open(page)
    const ratios = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement)
      const lum = (hex: string) => {
        const [r, g, b] = [1, 3, 5].map((i) => {
          const c = parseInt(hex.slice(i, i + 2), 16) / 255
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const ratio = (a: string, b: string) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
        return (hi + 0.05) / (lo + 0.05)
      }
      const v = (n: string) => root.getPropertyValue(n).trim()
      return {
        correct: ratio(v('--green'), '#ffffff'),
        present: ratio(v('--gold'), v('--gold-text')),
        absent: ratio(v('--absent'), '#ffffff'),
        muted: ratio(v('--muted'), v('--bg')),
        text: ratio(v('--text'), v('--bg')),
      }
    })
    for (const [name, r] of Object.entries(ratios)) expect(r, name).toBeGreaterThanOrEqual(4.5)
  })

  test('reduced motion removes the long reveal wait', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page)
    await guess(page, 'yalla')
    // With animations off the keyboard updates almost immediately instead of after ~1.8s.
    await expect(page.getByRole('button', { name: 'y, absent' })).toBeVisible({ timeout: 900 })
  })
})
