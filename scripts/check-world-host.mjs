// Isolated full Host + Web acceptance using the installed Desktop runtime.
// Private installation paths belong only to this diagnostic fixture, never shipped plugin imports.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const evidence = resolve(process.env.OUTPUT_DIR || '.harness-analysis/ANALYSIS_20261024_WORLDBUILDING')
await mkdir(evidence, { recursive: true })
const dir = await mkdtemp(join(evidence, 'runtime-')), home = join(dir, 'home'), profile = join(home, 'profiles', 'smoke')
const installed = process.env.DSH_INSTALL_PATH || join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness')
const runtime = `${installed}/resources/app.asar/dsh`
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const databasePath = join(dir, 'world.sqlite3')
const init = spawnSync('python', ['-X', 'utf8', join(root, 'scripts/local_db.py'), 'init', '--db', databasePath], { encoding: 'utf8', windowsHide: true })
assert.equal(init.status, 0, init.stderr)
await mkdir(join(profile, 'node_modules'), { recursive: true }); await mkdir(join(dir, 'agents'), { recursive: true })
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'writing-world-smoke', private: true, dependencies: { 'dsh-writing-workbench': `link:${root.replaceAll('\\','/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-writing-workbench'] } } }, null, 2))
await writeFile(join(profile, 'cordis.patch.yml'), `- id: ui-settings-account
  name: '@deepseek-ai/dsh-client-ui-settings-account'
  config:
    version: 1
    step: done
    purpose: null
    process: standard
    completion: skipped
    usage: compact
    developerTools: false
- id: writing-workbench
  name: dsh-writing-workbench
  config:
    databasePath: '${databasePath.replaceAll('\\','/').replaceAll("'", "''")}'
`)
await symlink(root, join(profile, 'node_modules/dsh-writing-workbench'), 'junction')
await writeFile(join(dir, 'host.cjs'), `
const {pathToFileURL}=require('node:url');
(async()=>{
 const runtime=process.argv[2], project=process.argv[3];
 const app=await import(pathToFileURL(runtime+'/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'));
 const {runProfile}=await import(pathToFileURL(runtime+'/node_modules/@deepseek-ai/dsh/lib/profile-boot.js'));
 const installAnchor=runtime+'/node_modules/@deepseek-ai/dsh/package.json';
 const profile=app.loadProfileDirectory('dsh',project,installAnchor);
 const running=await runProfile({environment:app.loadLayeredEnv('dsh'),profile:'smoke',resolvedProfile:{profile,installAnchor},patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']});
 const stop=async()=>{await running.shutdown.shutdown(0);if(process.connected)process.disconnect()};
 process.on('message',m=>{if(m?.type==='shutdown')void stop()});process.once('disconnect',()=>void stop());
 const {ctx}=running;process.send({type:'ready',version:require(installAnchor).version,node:process.version,electron:process.versions.electron,url:ctx.connection.authenticatedUrl(ctx.webServer.protocol+'//127.0.0.1:'+ctx.webServer.port)});
})().catch(e=>{process.send?.({type:'fatal',message:e.stack});process.exitCode=1;process.disconnect?.()});
`)
const child = spawn(join(installed, 'DeepSeek Harness.exe'), ['--expose-internals', join(dir, 'host.cjs'), runtime, profile], { cwd: dir, windowsHide: true, stdio: ['ignore','pipe','pipe','ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_AGENTS_HOME: join(dir, 'agents') } })
let hostLog = '', browser, page
const redact = text => text.replace(/https?:\/\/127\.0\.0\.1:[^\s"']+/g, '[isolated-host-url]')
for (const stream of [child.stdout,child.stderr]) stream.on('data', data => { hostLog += redact(String(data)) })
const results = { status: 'running', cases: [], screenshots: [], errors: [], overflow: [], overlaysHandled: 0 }
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Isolated host startup timed out')), 45000)
    child.on('message', m => { if (m.type === 'ready') { clearTimeout(timer); resolve(m) } else if (m.type === 'fatal') { clearTimeout(timer); reject(new Error(m.message)) } })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
  })
  results.runtime = { dsh: ready.version, node: ready.node, electron: ready.electron }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  page = await browser.newPage({ viewport: { width: 1536, height: 1050 }, acceptDownloads: true }); page.setDefaultTimeout(15000)
  page.on('pageerror', e => results.errors.push(redact(e.stack || e.message)))
  page.on('console', m => { if (m.type() === 'error') results.errors.push(redact(m.text())) })
  const button = name => page.getByRole('button', { name, exact: true })
  await page.addLocatorHandler(page.getByText('预览版说明', { exact: true }), async () => {
    await button('继续').click(); results.overlaysHandled += 1
  })
  const tab = name => page.getByRole('navigation', { name: '世界观功能' }).getByRole('button', { name, exact: true }).click()
  const gotoWorld = async () => {
    await page.getByRole('navigation', { name: '写作工作台导航' }).getByRole('button', { name: /世界观/ }).click()
    await page.getByRole('heading', { name: '世界观', exact: true }).waitFor()
  }
  const shot = async (name, focus) => {
    await page.locator('.ww-content').evaluate(e => { e.scrollTop = 0 })
    const sizes = await page.evaluate(() => ['html','.ww-content','.wb-page','.wn-page'].flatMap(selector => { const e = document.querySelector(selector); return e ? [{ selector, client: e.clientWidth, scroll: e.scrollWidth }] : [] }))
    assert.ok(sizes.every(s => s.scroll <= s.client + 1), JSON.stringify(sizes)); results.overflow.push({ viewport: page.viewportSize(), sizes })
    if (focus) await page.locator(focus).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(evidence, `${name}.png`) }); results.screenshots.push(`${name}.png`)
  }
  const saved = () => page.getByRole('status').filter({ hasText: '草稿已保存到共享数据库' }).waitFor()
  const publish = async () => {
    await page.getByRole('checkbox', { name: /我已审阅此版本/ }).check(); await button('发布正式版本').click()
    await page.getByRole('status').filter({ hasText: '正式版本已发布' }).waitFor()
  }
  await page.goto(ready.url)
  await button('写作工作台').waitFor()
  await button('写作工作台').click(); await gotoWorld()
  await button('＋ 新建世界').click()
  await page.getByLabel('世界名称', { exact: true }).fill('雾港小城')
  await page.getByLabel('世界简介', { exact: true }).fill('一座围绕港口生活的当代小城，没有超自然力量。')
  await page.getByLabel('故事时代', { exact: true }).fill('2026 年')
  await page.getByLabel('故事空间', { exact: true }).fill('旧街与渡口')
  await page.getByLabel('现实或架空', { exact: true }).selectOption('real')
  for (const name of ['力量','势力','地点','物品','历史']) await page.getByRole('checkbox', { name: new RegExp(name) }).uncheck()
  await tab('设定目录'); assert.equal(await page.getByLabel('设定分类', { exact: true }).locator('option').count(), 2)
  await button('＋ 添加设定').click(); await page.getByLabel('设定名称', { exact: true }).fill('老街'); await page.getByLabel('基本描述', { exact: true }).fill('沿河延伸的居民街道，清晨有早市。')
  assert.equal(await page.getByLabel('可选模板', { exact: true }).inputValue(), '')
  for (const type of ['power','faction','item','history','place']) {
    await page.getByLabel('可选模板', { exact: true }).selectOption(type)
    assert.equal(await page.getByLabel('基本描述', { exact: true }).inputValue(), '沿河延伸的居民街道，清晨有早市。')
  }
  await tab('世界范围'); await page.getByRole('checkbox', { name: /地点/ }).check()
  await tab('设定目录'); await page.getByLabel('设定分类', { exact: true }).selectOption('place')
  await page.getByRole('button', { name: /老街.*设定/ }).click()
  assert.equal(await page.getByLabel('可选模板', { exact: true }).inputValue(), 'place')
  await tab('世界范围'); await page.getByRole('checkbox', { name: /地点/ }).uncheck()
  await tab('设定目录'); assert.equal(await page.getByLabel('设定分类', { exact: true }).inputValue(), 'all')
  await page.getByRole('button', { name: /老街.*设定/ }).click()
  await shot('desktop-editor')
  await button('保存草稿').click(); await saved(); await publish()
  const worldId = await page.getByLabel('当前世界', { exact: true }).inputValue()
  results.cases.push('All five templates are optional; changing or hiding templates preserves content and minimal location publication')
  assert.deepEqual(await page.getByRole('navigation', { name: '世界观功能' }).getByRole('button').allTextContents(), ['世界范围', '设定目录', '世界硬规则', '关联关系', '术语与别名'])
  await tab('世界范围'); assert.equal(await page.getByText('旧目录信息（保留原数据）', { exact: true }).count(), 0); await shot('desktop-scope')
  results.cases.push('Only five editing tabs remain; overview, history and pending-question panels are absent')
  await button('加入小说资产').click()
  await page.getByRole('heading', { name: '让故事，从这里开始' }).waitFor()
  await page.getByLabel('资产类型', { exact: true }).selectOption('persona'); await page.getByLabel('资产名称', { exact: true }).fill('克制叙述者'); await page.getByLabel('资产内容', { exact: true }).fill('通过行动表现情绪。'); await button('登记资产').click()
  await page.getByRole('status').filter({ hasText: '资产已加入' }).waitFor()
  await page.getByLabel('小说名称', { exact: true }).fill('小城来信')
  await page.getByLabel('选择作者人格', { exact: true }).selectOption({ label: '克制叙述者 · v1' })
  await page.getByLabel('选择世界观', { exact: true }).selectOption({ label: '雾港小城 · v2' })
  await button('创建小说并进入设定 →').click(); await page.getByLabel('一句话前提', { exact: true }).waitFor()
  const queryMaterials = async () => {
    await page.getByLabel('本次需要的设定', { exact: true }).fill('老街')
    await button('查询世界观材料').click()
    await page.getByRole('status').filter({ hasText: '材料已选出 · v2' }).waitFor()
    const material = await page.getByLabel('本次世界观材料', { exact: true }).inputValue()
    assert.match(material, /老街/); assert.match(material, /清晨有早市/); assert.doesNotMatch(material, /河街/)
  }
  await queryMaterials(); await page.getByText('入选依据与来源', { exact: true }).click(); await shot('desktop-novel-materials', '[aria-label="本次世界观材料"]')
  await page.setViewportSize({ width: 390, height: 844 }); await shot('mobile-novel-materials', '[aria-label="本次世界观材料"]')
  await page.setViewportSize({ width: 1536, height: 1050 })
  results.cases.push('Novel queries exact bound v2 via owner Gateway; hidden location template does not suppress material')
  await gotoWorld(); await tab('设定目录'); await page.getByRole('button', { name: /老街.*设定/ }).click()
  await page.getByLabel('设定名称', { exact: true }).fill('河街'); await button('保存草稿').click(); await saved(); await publish()
  await tab('术语与别名'); assert.equal(await page.getByLabel('术语名称', { exact: true }).inputValue(), '老街')
  await shot('desktop-terms')
  await tab('世界范围'); await button('加入小说资产').click()
  await page.getByRole('navigation', { name: '小说模块导航' }).getByRole('button', { name: /资产配置/ }).click()
  const worldPicker = page.getByLabel('选择世界观', { exact: true })
  assert.match(await worldPicker.locator('option:checked').innerText(), /v2/)
  assert.equal(await worldPicker.locator('option').filter({ hasText: '雾港小城 · v4' }).count(), 1)
  results.cases.push('Novel binding stays at v2 after explicit addition of v4; rename retains old alias')
  await page.getByRole('navigation', { name: '小说模块导航' }).getByRole('button', { name: /小说设定/ }).click()
  await queryMaterials(); results.cases.push('Query still reads old v2 text after v4 publication and asset registration')
  await gotoWorld(); await tab('设定目录'); await page.getByRole('button', { name: /河街.*设定/ }).click()
  await page.getByLabel('影响程度', { exact: true }).selectOption('key')
  await button('保存草稿').click(); await saved(); await page.getByRole('checkbox', { name: /我已审阅此版本/ }).check(); await button('发布正式版本').click()
  await page.getByRole('alert').filter({ hasText: '还有阻断问题' }).waitFor()
  assert.equal(await page.getByLabel('设定名称', { exact: true }).inputValue(), '河街')
  await shot('desktop-blocked')
  await page.getByLabel('影响程度', { exact: true }).selectOption('background'); await button('保存草稿').click(); await saved()
  results.cases.push('Publication gate rejects incomplete key rules and preserves editable input')
  await page.setViewportSize({ width: 390, height: 844 }); await shot('mobile-editor')
  await tab('世界范围'); await shot('mobile-scope')
  await page.setViewportSize({ width: 1536, height: 1050 })
  await page.reload(); await button('写作工作台').click(); await gotoWorld()
  await page.getByLabel('当前世界', { exact: true }).selectOption(worldId); await page.getByLabel('世界名称', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('世界名称', { exact: true }).inputValue(), '雾港小城')
  await tab('设定目录'); await page.getByRole('button', { name: /河街.*设定/ }).click()
  assert.equal(await page.getByLabel('设定名称', { exact: true }).inputValue(), '河街')
  results.cases.push('390px responsive layout has no overflow; reload restores saved world/records from isolated SQLite')
  await page.getByRole('navigation', { name: '写作工作台导航' }).getByRole('button', { name: /Wiki/ }).click(); await page.getByRole('heading', { name: 'Wiki', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '写作工作台导航' }).getByRole('button', { name: '质量检测', exact: true }).click(); await page.getByRole('heading', { name: '质量检测', exact: true }).waitFor()
  await button('返回 DSH').click(); results.cases.push('Adjacent Wiki/quality pages, exit and host navigation remain available')
  assert.deepEqual(results.errors, []); results.status = 'passed'
} catch (e) {
  results.status = 'failed'; results.failure = redact(e.stack || e.message)
  if (page) { await page.screenshot({ path: join(evidence, 'host-failure.png') }); await writeFile(join(evidence, 'host-failure.txt'), redact((await page.locator('body').innerText()).slice(-10000))) }
  throw e
} finally {
  await browser?.close(); await writeFile(join(evidence, 'host.log'), hostLog); await writeFile(join(evidence, 'host-verification.json'), JSON.stringify(results, null, 2))
  if (child.connected) { child.send({ type: 'shutdown' }); await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]) }
  if (child.exitCode === null) child.kill()
}
console.log(JSON.stringify({ status: results.status, runtime: results.runtime, cases: results.cases.length, screenshots: results.screenshots.length, errors: results.errors }))
