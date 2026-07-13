import { test, expect, type Response } from '@playwright/test'

/**
 * End-to-end synthetic journey: a monitor "student" logs in, browses, opens an
 * image, and — critically — we assert that the deep-zoom pipeline actually
 * served content by observing a successful `.dzi` descriptor or tile HTTP
 * response. A visible `<canvas>` alone can be produced even when tiles 404, so
 * the network assertion is what proves the viewer is genuinely healthy.
 *
 * Steps are wrapped in `test.step(...)` so the reporter (and CI logs) show a
 * readable, timed breakdown of the journey.
 */
test('synthetic student can log in, browse, and view an image', async ({ page }) => {
  const email = process.env.SYNTHETIC_EMAIL || 'synthetic.student@example.ca'
  const password = process.env.SYNTHETIC_PASSWORD || 'password'

  // Deep-zoom descriptors and tiles are both served under /api/tiles/. Collect
  // successful ones so we can assert the viewer received real image data.
  const tileResponses: Array<{ url: string; status: number }> = []
  const isTileUrl = (url: string) => /\/api\/tiles\/.+\.(dzi|jpe?g|png)(\?|$)/i.test(url)
  const firstDzi = page.waitForResponse(
    (r: Response) => /\/api\/tiles\/.+\.dzi(\?|$)/i.test(r.url()) && r.ok(),
    { timeout: 30000 },
  )
  page.on('response', (r: Response) => {
    if (isTileUrl(r.url())) {
      tileResponses.push({ url: r.url(), status: r.status() })
    }
  })

  await test.step('load login page in synthetic mode', async () => {
    // Start in synthetic mode so front-end telemetry marks events accordingly.
    await page.goto('/?synthetic=1')

    // Local-credentials view. If OIDC is enabled, click through to local form.
    const localUserLink = page.getByRole('link', { name: 'Use a local user' })
    if (await localUserLink.isVisible().catch(() => false)) {
      await localUserLink.click()
    }
  })

  await test.step('submit local credentials', async () => {
    await page.getByLabel('Username').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: /LOGIN|Signing in/ }).click()

    // Wait for the browse page to load and image grid to render.
    await expect(page).toHaveURL(/page=browse/)
    console.log('[synthetic] login succeeded, browse page loaded')
  })

  await test.step('open the seeded Duomo image', async () => {
    // Open the seeded Duomo image. Using the image alt text avoids fragile
    // CSS selectors when Material UI rendering changes.
    await page.locator('img[alt="Duomo di Milano"]').first().click()
    await expect(page).toHaveURL(/image=1/)

    // The viewer container should contain an OpenSeadragon canvas.
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20000 })
    console.log('[synthetic] viewer canvas rendered')
  })

  await test.step('assert a successful DZI/tile response', async () => {
    // Wait for the descriptor specifically; OpenSeadragon fetches image.dzi
    // before requesting any tiles, so this is the earliest strong signal.
    const dzi = await firstDzi
    console.log(`[synthetic] DZI descriptor OK: ${dzi.status()} ${dzi.url()}`)

    // Also verify at least one tile/descriptor response and that none failed.
    const failed = tileResponses.filter((r) => r.status >= 400)
    expect(failed, `tile/DZI responses returned errors: ${JSON.stringify(failed)}`).toHaveLength(0)
    expect(tileResponses.length, 'expected at least one /api/tiles/ response').toBeGreaterThan(0)
    console.log(`[synthetic] observed ${tileResponses.length} tile/DZI response(s), 0 failures`)
  })

  // Capture the session id so CI can correlate front-end events in Loki.
  const sessionId = await page.evaluate(() => (window as any).__HRIV_SESSION_ID__)
  console.log(`[synthetic] session id: ${sessionId}`)
})
