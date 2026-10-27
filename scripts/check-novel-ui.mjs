import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { FIELDS } from '../lib/modules/novel/domain/fields.js'
const fixture = new URL('../tests/novel-fixture.mjs', import.meta.url)
if (!existsSync(fixture)) throw new Error('此附加 UI 验证需要本地 tests/novel-fixture.mjs；该目录不随 Git 分发，默认预览无需它。')
const { sampleFields } = await import(fixture.href)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4188'
const output = resolve(process.env.OUTPUT_DIR ?? '.harness-analysis/ANALYSIS_20261024_NOVEL_MEMORY/browser')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
const page = await browser.newPage({ viewport: { width: 1536, height: 1050 }, acceptDownloads: true })
const results = { cases: [], screenshots: [], errors: [], overflow: [] }
page.on('pageerror', error => results.errors.push(error.message))
const button = name => page.getByRole('button', { name, exact: true })
const module = name => page.getByRole('navigation', { name: '小说模块导航' }).getByRole('button', { name: new RegExp(name) }).click()
const screenshot = async name => { const path = resolve(output, `${name}.png`); await page.screenshot({ path, fullPage: false }); results.screenshots.push(path) }
const overflow = async () => {
  const sizes = await page.evaluate(() => ['html', '.ww-content', '.wn-page'].map(selector => { const e = document.querySelector(selector); return { selector, client: e.clientWidth, scroll: e.scrollWidth } }))
  assert.ok(sizes.every(s => s.scroll <= s.client + 1), JSON.stringify(sizes)); results.overflow.push({ width: page.viewportSize().width, sizes })
}
const saveAndConfirm = async () => {
  await button('保存草稿').click(); await page.getByRole('status').filter({ hasText: '已保存到本次会话' }).waitFor()
  await button('确认此版本').click(); await page.getByRole('status').filter({ hasText: '当前版本已确认' }).waitFor()
}
const fill = async kind => {
  for (const field of FIELDS[kind]) {
    const value = sampleFields[kind][field.key]
    if (!value) continue
    const control = page.getByLabel(field.label, { exact: true })
    if (field.type === 'select') await control.selectOption(value)
    else await control.fill(value)
  }
}
try {
  await page.goto(`${base}/?page=novel`)
  await page.getByRole('heading', { name: '让故事，从这里开始' }).waitFor()
  assert.equal(await page.getByRole('navigation', { name: '小说模块导航' }).getByRole('button').count(), 7)
  await page.getByLabel('小说名称', { exact: true }).fill('雾港来信')
  await button('创建小说并进入设定 →').click(); await page.getByRole('alert').filter({ hasText: '作者人格' }).waitFor()
  await module('角色库'); await page.getByRole('heading', { name: '先为故事建立身份' }).waitFor(); await module('资产配置')
  assert.equal(await page.getByLabel('小说名称', { exact: true }).inputValue(), '雾港来信')
  for (const [kind, name, content] of [['persona', '克制的讲述者', '用具体行动表现情绪，保持克制。'], ['world', '雾港世界观', '雾港不存在超自然力量。档案查阅需要许可。']]) {
    await page.getByLabel('资产类型', { exact: true }).selectOption(kind)
    await page.getByLabel('资产名称', { exact: true }).fill(name)
    await page.getByLabel('资产内容', { exact: true }).fill(content)
    await button('登记资产').click(); await page.getByRole('status').filter({ hasText: '资产已加入' }).waitFor()
  }
  await page.getByLabel('选择作者人格', { exact: true }).selectOption({ label: '克制的讲述者 · v1' })
  await page.getByLabel('选择世界观', { exact: true }).selectOption({ label: '雾港世界观 · v1' })
  await overflow(); await screenshot('desktop-create')
  await button('创建小说并进入设定 →').click(); await page.getByLabel('一句话前提', { exact: true }).waitFor()
  results.cases.push('Seven accessible module entries, missing dual bindings blocked, asset registration and explicit creation')

  await page.getByLabel('一句话前提', { exact: true }).fill('切换页面也不会丢失的草稿')
  await module('角色库'); await fill('character'); await saveAndConfirm()
  await module('小说设定'); assert.equal(await page.getByLabel('一句话前提', { exact: true }).inputValue(), '切换页面也不会丢失的草稿')
  await fill('settings'); await saveAndConfirm(); await overflow(); await screenshot('desktop-settings')
  await button('前往总纲 →').click(); await fill('outline'); await saveAndConfirm()
  await button('前往分卷剧情 →').click(); await fill('volume'); await saveAndConfirm()
  await button('前往单元规划 →').click(); await fill('unit'); await saveAndConfirm()
  await button('前往章节规划 →').click(); await fill('chapter'); await page.getByRole('checkbox', { name: '引用角色 林舟' }).check(); await saveAndConfirm()
  await page.locator('.ww-content').evaluate(e => { e.scrollTop = 0 }); await overflow(); await screenshot('desktop-chapter')
  await button('前往正文 →').click(); await fill('body'); await button('保存草稿').click(); await page.getByRole('status').filter({ hasText: '已保存到本次会话' }).waitFor()
  assert.equal(await button('确认此版本').count(), 0)
  await page.locator('.ww-content').evaluate(e => { e.scrollTop = 0 }); await overflow(); await screenshot('desktop-body')
  results.cases.push('Author confirms settings, outline, volume, unit and chapter; independent character; body consumes exact chapter and stays unpublished')

  await page.getByRole('navigation', { name: '写作工作台导航' }).getByRole('button', { name: /工作台/ }).click()
  await page.getByRole('heading', { name: '雾港来信', exact: true }).waitFor(); await button('继续创作 →').click()
  assert.equal(await page.getByLabel('正文内容', { exact: true }).inputValue(), sampleFields.body.text)
  await module('单元规划'); await page.getByLabel('可读剧情', { exact: true }).fill(sampleFields.unit.narrative + ' 林舟将线索抄在笔记里。'); await saveAndConfirm()
  await module('正文'); await page.getByText(/来源待复核/).first().waitFor()
  assert.equal(await page.getByLabel('正文内容', { exact: true }).inputValue(), sampleFields.body.text)
  await screenshot('desktop-stale')
  results.cases.push('Home resume preserves body; confirmed upstream change marks body stale without rewriting text')

  const downloadWait = page.waitForEvent('download'); await button('导出已保存版本').click(); const download = await downloadWait
  const backup = resolve(output, 'fixture.novel.json'); await download.saveAs(backup)
  const data = JSON.parse(await readFile(backup, 'utf8')); assert.equal(data.documents.find(d => d.kind === 'unit').revisions.length, 2)
  await page.locator('input[type=file]').setInputFiles(backup)
  await page.getByRole('status').filter({ hasText: '已导入为独立小说候选' }).waitFor()
  assert.ok((await page.getByLabel('当前小说', { exact: true }).inputValue()) !== data.project.id)
  assert.equal(await page.locator('.wn-badge').innerText(), '候选')
  await button('保存绑定草稿').click(); await button('确认资产绑定').click(); await page.getByRole('status').filter({ hasText: '当前版本已确认' }).waitFor()
  results.cases.push('Download preserves versions; import creates isolated candidates and requires explicit source rebind/confirmation')

  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('.ww-content').evaluate(e => { e.scrollTop = 0 }); await overflow(); await screenshot('mobile-assets')
  await module('正文'); await page.getByLabel('正文内容', { exact: true }).waitFor(); await page.locator('.ww-content').evaluate(e => { e.scrollTop = 0 }); await overflow(); await screenshot('mobile-body')
  await page.reload(); await page.getByRole('heading', { name: '让故事，从这里开始' }).waitFor()
  assert.equal(await page.getByLabel('当前小说', { exact: true }).locator('option').count(), 1)
  results.cases.push('390 px layout has no overflow; refresh clears memory as declared')
  assert.deepEqual(results.errors, [])
  results.status = 'passed'
} catch (error) { results.status = 'failed'; results.failure = error.stack; await screenshot('failure'); throw error }
finally { await writeFile(resolve(output, 'verification.json'), JSON.stringify(results, null, 2)); await browser.close() }
console.log(JSON.stringify({ status: results.status, cases: results.cases.length, screenshots: results.screenshots.length, errors: results.errors }))
