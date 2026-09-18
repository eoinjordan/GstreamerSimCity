import { chromium } from '@playwright/test'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('..', import.meta.url))
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:4179/'
const work = await mkdtemp(join(tmpdir(), 'gstreamer-preview-'))
const media = join(root, 'docs/media')
await mkdir(media, { recursive: true })

function execute(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr}`)
  return result.stdout
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const recording of ['demo', 'tour']) {
    const directory = join(work, recording)
    await mkdir(directory)
    await page.goto(new URL('?backend=imsdk&source=camera', baseUrl).href)
    await page.locator('#scene[data-rendered="true"]').waitFor()
    await page.evaluate(() => document.fonts.ready)
    await page.mouse.move(2, 2)
    if (recording === 'tour') await page.locator('#tour-start').click()
    for (let index = 0; index < 40; index += 1) {
      if (recording === 'demo') {
        if (index === 10) await page.locator('#scenario').selectOption('pressure')
        if (index === 20) await page.locator('[data-backend="deepstream"]').click()
        if (index === 29) await page.locator('#scenario').selectOption('realtime')
      } else if (index === 10 || index === 20 || index === 30) {
        await page.locator('#tour-next').click()
      }
      await page.mouse.move(2, 2)
      await page.screenshot({ path: join(directory, `frame-${String(index).padStart(3, '0')}.png`), timeout: 30000 })
      await page.waitForTimeout(100)
    }
    if (Number(await page.locator('#produced').textContent()) === 0) throw new Error('Capture did not advance the simulation')
    if (errors.length) throw new Error(errors.join('\n'))
    const output = join(media, `${recording}.gif`)
    execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '8', '-i', join(directory, 'frame-%03d.png'), '-filter_complex', '[0:v]scale=960:-2:flags=lanczos,split[frames][colors];[colors]palettegen=max_colors=160[palette];[frames][palette]paletteuse=dither=bayer', '-loop', '0', output])
    const metadata = JSON.parse(execute('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames,duration', '-of', 'json', output])).streams[0]
    if (metadata.width !== 960 || metadata.height !== 600 || Number(metadata.nb_read_frames) !== 40) throw new Error('Invalid encoded animation')
    const checkImage = join(tmpdir(), `gstreamer-${recording}-check.png`)
    execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', output, '-vf', 'select=eq(n\\,19)', '-frames:v', '1', checkImage])
    console.log(`${recording}.gif: ${metadata.width}x${metadata.height}, ${metadata.nb_read_frames} frames, ${metadata.duration}s, ${(await stat(output)).size} bytes; check: ${checkImage}`)
  }
} finally {
  await browser.close()
  await rm(work, { recursive: true, force: true })
}