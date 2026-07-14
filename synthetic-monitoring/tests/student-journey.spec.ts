import { test, expect, type Response } from '@playwright/test'

/**
 * End-to-end synthetic journey: a monitor "student" logs in, browses, opens an
 * image, and — critically — we assert that the deep-zoom pipeline actually
 * served content by observing BOTH a successful `.dzi` descriptor AND a real
 * tile image (`.jpg`/`.jpeg`/`.png`) HTTP response. A visible `<canvas>` alone
 * can be produced even when tiles 404, so the network assertions are what prove
 * the viewer is genuinely healthy.
 *
 * Steps are wrapped in `test.step(...)` so the reporter (and CI logs) show a
 * readable, timed breakdown of the journey.
 */
test('synthetic student can log in, browse, and view an image', async ({ page }) => {
  const email = process.env.SYNTHETIC_EMAIL || 'synthetic.student@example.ca'
  const password = process.env.SYNTHETIC_PASSWORD || 'password'
  const categoryPathValue = process.env.SYNTHETIC_CATEGORY_PATH?.trim() || 'Architecture/Italian'
  const categoryPath = categoryPathValue
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
  const imageName = process.env.SYNTHETIC_IMAGE_NAME?.trim() || 'Duomo di Milano'
  expect(categoryPath, 'SYNTHETIC_CATEGORY_PATH must contain a category label').not.toHaveLength(0)

  // Deep-zoom descriptors and tiles are both served under /api/tiles/. Collect
  // every one (registered up front; a passive listener has no timeout) so we
  // can assert the viewer never received a failing tile response.
  const tileResponses: Array<{ url: string; status: number }> = []
  const isDziUrl = (url: string) => /\/api\/tiles\/.+\.dzi(\?|$)/i.test(url)
  const isTileImageUrl = (url: string) => /\/api\/tiles\/.+\.(jpe?g|png)(\?|$)/i.test(url)
  const isTileUrl = (url: string) => isDziUrl(url) || isTileImageUrl(url)
  page.on('response', (r: Response) => {
    if (isTileUrl(r.url())) {
      tileResponses.push({ url: r.url(), status: r.status() })
    }
  })

  await test.step('load login page in synthetic mode', async () => {
    const oidcStatusResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/auth/oidc/enabled',
    )

    // Start in synthetic mode so front-end telemetry marks events accordingly.
    await page.goto('/?synthetic=1')

    const response = await oidcStatusResponse
    expect(response.ok(), `OIDC status returned ${response.status()}`).toBeTruthy()
    const { enabled: oidcEnabled } = (await response.json()) as { enabled: boolean }

    // Local-credentials view. If OIDC is enabled, click through to local form.
    if (oidcEnabled) {
      await page.getByRole('button', { name: 'Use a local user' }).click()
    }
    await expect(page.getByLabel('Username')).toBeVisible()
  })

  await test.step('submit local credentials', async () => {
    const loginResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/login' &&
        response.request().method() === 'POST',
    )

    await page.getByLabel('Username').fill(email)
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password)
    await page.getByRole('button', { name: /LOGIN|Signing in/ }).click()

    const response = await loginResponse
    expect(response.ok(), `Login returned ${response.status()}`).toBeTruthy()

    // The browse root intentionally has no ?page= parameter.
    await expect(page).toHaveURL((url) => url.pathname === '/' && !url.searchParams.has('page'))
    await expect(page.getByRole('navigation', { name: 'category breadcrumb' })).toBeVisible()
    console.log('[synthetic] login succeeded, browse page loaded')
  })

  await test.step('navigate to configured image and assert DZI + tile responses', async () => {
    for (const categoryName of categoryPath) {
      const categoryButton = page
        .getByRole('button')
        .filter({ has: page.getByText(categoryName, { exact: true }) })
        .first()
      await expect(categoryButton, `category not visible: ${categoryName}`).toBeVisible({
        timeout: 20000,
      })
      await categoryButton.click()
    }

    await expect(page).toHaveURL((url) => {
      const categoryIds = url.searchParams.get('cat')?.split(',').filter(Boolean) ?? []
      return url.pathname === '/' && categoryIds.length === categoryPath.length
    })

    const image = page.getByAltText(imageName, { exact: true }).first()
    await expect(image, `image not visible: ${imageName}`).toBeVisible({ timeout: 20000 })

    // Register the network waits immediately before triggering the image load
    // so their 30s timeout budget covers only tile fetching, not the preceding
    // login/navigation. OpenSeadragon fetches image.dzi first, then tiles.
    const dziResponse = page.waitForResponse((r: Response) => isDziUrl(r.url()) && r.ok(), {
      timeout: 30000,
    })
    const tileImageResponse = page.waitForResponse(
      (r: Response) => isTileImageUrl(r.url()) && r.ok(),
      { timeout: 30000 },
    )

    await image.click()
    await expect(page).toHaveURL((url) => {
      const imageId = url.searchParams.get('image')
      return url.pathname === '/' && imageId !== null && /^\d+$/.test(imageId)
    })
    console.log(`[synthetic] opened configured image: ${categoryPath.join(' / ')} / ${imageName}`)

    // The viewer container should contain an OpenSeadragon canvas.
    await expect(page.locator('canvas')).toBeVisible({ timeout: 20000 })
    console.log('[synthetic] viewer canvas rendered')

    // The descriptor is the earliest strong signal; a real tile image proves
    // the pipeline served actual pixel data, not just metadata.
    const dzi = await dziResponse
    expect(dzi.status(), `DZI descriptor not 2xx: ${dzi.status()} ${dzi.url()}`).toBeLessThan(300)
    console.log(`[synthetic] DZI descriptor OK: ${dzi.status()} ${dzi.url()}`)

    const tile = await tileImageResponse
    expect(tile.status(), `tile image not 2xx: ${tile.status()} ${tile.url()}`).toBeLessThan(300)
    console.log(`[synthetic] tile image OK: ${tile.status()} ${tile.url()}`)
  })

  await test.step('assert no tile/DZI response failed', async () => {
    const failed = tileResponses.filter((r) => r.status >= 400)
    expect(failed, `tile/DZI responses returned errors: ${JSON.stringify(failed)}`).toHaveLength(0)
    expect(tileResponses.length, 'expected at least one /api/tiles/ response').toBeGreaterThan(0)
    console.log(`[synthetic] observed ${tileResponses.length} tile/DZI response(s), 0 failures`)
  })

  // Capture the session id so CI can correlate front-end events in Loki.
  const sessionId = await page.evaluate(() => (window as any).__HRIV_SESSION_ID__)
  console.log(`[synthetic] session id: ${sessionId}`)
})
