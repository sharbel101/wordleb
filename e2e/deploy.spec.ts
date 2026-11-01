import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { guess, mockSupabase, openGame, skipHelp } from './mock'

const toml = readFileSync('netlify.toml', 'utf8')
const csp = /Content-Security-Policy = "([^"]+)"/.exec(toml)![1]

test.describe('netlify.toml', () => {
  test('the game works under the production Content-Security-Policy', async ({ page }) => {
    // The real policy only allows https://*.supabase.co; the test API lives on a mock host.
    const policy = csp.replace('https://*.supabase.co', 'https://mock.supabase.test')
    const violations: string[] = []
    page.on('console', (m) => {
      if (/content security policy/i.test(m.text())) violations.push(m.text())
    })
    await page.route('http://localhost:5199/**', async (route) => {
      const response = await route.fetch()
      const headers = { ...response.headers() }
      if (route.request().resourceType() === 'document') headers['content-security-policy'] = policy
      await route.fulfill({ response, headers })
    })

    await skipHelp(page)
    await mockSupabase(page)
    await openGame(page)
    await guess(page, 'yalla')
    await expect(page.locator('.info-label').first()).toHaveText('5 attempts left')
    await page.getByRole('button', { name: 'Statistics' }).click()
    await expect(page.getByRole('dialog', { name: 'Statistics' })).toBeVisible() // lazy-loaded chunk
    expect(violations).toEqual([])
  })

  test('the policy blocks scripts from other origins and connections to other hosts', () => {
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain("'unsafe-eval'")
    expect(csp).toMatch(/connect-src 'self' https:\/\/\*\.supabase\.co/)
    expect(csp).toContain("frame-ancestors 'none'")
  })

  test('contains no credentials and omits only the two public keys from secret scanning', () => {
    // Real credential formats (JWTs, Supabase secret/personal tokens, Netlify and GitHub tokens, keys).
    expect(toml).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}\.|sb_secret_|sbp_[A-Za-z0-9]|nfp_[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]|AIza[0-9A-Za-z_-]{20}|BEGIN [A-Z ]*PRIVATE KEY/)
    expect(toml).toMatch(/SECRETS_SCAN_OMIT_KEYS = "VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY"/)
  })
})
