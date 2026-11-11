import { expect, test, type Page } from '@playwright/test'
import { getBeirutDate, puzzleNumberFor } from '../supabase/functions/_shared/beirut'
import { WRONG_WORDS, guess, mockSupabase, openGame, skipHelp, typeWord } from './mock'

test.use({ viewport: { width: 414, height: 800 } })

const rowStates = (page: Page, row: number) =>
  page
    .locator('.row')
    .nth(row)
    .locator('.tile')
    .evaluateAll((tiles) => tiles.map((t) => (['correct', 'present', 'absent'].find((s) => t.classList.contains(s)) ?? 'none')))

const toast = (page: Page) => page.locator('.toast')

/**
 * Plays all six wrong words, waiting for each guess to register before the next. Input is ignored
 * while a row is being scored or revealed, so a guess typed too early is retried from a clean row
 * rather than relying on fixed sleeps (which flake when several browsers run at once).
 */
async function playWrongWords(page: Page) {
  for (const [i, word] of WRONG_WORDS.entries()) {
    await expect(async () => {
      for (let k = 0; k < 5; k++) await page.keyboard.press('Backspace')
      await guess(page, word)
      await expect(page.locator('.row').nth(i).locator('.tile.correct, .tile.present, .tile.absent').first()).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 20_000 })
  }
}
const attemptsText = (page: Page) => page.locator('.info-label').first()

test.beforeEach(async ({ page }) => {
  await skipHelp(page)
})

test.describe('gameplay', () => {
  test('loads the daily puzzle and shows an empty six-by-five board', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await expect(page.locator('.row')).toHaveCount(6)
    await expect(page.locator('.tile')).toHaveCount(30)
    await expect(attemptsText(page)).toHaveText('6 attempts left')
    await expect(page.getByText(`No. ${mock.number}`)).toBeVisible()
    expect(mock.requests.map((r) => r.fn)).toEqual(['get-daily-puzzle'])
  })

  test('physical keyboard: type, backspace, submit', async ({ page }) => {
    await mockSupabase(page)
    await openGame(page)
    await typeWord(page, 'yal')
    await expect(page.locator('.row').first().locator('.tile.filled')).toHaveCount(3)
    await page.keyboard.press('Backspace')
    await expect(page.locator('.row').first().locator('.tile.filled')).toHaveCount(2)
    await page.keyboard.type('lla')
    await page.keyboard.press('Enter')
    await expect(attemptsText(page)).toHaveText('5 attempts left')
    expect(await rowStates(page, 0)).toEqual(['absent', 'absent', 'absent', 'absent', 'absent'])
  })

  test('on-screen keyboard: tap letters, backspace and enter', async ({ page }) => {
    await mockSupabase(page)
    await openGame(page)
    for (const ch of 'yallb') await page.getByRole('button', { name: ch, exact: true }).click()
    await page.getByRole('button', { name: 'Backspace' }).click()
    await page.getByRole('button', { name: 'a', exact: true }).click()
    await page.getByRole('button', { name: 'Enter' }).click()
    await expect(attemptsText(page)).toHaveText('5 attempts left')
    await expect(page.locator('.row').first().locator('.tile').first()).toHaveText('Y')
  })

  test('scores greens, yellows and greys with correct duplicate-letter handling', async ({ page }) => {
    await mockSupabase(page, { answer: 'kteer' })
    await openGame(page)
    // Answer has two E's and one R: the first two guessed E's and the R are yellow, the rest grey.
    await guess(page, 'eerie')
    await expect(attemptsText(page)).toHaveText('5 attempts left')
    expect(await rowStates(page, 0)).toEqual(['present', 'present', 'present', 'absent', 'absent'])
  })

  test('the keyboard takes on the best state of every letter after each guess', async ({ page }) => {
    await mockSupabase(page, { answer: 'kteer' })
    await openGame(page)
    await guess(page, 'kifak')
    const key = (name: string) => page.getByRole('button', { name: new RegExp(`^${name}(,|$)`) })
    await expect(key('k')).toHaveClass(/correct/, { timeout: 5000 })
    await expect(key('i')).toHaveClass(/absent/)
    await expect(key('t')).not.toHaveClass(/absent|present|correct/)
    await expect(key('k')).toHaveAccessibleName('k, correct')
  })

  test('an unapproved word does not use an attempt and the row stays editable', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await guess(page, 'mnaqo')
    await expect(toast(page)).toHaveText('Not in word list')
    await expect(attemptsText(page)).toHaveText('6 attempts left')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('x')
    await expect(page.locator('.row').first().locator('.tile.filled')).toHaveCount(5)
    expect(mock.requests.filter((r) => r.fn === 'submit-guess')).toHaveLength(1)
  })

  test('nonsense and short guesses are rejected locally with no network call', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await guess(page, 'aaaaa')
    await expect(toast(page)).toHaveText("That's a lot of repeating letters.")
    for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace')
    await guess(page, 'hab')
    await expect(toast(page)).toHaveText('Five characters, ya zalame!')
    expect(mock.requests.filter((r) => r.fn === 'submit-guess')).toHaveLength(0)
    await expect(attemptsText(page)).toHaveText('6 attempts left')
  })

  test('unsupported keys (6, 9, punctuation) are ignored', async ({ page }) => {
    await mockSupabase(page)
    await openGame(page)
    await page.keyboard.type('6 9.!')
    await expect(page.locator('.tile.filled')).toHaveCount(0)
  })

  test('the same guess cannot be submitted twice', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await guess(page, 'yalla')
    await expect(attemptsText(page)).toHaveText('5 attempts left')
    await expect(page.locator('.row.pending')).toHaveCount(0)
    await page.waitForTimeout(2200) // let the reveal finish so input is accepted again
    await guess(page, 'yalla')
    await expect(toast(page)).toHaveText('You already tried this word.')
    await expect(attemptsText(page)).toHaveText('5 attempts left')
    expect(mock.requests.filter((r) => r.fn === 'submit-guess')).toHaveLength(1)
  })

  test('a submitted row cannot be edited', async ({ page }) => {
    await mockSupabase(page)
    await openGame(page)
    await guess(page, 'yalla')
    await page.waitForTimeout(2200)
    await page.keyboard.press('Backspace')
    await expect(page.locator('.row').first().locator('.tile').nth(4)).toHaveText('A')
  })

  test('double-pressing Enter sends only one request', async ({ page }) => {
    const mock = await mockSupabase(page, { guessDelayMs: 1500 })
    await openGame(page)
    await page.keyboard.type('yalla')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(page.locator('.row.pending')).toHaveCount(1) // visible "submitting" state
    await expect(attemptsText(page)).toHaveText('5 attempts left')
    expect(mock.requests.filter((r) => r.fn === 'submit-guess')).toHaveLength(1)
  })

  test('typing is blocked while a guess is being scored', async ({ page }) => {
    await mockSupabase(page, { guessDelayMs: 800 })
    await openGame(page)
    await guess(page, 'yalla')
    await page.keyboard.type('kifak')
    await expect(attemptsText(page)).toHaveText('5 attempts left')
    await page.waitForTimeout(2500)
    await expect(page.locator('.row').nth(1).locator('.tile.filled')).toHaveCount(0)
  })
})

test.describe('winning and losing', () => {
  test('winning shows the meaning and Arabic spelling and records stats once', async ({ page }) => {
    await mockSupabase(page)
    await openGame(page)
    await guess(page, 'yalla')
    await page.waitForTimeout(2200)
    await guess(page, '5obez')

    const dialog = page.getByRole('dialog', { name: 'You got it' })
    await expect(dialog).toBeVisible({ timeout: 8000 })
    await expect(dialog).toContainText('Solved in 2 tries.')
    await expect(dialog).toContainText('Bread')
    await expect(dialog).toContainText('خبز')
    await expect(dialog).toContainText('Bring the bread.')

    const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('wordleb:stats')!))
    expect(stats).toMatchObject({ played: 1, wins: 1, currentStreak: 1, maxStreak: 1, lastPlayed: getBeirutDate() })
    expect(stats.distribution).toEqual([0, 1, 0, 0, 0, 0])
  })

  test('a finished game stays finished after a refresh and cannot be replayed', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await guess(page, '5obez')
    await expect(page.getByRole('dialog', { name: 'You got it' })).toBeVisible({ timeout: 8000 })
    await page.keyboard.press('Escape')

    await page.reload()
    await expect(page.locator('.tile.correct')).toHaveCount(5)
    await expect(page.getByText('View result')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const before = mock.requests.length
    await guess(page, 'yalla') // must be ignored
    await expect(page.locator('.tile.filled')).toHaveCount(5)
    expect(mock.requests.length).toBe(before)

    await page.getByText('View result').click()
    await expect(page.getByRole('dialog')).toContainText('Bread')

    const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('wordleb:stats')!))
    expect(stats.played).toBe(1)
  })

  test('statistics modal shows persisted numbers after a refresh', async ({ page }) => {
    await mockSupabase(page)
    await openGame(page)
    await guess(page, '5obez')
    await expect(page.getByRole('dialog', { name: 'You got it' })).toBeVisible({ timeout: 8000 })
    await page.reload()
    await page.getByRole('button', { name: 'Statistics' }).click()
    const dialog = page.getByRole('dialog', { name: 'Statistics' })
    await expect(dialog.locator('.stat').nth(0)).toContainText('1')
    await expect(dialog.locator('.stat').nth(1)).toContainText('100')
  })

  test('losing after six wrong guesses reveals the answer and stops play at six', async ({ page }) => {
    // Reduced motion shortens the reveal wait, so six guesses stay fast and steady under load.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const mock = await mockSupabase(page)
    await openGame(page)
    await playWrongWords(page)
    const dialog = page.getByRole('dialog', { name: 'Not this time' })
    await expect(dialog).toBeVisible({ timeout: 8000 })
    await expect(dialog).toContainText('Bread')
    await expect(page.locator('.row.lose')).toHaveCount(1)
    await page.keyboard.press('Escape')

    await guess(page, 'kteer') // a seventh guess must never be sent
    expect(mock.requests.filter((r) => r.fn === 'submit-guess')).toHaveLength(6)
    const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('wordleb:stats')!))
    expect(stats).toMatchObject({ played: 1, wins: 0, currentStreak: 0 })
  })

  test('refreshing mid-game restores guesses and colours', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await guess(page, 'yalla')
    await page.waitForTimeout(2200)
    await guess(page, 'kteer')
    await page.waitForTimeout(2200)
    const before = await rowStates(page, 1)

    await page.reload()
    await expect(attemptsText(page)).toHaveText('4 attempts left')
    expect(await rowStates(page, 1)).toEqual(before)
    await expect(page.locator('.row').first().locator('.tile').first()).toHaveText('Y')
    // Same-day reload reuses the cached puzzle info: no second puzzle request.
    expect(mock.requests.filter((r) => r.fn === 'get-daily-puzzle')).toHaveLength(1)
  })
})

test.describe('spelling variants', () => {
  const rowLetters = (page: Page, row: number) =>
    page.locator('.row').nth(row).locator('.tile').evaluateAll((tiles) => tiles.map((t) => t.textContent ?? '').join('').toLowerCase())

  test('a registered spelling of the answer wins, and the board shows the canonical word', async ({ page }) => {
    await mockSupabase(page)
    await openGame(page)
    await guess(page, '5ubez') // a variant of the answer 5obez

    const dialog = page.getByRole('dialog', { name: 'You got it' })
    await expect(dialog).toBeVisible({ timeout: 8000 })
    await expect(dialog).toContainText('Solved in 1 try.')
    expect(await rowLetters(page, 0)).toBe('5obez')
    expect(await rowStates(page, 0)).toEqual(['correct', 'correct', 'correct', 'correct', 'correct'])
  })

  test('a variant of another word is an ordinary wrong guess, scored as that word', async ({ page }) => {
    await mockSupabase(page)
    await openGame(page)
    await guess(page, '7elow') // a variant of 7elou, which is not the answer

    await expect(page.locator('.row').nth(0).locator('.tile.correct, .tile.present, .tile.absent').first()).toBeVisible({ timeout: 4000 })
    expect(await rowLetters(page, 0)).toBe('7elou')
    expect(await rowStates(page, 0)).not.toContain('none')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.row').nth(1).locator('.tile').first()).toHaveText('')
  })

  test('a four-letter attempt such as RIHA is still refused', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await guess(page, 'riha')
    await expect(toast(page)).toContainText('Five characters')
    expect(mock.requests.filter((r) => r.fn === 'submit-guess')).toHaveLength(0)
  })
})

test.describe('tamper-proof attempt counting', () => {
  test('the first guess sends no token, later guesses send the server-issued one, never a history', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await guess(page, 'yalla')
    await page.waitForTimeout(2200)
    await guess(page, 'kifak')
    await expect(attemptsText(page)).toHaveText('4 attempts left')

    const guessRequests = mock.requests.filter((r) => r.fn === 'submit-guess')
    expect(guessRequests[0].body).not.toHaveProperty('state_token')
    expect(typeof guessRequests[1].body.state_token).toBe('string')
    for (const r of guessRequests) expect(r.body).not.toHaveProperty('previous_guesses')
  })

  test('a game can be continued after a refresh using the saved token', async ({ page }) => {
    await mockSupabase(page)
    await openGame(page)
    await guess(page, 'yalla')
    await page.waitForTimeout(2200)
    await page.reload()
    await page.locator('.board-wrap:not(.loading)').waitFor()
    await guess(page, 'kifak')
    await expect(attemptsText(page)).toHaveText('4 attempts left')
    await expect(page.getByText('could not be resumed')).toHaveCount(0)
  })

  test('a forged or stale token is refused and today restarts without touching statistics', async ({ page }) => {
    const mock = await mockSupabase(page)
    await page.addInitScript(
      ([date]) => {
        localStorage.setItem(
          'wordleb:game',
          JSON.stringify({
            dateKey: date,
            guesses: ['yalla', 'kifak', 'ba7ar', 'shams', 'habib'],
            results: Array(5).fill(['absent', 'absent', 'absent', 'absent', 'absent']),
            status: 'playing',
            answer: null,
            stateToken: 'eyJkIjoiMjAyNi0xMS0wMSIsImciOltdfQ.forged-signature',
          }),
        )
        localStorage.setItem('wordleb:stats', JSON.stringify({ played: 4, wins: 3, currentStreak: 2, maxStreak: 3, distribution: [0, 1, 1, 1, 0, 0], lastPlayed: '2000-01-01' }))
      },
      [mock.date],
    )
    await openGame(page)
    await expect(attemptsText(page)).toHaveText('1 attempt left') // restored locally as five guesses
    await guess(page, 'eerie')
    await expect(toast(page)).toContainText('could not be resumed')
    await expect(attemptsText(page)).toHaveText('6 attempts left')
    await expect(page.locator('.tile.filled')).toHaveCount(0)

    const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('wordleb:stats')!))
    expect(stats).toMatchObject({ played: 4, wins: 3, currentStreak: 2 })
    // The server never revealed anything to the forged request.
    expect(await page.getByRole('dialog').count()).toBe(0)
  })
})

test.describe('community stats (all players)', () => {
  const openStats = async (page: Page) => {
    await page.getByRole('button', { name: 'Statistics' }).click()
    return page.getByRole('dialog', { name: 'Statistics' })
  }

  test('a friend on another phone counts: two first-try wins show as 2 players', async ({ page, browser }) => {
    const shared = new Map<string, number>() // the "server" both phones talk to
    await mockSupabase(page, { community: shared })
    await openGame(page)
    await guess(page, '5obez')
    await expect(page.getByRole('dialog', { name: 'You got it' })).toBeVisible({ timeout: 8000 })

    // The friend: a completely separate browser profile (own storage, own anonymous id).
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
    const friend = await phone.newPage()
    await skipHelp(friend)
    await mockSupabase(friend, { community: shared })
    await openGame(friend)
    await guess(friend, '5obez')
    await expect(friend.getByRole('dialog', { name: 'You got it' })).toBeVisible({ timeout: 8000 })
    await phone.close()

    expect(shared.size).toBe(2)
    await page.keyboard.press('Escape')
    const dialog = await openStats(page)
    await expect(dialog.getByText('players finished today')).toBeVisible()
    await expect(dialog.getByLabel('Solved in 1: 2 players')).toBeVisible()
    await expect(dialog.getByLabel('Did not solve: 0 players')).toBeVisible()
  })

  test('each browser sends one stable anonymous id, so reloading never double counts', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await guess(page, 'yalla')
    await page.waitForTimeout(2200)
    await guess(page, '5obez')
    await expect(page.getByRole('dialog', { name: 'You got it' })).toBeVisible({ timeout: 8000 })
    await page.keyboard.press('Escape')

    const ids = mock.requests.filter((r) => r.fn === 'submit-guess').map((r) => r.body.player_id)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
    expect(ids[1]).toBe(ids[0])
    expect(mock.community.size).toBe(1)
    expect([...mock.community.values()]).toEqual([2]) // solved on guess 2

    await page.reload()
    await page.locator('.board-wrap:not(.loading)').waitFor()
    const dialog = await openStats(page)
    await expect(dialog.getByLabel('Solved in 2: 1 player')).toBeVisible()
    await expect(dialog.getByText('player finished today')).toBeVisible()
    expect(mock.community.size).toBe(1)
  })

  test('a loss counts as "did not solve"', async ({ page }) => {
    const mock = await mockSupabase(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openGame(page)
    await playWrongWords(page)
    await expect(page.getByRole('dialog', { name: 'Not this time' })).toBeVisible({ timeout: 8000 })
    expect([...mock.community.values()]).toEqual([0])
    await page.keyboard.press('Escape')
    const dialog = await openStats(page)
    await expect(dialog.getByLabel('Did not solve: 1 player')).toBeVisible()
  })

  test('Today and All time are separate, and other days are not mixed into today', async ({ page }) => {
    const earlier = '0b8f3a52-5c1e-4d6a-9f27-3e1a7c9d4b10'
    await mockSupabase(page, { community: new Map([['2000-01-01|' + earlier, 3]]) })
    await openGame(page)
    const dialog = await openStats(page)
    await expect(dialog.getByText("Nobody has finished today's puzzle yet.")).toBeVisible()
    await dialog.getByRole('button', { name: 'All time' }).click()
    await expect(dialog.getByText('1 player finished')).toBeVisible()
    await expect(dialog.getByLabel('Solved in 3: 1 player')).toBeVisible()
    await dialog.getByRole('button', { name: 'Today' }).click()
    await expect(dialog.getByText("Nobody has finished today's puzzle yet.")).toBeVisible()
  })

  test('if community stats fail, personal stats still show and the section can retry', async ({ page }) => {
    const mock = await mockSupabase(page, { statsMode: 'down' })
    await openGame(page)
    const dialog = await openStats(page)
    await expect(dialog.getByText("Community stats aren't available right now.")).toBeVisible()
    await expect(dialog.getByText('Played')).toBeVisible() // your own stats are unaffected
    mock.statsMode = 'ok'
    await dialog.getByRole('button', { name: 'Try again' }).click()
    await expect(dialog.getByText("Nobody has finished today's puzzle yet.")).toBeVisible()
  })
})

test.describe('growing the word list from play', () => {
  const nudge = (page: Page) => page.locator('.nudge')

  test('an unknown word is accepted, counted, logged, and offered for suggestion', async ({ page }) => {
    const mock = await mockSupabase(page, { enforce: false })
    await openGame(page)
    await guess(page, 'mnaqo')
    await expect(attemptsText(page)).toHaveText('5 attempts left') // the guess counted
    await expect(nudge(page)).toContainText("MNAQO isn't in our word list yet.", { timeout: 8000 })
    expect([...mock.unknownLog.keys()]).toEqual(['mnaqo'])
    expect(mock.unknownLog.get('mnaqo')!.size).toBe(1)

    await nudge(page).getByRole('button', { name: 'Suggest it' }).click()
    const dialog = page.getByRole('dialog', { name: 'Suggest a word' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Word (5 characters)')).toHaveValue('mnaqo') // prefilled
    await expect(nudge(page)).toHaveCount(0)
  })

  test('known words and the answer cause no prompt and are not logged', async ({ page }) => {
    const mock = await mockSupabase(page, { enforce: false })
    await openGame(page)
    await guess(page, 'yalla') // in the dictionary
    await page.waitForTimeout(2600)
    await expect(nudge(page)).toHaveCount(0)
    await guess(page, '5obez') // the answer
    await expect(page.getByRole('dialog', { name: 'You got it' })).toBeVisible({ timeout: 8000 })
    await expect(nudge(page)).toHaveCount(0)
    expect(mock.unknownLog.size).toBe(0)
  })

  test('two different phones trying the same unknown word are counted as two players', async ({ page, browser }) => {
    const shared = new Map<string, Set<string>>()
    await mockSupabase(page, { enforce: false, unknownLog: shared })
    await openGame(page)
    await guess(page, 'mnaqo')
    await expect(attemptsText(page)).toHaveText('5 attempts left')

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
    const friend = await phone.newPage()
    await skipHelp(friend)
    await mockSupabase(friend, { enforce: false, unknownLog: shared })
    await openGame(friend)
    await guess(friend, 'mnaqo')
    await expect(friend.locator('.info-label').first()).toHaveText('5 attempts left')
    await phone.close()

    expect(shared.get('mnaqo')!.size).toBe(2)
  })

  test('the same player trying the same unknown word again is not double counted', async ({ page }) => {
    const mock = await mockSupabase(page, { enforce: false })
    await openGame(page)
    await guess(page, 'mnaqo')
    await page.waitForTimeout(2200)
    await page.reload()
    await page.locator('.board-wrap:not(.loading)').waitFor()
    await guess(page, 'ztaqo') // a different unknown word from the same browser
    await expect(attemptsText(page)).toHaveText('4 attempts left')
    const ids = new Set([...mock.unknownLog.values()].flatMap((s) => [...s]))
    expect(ids.size).toBe(1) // one browser, one stable id, across both words
  })

  test('the prompt can be dismissed, and goes away when the player keeps typing', async ({ page }) => {
    await mockSupabase(page, { enforce: false })
    await openGame(page)
    await guess(page, 'mnaqo')
    await expect(nudge(page)).toBeVisible({ timeout: 8000 })
    await nudge(page).getByRole('button', { name: 'Dismiss' }).click()
    await expect(nudge(page)).toHaveCount(0)

    await guess(page, 'ztaqo')
    await expect(nudge(page)).toBeVisible({ timeout: 8000 })
    await page.keyboard.type('k')
    await expect(nudge(page)).toHaveCount(0)
  })

  test('the slightly stricter filter rejects obvious nonsense locally, with no request', async ({ page }) => {
    const mock = await mockSupabase(page, { enforce: false })
    await openGame(page)
    for (const [word, message] of [
      ['bcdrt', "That doesn't look like a word."], // no vowel, no digit
      ['astrk', "That doesn't look like a word."], // four consonants in a row
      ['aaabc', "That's a lot of repeating letters."], // three identical in a row
    ] as const) {
      await guess(page, word)
      await expect(toast(page)).toHaveText(message)
      for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace')
      await page.waitForTimeout(1700) // let the toast clear
    }
    expect(mock.requests.filter((r) => r.fn === 'submit-guess')).toHaveLength(0)
  })

  test('real Lebanese spellings still pass the stricter filter', async ({ page }) => {
    const mock = await mockSupabase(page, { enforce: false })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openGame(page)
    for (const [i, word] of ['kifak', '7abib', 'shway', '5alas', '3aj2a', '2ahwe'].entries()) {
      await expect(async () => {
        for (let k = 0; k < 5; k++) await page.keyboard.press('Backspace')
        await guess(page, word)
        await expect(page.locator('.row').nth(i).locator('.tile.correct, .tile.present, .tile.absent').first()).toBeVisible({ timeout: 2000 })
      }).toPass({ timeout: 20_000 })
    }
    expect(mock.requests.filter((r) => r.fn === 'submit-guess').length).toBeGreaterThanOrEqual(6)
  })
})

test.describe('suggestion form', () => {
  test('only the word is needed: one tap on Suggest it sends it', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await page.getByRole('button', { name: 'Suggest a word' }).click()
    const dialog = page.getByRole('dialog', { name: 'Suggest a word' })
    await expect(dialog.locator('input, textarea')).toHaveCount(1)
    await dialog.getByLabel('Word (5 characters)').fill('mnaqo')
    await dialog.getByRole('button', { name: 'Suggest it' }).click()
    await expect(dialog).toContainText('MNAQO is on the list')
    expect(mock.requests.filter((r) => r.fn === 'submit-suggestion').map((r) => r.body.word)).toEqual(['mnaqo'])
  })

  test('the word never exceeds five characters, however it is entered', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await page.getByRole('button', { name: 'Suggest a word' }).click()
    const dialog = page.getByRole('dialog', { name: 'Suggest a word' })
    const word = dialog.getByLabel('Word (5 characters)')

    await word.pressSequentially('abcdefgh') // typing
    await expect(word).toHaveValue('abcde')
    await word.fill('qwertyuiop') // paste or a keyboard that ignores maxlength: set the value directly
    await expect(word).toHaveValue('qwert')
    await word.fill('')
    await word.pressSequentially('kifak')
    await expect(word).toHaveValue('kifak')
    expect(mock.requests.filter((r) => r.fn === 'submit-suggestion')).toHaveLength(0)
  })

  test('a word prefilled from the prompt is also capped at five', async ({ page }) => {
    await mockSupabase(page, { enforce: false })
    await openGame(page)
    await guess(page, 'mnaqo')
    await page.locator('.nudge').getByRole('button', { name: 'Suggest it' }).click()
    await expect(page.getByLabel('Word (5 characters)')).toHaveValue('mnaqo')
  })
})

test.describe('sharing', () => {
  test('copies a result grid with the number and attempts but never the answer', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const mock = await mockSupabase(page)
    await openGame(page)
    await guess(page, 'yalla')
    await page.waitForTimeout(2200)
    await guess(page, '5obez')
    const dialog = page.getByRole('dialog', { name: 'You got it' })
    await expect(dialog).toBeVisible({ timeout: 8000 })
    await dialog.getByRole('button', { name: 'Share' }).click()
    await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible()
    await expect(page.locator('.share-note')).toContainText('copied')

    // Windows clipboards store line breaks as CRLF.
    const text = (await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')
    expect(text).toBe(`wordleb #${mock.number} 2/6\n\n⬛⬛⬛⬛⬛\n🟩🟩🟩🟩🟩\n\nhttps://wordleb.com`)
    expect(text.toLowerCase()).not.toContain('5obez')
  })
})

test.describe('puzzle availability and errors', () => {
  test('shows a friendly message when today has no puzzle, then recovers on retry', async ({ page }) => {
    const mock = await mockSupabase(page, { puzzleMode: 'missing' })
    await openGame(page)
    await expect(page.getByRole('alert')).toContainText('No puzzle today')
    mock.puzzleMode = 'ok'
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.locator('.board')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('shows a connection error when the server is unreachable, then recovers', async ({ page }) => {
    const mock = await mockSupabase(page, { puzzleMode: 'offline' })
    await openGame(page)
    await expect(page.getByRole('alert')).toContainText('Connection problem')
    expect(mock.requests.filter((r) => r.fn === 'get-daily-puzzle')).toHaveLength(3) // the first try plus two automatic retries
    mock.puzzleMode = 'ok'
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.locator('.board')).toBeVisible()
  })

  test('a server error while loading is shown as a friendly message', async ({ page }) => {
    await mockSupabase(page, { puzzleMode: 'down' })
    await openGame(page)
    await expect(page.getByRole('alert')).toContainText('Something went wrong')
  })

  test('keys are not accepted while the puzzle is unavailable', async ({ page }) => {
    await mockSupabase(page, { puzzleMode: 'missing' })
    await openGame(page)
    await expect(page.getByRole('alert')).toBeVisible()
    await page.keyboard.type('yalla')
    await expect(page.locator('.tile.filled')).toHaveCount(0)
  })

  test('a failed guess request shows a message and spends no attempt', async ({ page }) => {
    const mock = await mockSupabase(page, { guessMode: 'offline' })
    await openGame(page)
    await guess(page, 'yalla')
    await expect(toast(page)).toContainText("Couldn't reach the server")
    await expect(attemptsText(page)).toHaveText('6 attempts left')
    // The player can retry the same word once the connection is back.
    mock.guessMode = 'ok'
    await page.keyboard.press('Enter')
    await expect(attemptsText(page)).toHaveText('5 attempts left')
  })

  test('a server error on a guess shows a message and spends no attempt', async ({ page }) => {
    await mockSupabase(page, { guessMode: 'down' })
    await openGame(page)
    await guess(page, 'yalla')
    await expect(toast(page)).toContainText("Couldn't reach the server")
    await expect(attemptsText(page)).toHaveText('6 attempts left')
  })

  test('offline with a saved game for today still shows that game', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    await guess(page, 'yalla')
    await page.waitForTimeout(2200)
    await page.evaluate(() => localStorage.removeItem('wordleb:puzzle')) // force a network load next time
    mock.puzzleMode = 'offline'
    await page.reload()
    await expect(attemptsText(page)).toHaveText('5 attempts left')
    await expect(page.locator('.row').first().locator('.tile').first()).toHaveText('Y')
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})

test.describe('midnight in Beirut', () => {
  test('a new Beirut day loads the new puzzle and keeps the old result', async ({ page }) => {
    // 23:59:30 in Beirut (UTC+2 in winter) on the day before the first simulated day.
    const start = new Date('2026-11-01T21:59:30Z')
    await page.clock.install({ time: start })
    const mock = await mockSupabase(page, { date: '2026-11-01', number: puzzleNumberFor('2026-11-01') })
    await openGame(page)
    await expect(page.getByText(`No. ${puzzleNumberFor('2026-11-01')}`)).toBeVisible()
    await page.clock.runFor(1000) // let the first tick run
    expect(getBeirutDate(start)).toBe('2026-11-01')

    mock.date = '2026-11-02'
    mock.number = puzzleNumberFor('2026-11-02')
    await page.clock.runFor(45_000) // pass midnight; the countdown triggers a reload
    await page.waitForLoadState('load')
    await page.clock.runFor(2000)
    await expect(page.getByText(`No. ${puzzleNumberFor('2026-11-02')}`)).toBeVisible({ timeout: 10_000 })
    await expect(attemptsText(page)).toHaveText('6 attempts left')
  })
})

test.describe('past days', () => {
  test('replay a missed day without touching today, streaks or the community numbers', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)

    await page.getByRole('button', { name: 'Play a past day' }).click()
    const dialog = page.getByRole('dialog', { name: 'Play a past day' })
    await expect(dialog.locator('.archive-row')).toHaveCount(3) // today plus two earlier days
    await expect(dialog.locator('.archive-row').first()).toHaveAttribute('aria-current', 'true')

    await dialog.locator('.archive-row').nth(1).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.info-bar')).toContainText(`No. ${puzzleNumberFor(mock.past[0])}`)
    await expect(page.getByRole('button', { name: 'Back to today' })).toBeVisible()
    await expect(attemptsText(page)).toHaveText('6 attempts left')

    await guess(page, 'kteer') // the past day's answer
    await expect(page.getByRole('dialog', { name: 'You got it' })).toBeVisible({ timeout: 8000 })
    const sent = mock.requests.filter((r) => r.fn === 'submit-guess').at(-1)!.body
    expect(sent).toMatchObject({ puzzle_date: mock.past[0], archive: true })
    expect(mock.community.size).toBe(0) // not counted for anyone
    expect(await page.evaluate(() => localStorage.getItem('wordleb:stats'))).toBeNull() // no streak or total

    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Back to today' }).click()
    await expect(page.locator('.info-bar')).toContainText(`No. ${mock.number}`)
    await expect(page.locator('.info-bar')).toContainText('Next word')
    await expect(attemptsText(page)).toHaveText('6 attempts left') // today is still untouched

    await page.getByRole('button', { name: 'Play a past day' }).click()
    await expect(page.getByRole('dialog', { name: 'Play a past day' }).locator('.archive-row').nth(1)).toContainText('Solved 1/6')
  })

  test('a stale date without the archive flag is still refused', async ({ page }) => {
    const mock = await mockSupabase(page)
    await openGame(page)
    const status = await page.evaluate(
      async ({ base, date }) => {
        const r = await fetch(`${base}/functions/v1/submit-guess`, { method: 'POST', body: JSON.stringify({ guess: 'kteer', puzzle_date: date }) })
        return r.status
      },
      { base: 'https://mock.supabase.test', date: mock.past[0] },
    )
    expect(status).toBe(409)
  })
})
