// Isolated browser acceptance. Start npm run preview first.
// PLAYWRIGHT_MODULE may name an existing Playwright ESM file; otherwise install playwright locally.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import './create-wiki-preview.mjs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173'
const output = resolve('.harness-analysis/ANALYSIS_20261023_DATABASE_UI/browser')
await mkdir(output, { recursive: true })
await build({ entryPoints: ['scripts/preview.tsx'], outfile: '.preview/app.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' } })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const report = { cases: [], screenshots: [], overflow: [], pageErrors: errors }
const check = name => report.cases.push(name)
const screenshot = async name => { const path = resolve(output, `${name}.png`); await page.screenshot({ path }); report.screenshots.push(path) }
const overflow = async () => {
  const value = await page.evaluate(() => ['html', '.ww-dialog', '.ww-content'].map(selector => {
    const element = document.querySelector(selector)
    return { selector, width: element.clientWidth, scrollWidth: element.scrollWidth }
  }))
  assert.ok(value.every(item => item.scrollWidth <= item.width + 1), JSON.stringify(value))
  report.overflow.push({ viewport: page.viewportSize(), elements: value })
}
try {
  await page.goto(`${base}/?demo=database`)
  await page.getByRole('heading', { name: '数据库配置', exact: true }).waitFor()
  const pathInput = page.getByLabel('数据库文件路径', { exact: false })
  const inspect = page.getByRole('button', { name: '测试连接', exact: true })
  const save = page.getByRole('button', { name: '保存并应用', exact: true })
  await pathInput.fill('C:\\Writing\\missing.sqlite3')
  await inspect.click()
  await page.getByText('未找到数据库文件，请创建后重新测试连接。', { exact: true }).waitFor()
  assert.equal(await save.isDisabled(), true)
  assert.ok((await page.locator('.ww-db-guide pre').innerText()).includes('missing.sqlite3'))
  check('missing file has actionable command and cannot be saved')
  await overflow(); await screenshot('desktop-missing')
  await pathInput.fill('C:\\Writing\\second.sqlite3')
  assert.equal(await save.isDisabled(), true)
  await inspect.click()
  assert.equal(await save.isEnabled(), true)
  await pathInput.focus(); await page.keyboard.press('Tab')
  assert.equal(await inspect.evaluate(element => document.activeElement === element), true)
  await page.keyboard.press('Tab')
  assert.equal(await save.evaluate(element => document.activeElement === element), true)
  check('test-before-save and keyboard focus order')
  await page.getByRole('button', { name: '▦ 工作台', exact: true }).click()
  await page.getByRole('button', { name: '⚙ 数据库', exact: true }).click()
  assert.equal(await pathInput.inputValue(), 'C:\\Writing\\second.sqlite3')
  await save.click()
  await page.getByText('配置已保存并生效，重启 DSH 后将继续使用此数据库。', { exact: true }).waitFor()
  assert.equal(await page.locator('.ww-db-current-path').innerText(), 'C:\\Writing\\second.sqlite3')
  assert.equal(await save.isDisabled(), true)
  check('draft survives navigation, save confirms current configuration')
  await screenshot('desktop-ready')
  await pathInput.fill('C:\\Writing\\fail-save.sqlite3'); await inspect.click(); await save.click()
  assert.match(await page.getByRole('alert').innerText(), /配置文件暂时无法写入/)
  assert.equal(await pathInput.inputValue(), 'C:\\Writing\\fail-save.sqlite3')
  assert.equal(await page.locator('.ww-db-current-path').innerText(), 'C:\\Writing\\second.sqlite3')
  check('save failure preserves input and leaves active configuration visible')
  await pathInput.fill('relative.sqlite3'); await inspect.click()
  assert.equal(await save.isDisabled(), true)
  assert.equal(await pathInput.getAttribute('aria-invalid'), 'true')
  check('invalid path is accessible and cannot be saved')
  await page.goto(`${base}/?demo=database&state=readonly`)
  await page.getByText('当前配置只读', { exact: true }).waitFor()
  await pathInput.fill('C:\\Writing\\second.sqlite3'); await inspect.click()
  assert.equal(await save.isDisabled(), true)
  check('read-only profile supports inspection but refuses save')
  await page.goto(`${base}/?page=database`)
  await page.getByText('等待连接 DSH 宿主', { exact: true }).waitFor()
  assert.equal(await inspect.isDisabled(), true)
  assert.equal(await save.isDisabled(), true)
  check('standalone preview does not claim a live host connection')
  await page.setViewportSize({ width: 375, height: 900 })
  await page.goto(`${base}/?demo=database&state=unconfigured`)
  await pathInput.waitFor()
  await pathInput.fill('C:\\Writing\\a-very-long-folder-name\\中文资料与创作\\missing.sqlite3'); await inspect.click()
  await page.getByText('未找到数据库文件，请创建后重新测试连接。', { exact: true }).waitFor()
  await overflow(); await screenshot('mobile-missing')
  await page.getByRole('button', { name: '切换工作台导航' }).click()
  await page.getByRole('button', { name: '▦ 工作台', exact: true }).click()
  await page.getByRole('button', { name: '配置数据库 →' }).click()
  assert.match(await pathInput.inputValue(), /中文资料/)
  check('375px layout, long path wrapping and drawer navigation')
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close() }
