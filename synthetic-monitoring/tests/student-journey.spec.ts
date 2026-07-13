import { test, expect } from '@playwright/test'

test('synthetic student can log in, browse, and view an image', async ({ page }) => {
  const email = process.env.SYNTHETIC_EMAIL || 'synthetic.student@example.ca'
  const password = process.env.SYNTHETIC_PASSWORD || 'password'

  // Start in synthetic mode so front-end telemetry marks events accordingly.
  await page.goto('/?synthetic=1')

  // Local-credentials view. If OIDC is enabled, click through to local form.
  const localUserLink = page.getByRole('link', { name: 'Use a local user' })
  if (await localUserLink.isVisible().catch(() => false)) {
    await localUserLink.click()
  }

  await page.getByLabel('Username').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /LOGIN|Signing in/ }).click()

  // Wait for the browse page to load and image grid to render.
  await expect(page).toHaveURL(/page=browse/)

  // Open the seeded Duomo image. Using the image alt text avoids fragile
  // CSS selectors when Material UI rendering changes.
  await page.locator('img[alt="Duomo di Milano"]').first().click()
  await expect(page).toHaveURL(/image=1/)

  // The viewer container should contain an OpenSeadragon canvas.
  await expect(page.locator('canvas')).toBeVisible({ timeout: 20000 })

  // Capture the session id so CI can correlate front-end events in Loki.
  const sessionId = await page.evaluate(() => (window as any).__HRIV_SESSION_ID__)
  console.log(`Synthetic session id: ${sessionId}`)
})
