import { test, expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { readFile } from 'node:fs/promises'

async function open(page: Page, backend = 'imsdk') {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`?backend=${backend}`)
  await expect(page.locator('#scene')).toHaveAttribute('data-rendered', 'true')
  await expect(page.locator('#scene')).toHaveAttribute('data-profile', backend)
  return errors
}

async function canvasPixels(page: Page) {
  return PNG.sync.read(await page.locator('#scene > canvas').screenshot({ style: '.world-labels, .scene-heading, .view-switch, .camera-tools, .scene-legend, #tour { visibility: hidden !important; }' }))
}

for (const backend of ['imsdk', 'deepstream']) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`${backend} has a rendered and contained layout at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const errors = await open(page, backend)
    await expect(page.locator('#scene')).toHaveAttribute('data-framed-nodes', backend === 'imsdk' ? '11' : '8')
    const pixels = await canvasPixels(page)
    const colors = new Set<string>()
    let colored = 0
    for (let index = 0; index < pixels.data.length; index += 64) {
      const [red, green, blue] = pixels.data.subarray(index, index + 3)
      colors.add(`${red >> 4},${green >> 4},${blue >> 4}`)
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 30) colored += 1
    }
    expect(colors.size).toBeGreaterThan(40)
    expect(colored).toBeGreaterThan(80)
    expect(pixels.width).toBeGreaterThan(300)
    expect(pixels.height).toBeGreaterThan(200)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const labels = await page.locator('.world-label:visible').evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect()
      return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }
    }))
    for (let first = 0; first < labels.length; first += 1) for (let second = first + 1; second < labels.length; second += 1) {
      const overlaps = labels[first].left < labels[second].right && labels[first].right > labels[second].left && labels[first].top < labels[second].bottom && labels[first].bottom > labels[second].top
      expect(overlaps).toBe(false)
    }
    await page.screenshot({ path: test.info().outputPath('overview.png'), fullPage: true })
    expect(errors).toEqual([])
  })
}

test('backend swapping clears results and changes the actual element graph', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = await open(page)
  for (let index = 0; index < 10; index += 1) await page.locator('#step').click()
  expect(Number(await page.locator('#completed').textContent())).toBeGreaterThan(0)
  await page.locator('[data-backend="deepstream"]').click()
  await expect(page.locator('#completed')).toHaveText('0')
  await expect(page.locator('#scene')).toHaveAttribute('data-nodes', '8')
  await expect(page.locator('[data-inspect="tee"]')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Inspector' }).click()
  await expect(page.locator('.plugin-name')).toHaveText('nvinfer')
  await page.locator('[data-inspect="batch"]').click()
  await expect(page.locator('.plugin-name')).toHaveText('nvstreammux')
  await page.locator('[data-backend="imsdk"]').click()
  await expect(page.locator('#scene')).toHaveAttribute('data-nodes', '11')
  await expect(page.locator('.plugin-name')).toHaveText('qtimltflite')
  await page.getByRole('tab', { name: 'Pipeline', exact: true }).click()
  await page.locator('[data-source="file"]').click()
  await expect(page.locator('#scene-context')).toContainText('Video file')
  await page.getByRole('tab', { name: 'Deploy', exact: true }).click()
  await expect(page.locator('#recipe')).toContainText('run-file-pipeline.sh')
  expect(errors).toEqual([])
})

test('step updates pixels, pause freezes time, and queue scenarios drive live counters', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const errors = await open(page)
  const before = await canvasPixels(page)
  for (let index = 0; index < 12; index += 1) await page.locator('#step').click()
  const after = await canvasPixels(page)
  let differences = 0
  for (let index = 0; index < before.data.length; index += 4) if (Math.abs(before.data[index] - after.data[index]) > 10 || Math.abs(before.data[index + 1] - after.data[index + 1]) > 10) differences += 1
  expect(differences).toBeGreaterThan(100)
  const elapsed = await page.locator('#elapsed').textContent()
  await page.locator('#theme').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day')
  await expect(page.locator('#elapsed')).toHaveText(elapsed!)
  await page.locator('#scenario').selectOption('realtime')
  await expect(page.locator('#capacity')).toHaveValue('2')
  await expect(page.locator('#leak')).toHaveValue('downstream')
  for (let index = 0; index < 18; index += 1) await page.locator('#step').click()
  expect(Number(await page.locator('#dropped-value').textContent())).toBeGreaterThan(0)
  await page.locator('#reset').click()
  await expect(page.locator('#dropped-value')).toHaveText('0')
  await expect(page.locator('#elapsed')).toHaveText('00:00.0')
  expect(errors).toEqual([])
})

test('tour, topology, keyboard tabs, and snapshot export work', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = await open(page)
  await page.locator('#tour-start').click()
  await expect(page.locator('#tour')).toBeVisible()
  await expect(page.locator('#tour-title')).toHaveText('USB camera')
  await page.locator('#tour-next').click()
  await expect(page.locator('#tour-title')).toHaveText('Stream split')
  await page.locator('#tour-close').click()
  await expect(page.locator('#tour')).toBeHidden()
  await page.locator('[data-view="plan"]').click()
  await expect(page.locator('[data-view="plan"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('#labels').uncheck()
  await expect(page.locator('.world-label:visible')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Pipeline', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Inspector', exact: true })).toBeFocused()
  const downloaded = page.waitForEvent('download')
  await page.locator('#export').click()
  const artifact = await downloaded
  const snapshot = JSON.parse(await readFile((await artifact.path())!, 'utf8'))
  expect(snapshot.kind).toBe('simulation-not-measurement')
  expect(snapshot.settings.backend).toBe('imsdk')
  expect(snapshot.graph.nodes).toHaveLength(11)
  expect(errors).toEqual([])
})

test('autoplay progresses in the foreground and mobile controls remain reachable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 320, height: 740 })
  const errors = await open(page)
  await expect.poll(async () => Number(await page.locator('#completed').textContent())).toBeGreaterThan(2)
  await page.locator('#play').click()
  await expect(page.locator('#phase')).toHaveText('PAUSED')
  await page.locator('[data-backend="deepstream"]').click()
  await expect(page.locator('#scene')).toHaveAttribute('data-profile', 'deepstream')
  await page.getByRole('tab', { name: 'Deploy', exact: true }).click()
  await expect(page.locator('#recipe')).toContainText('gst-inspect-1.0 nvinfer')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('mobile-deploy.png'), fullPage: true })
  expect(errors).toEqual([])
})