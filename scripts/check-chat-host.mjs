// Full isolated Host + Web acceptance. Installation-private boot paths are diagnostic only.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const evidence = resolve(process.env.OUTPUT_DIR || '.harness-analysis/ANALYSIS_20261024_FLOATING_CHAT')
await mkdir(evidence, { recursive: true })
const dir = await mkdtemp(join(evidence, 'runtime-')), home = join(dir, 'home'), profile = join(home, 'profiles', 'smoke')
const installed = process.env.DSH_INSTALL_PATH || join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness')
const runtime = `${installed}/resources/app.asar/dsh`
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
await mkdir(join(profile, 'node_modules'), { recursive: true }); await mkdir(join(dir, 'agents'), { recursive: true })
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'writing-chat-smoke', private: true, dependencies: { 'dsh-writing-workbench': `link:${root.replaceAll('\\', '/')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-writing-workbench'] } } }, null, 2))
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
    defaultModel:
      provider: test-chat
      model: writer
      reasoningEffort: high
    chat:
      timeoutMs: 5000
      maxTokens: 1024
`)
await symlink(root, join(profile, 'node_modules/dsh-writing-workbench'), 'junction')
await writeFile(join(dir, 'host.cjs'), `
const {pathToFileURL}=require('node:url');
const {setTimeout:delay}=require('node:timers/promises');
(async()=>{
 const runtime=process.argv[2], project=process.argv[3];
 const app=await import(pathToFileURL(runtime+'/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'));
 const {runProfile}=await import(pathToFileURL(runtime+'/node_modules/@deepseek-ai/dsh/lib/profile-boot.js'));
 const {LlmAdapter}=await import(pathToFileURL(runtime+'/node_modules/@deepseek-ai/dsh-llm/lib/index.js'));
 const installAnchor=runtime+'/node_modules/@deepseek-ai/dsh/package.json';
 const profile=app.loadProfileDirectory('dsh',project,installAnchor);
 const running=await runProfile({environment:app.loadLayeredEnv('dsh'),profile:'smoke',resolvedProfile:{profile,installAnchor},patchFiles:[],args:['--no-open','--host','127.0.0.1','--port','0']});
 const send=m=>process.connected&&process.send(m);
 let count=0; const attempts=new Map();
 class FixtureAdapter extends LlmAdapter {
  async listModels(provider){return [{provider,id:'writer',name:'测试写作模型'}]}
  async resolveModel(provider,id){return {provider,id,name:'测试写作模型',reasoning:{efforts:[{id:'low',name:'低'},{id:'high',name:'高'}],defaultEffort:'high'}}}
  async *stream(options){
   const input=options.messages.at(-1).content.map(c=>c.type==='text'?c.text:'').join('');
   const call=++count, attempt=(attempts.get(input)||0)+1;attempts.set(input,attempt);
   send({type:'model-call',call,input,attempt,provider:options.provider,model:options.model,maxTokens:options.maxTokens,reasoningEffort:options.reasoningEffort,roles:options.messages.map(m=>m.role),sources:options.messages.filter(m=>m.role==='assistant').map(m=>m.source),tools:!!options.tools});
   const aborted=()=>send({type:'model-aborted',call});options.signal.addEventListener('abort',aborted,{once:true});
   try {
    yield {type:'reasoning-delta',index:0,text:'fixture private reasoning'};
    await delay(80,undefined,{signal:options.signal});
    if(input==='慢速测试'||input==='超时测试'){
     yield {type:'text-delta',index:1,text:'这是已经收到的部分内容。'};
     await delay(12000,undefined,{signal:options.signal});
    } else if(input==='错误测试'&&attempt===1){
     yield {type:'text-delta',index:1,text:'回复中途发生错误。'};
     yield {type:'finish',reason:{kind:'error',failure:{code:'FIXTURE',message:'fixture failure'}}};return;
    } else {
     for(const text of ['可以从**人物的选择**开始。\\n\\n','- 明确他想得到什么。\\n','- 给这个选择安排一个代价。\\n\\n','<script>window.fixtureInjected=true</script>']){
      yield {type:'text-delta',index:1,text}; await delay(90,undefined,{signal:options.signal});
     }
    }
    yield {type:'finish',reason:{kind:input==='截断测试'?'max-tokens':'stop'}};
   } finally { options.signal.removeEventListener('abort',aborted);send({type:'model-closed',call}) }
  }
 }
 const registration=running.ctx.llm.registerAdapter(['test-chat'],new FixtureAdapter());
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;registration();await running.shutdown.shutdown(0);if(process.connected)process.disconnect()};
 process.on('message',m=>{if(m?.type==='shutdown')void stop()});process.once('disconnect',()=>void stop());
 const {ctx}=running;send({type:'ready',version:require(installAnchor).version,node:process.version,electron:process.versions.electron,url:ctx.connection.authenticatedUrl(ctx.webServer.protocol+'//127.0.0.1:'+ctx.webServer.port)});
})().catch(e=>{process.send?.({type:'fatal',message:e.stack});process.exitCode=1;process.disconnect?.()});
`)
const child = spawn(join(installed, 'DeepSeek Harness.exe'), ['--expose-internals', join(dir, 'host.cjs'), runtime, profile], { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, DSH_AGENTS_HOME: join(dir, 'agents') } })
let hostLog = '', browser, page
const redact = text => text.replace(/https?:\/\/127\.0\.0\.1:[^\s"']+/g, '[isolated-host-url]')
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { hostLog += redact(String(data)) })
const results = { status: 'running', cases: [], screenshots: [], errors: [], layout: [], modelEvents: [], placements: [] }
child.on('message', m => { if (m.type.startsWith('model-')) results.modelEvents.push(m) })
const eventually = async (predicate, message) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(50) }; throw new Error(message) }
try {
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Isolated host startup timed out')), 45000)
    child.on('message', m => { if (m.type === 'ready') { clearTimeout(timer); resolve(m) } else if (m.type === 'fatal') { clearTimeout(timer); reject(new Error(m.message)) } })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Host exited ${code}`)) })
  })
  results.runtime = { dsh: ready.version, node: ready.node, electron: ready.electron }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
  const context = await browser.newContext({ viewport: { width: 1536, height: 1050 }, permissions: ['clipboard-read', 'clipboard-write'] })
  page = await context.newPage(); page.setDefaultTimeout(12000)
  page.on('pageerror', e => results.errors.push(redact(e.stack || e.message)))
  page.on('console', m => { if (m.type() === 'error') results.errors.push(redact(m.text())) })
  const button = name => page.getByRole('button', { name, exact: true })
  const panel = page.getByRole('dialog', { name: 'AI 对话', exact: true }), input = page.getByRole('textbox', { name: '对话内容', exact: true })
  const shot = async name => { await page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled' }); results.screenshots.push(`${name}.png`) }
  const calls = () => results.modelEvents.filter(m => m.type === 'model-call')
  const send = async text => { await input.fill(text); await input.press('Enter') }
  const completed = async () => { await button('停止生成').waitFor({ state: 'hidden' }); await button('重新生成').waitFor() }
  const layout = async () => {
    const sizes = await page.evaluate(() => ['html', '.ww-topbar', '.ww-top-actions', '#ww-chat-toggle', '#ww-floating-chat'].map(selector => {
      const e = document.querySelector(selector); if (!e) return { selector, absent: true }
      const r = e.getBoundingClientRect(); return { selector, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, client: e.clientWidth, scroll: e.scrollWidth }
    }))
    results.layout.push({ viewport: page.viewportSize(), sizes })
    const [html, bar, actions, trigger, chat] = sizes
    assert.ok(html.scroll <= html.client + 1, JSON.stringify(sizes))
    assert.ok(trigger.left >= 0 && trigger.right <= page.viewportSize().width && trigger.top >= bar.top && trigger.bottom <= bar.bottom, JSON.stringify(sizes))
    assert.ok(actions.scroll <= actions.client + 1 && actions.right <= page.viewportSize().width, JSON.stringify(sizes))
    if (!chat.absent) assert.ok(chat.left >= 0 && chat.right <= page.viewportSize().width && chat.bottom <= page.viewportSize().height && chat.top >= bar.bottom, JSON.stringify(sizes))
  }
  await page.goto(ready.url); await button('写作工作台').waitFor()
  const intro = button('继续'); if (await intro.isVisible()) { await intro.click(); await intro.waitFor({ state: 'hidden' }) }
  await shot('native-dsh-reference')
  await button('写作工作台').click(); await button('打开 AI 对话').waitFor()
  assert.equal(await panel.count(), 0); await layout(); await shot('desktop-collapsed')
  results.cases.push('Workbench starts collapsed with chat entry in the upper right')
  await button('打开 AI 对话').click(); await input.waitFor(); assert.equal(await input.evaluate(e => e === document.activeElement), true)
  await shot('desktop-empty')
  const heading = panel.locator('.ww-chat-heading')
  const dragChat = async (dx, dy, end = true) => {
    const handle = await heading.boundingBox(), from = { x: handle.x + 25, y: handle.y + 15 }
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
    if (end) await page.mouse.up()
  }
  const samePosition = (actual, expected) => Math.abs(actual.x - expected.x) < 1 && Math.abs(actual.y - expected.y) < 1
  const floatingInBounds = () => panel.evaluate(e => { const r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect(); return r.left >= p.left && r.top >= p.top && r.right <= p.right + 1 && r.bottom <= p.bottom + 1 })
  const anchored = await panel.boundingBox()
  assert.equal(await button('解锁对话位置').getAttribute('aria-pressed'), 'true')
  await dragChat(-120, 60); assert.ok(samePosition(await panel.boundingBox(), anchored), 'Fixed chat must not move')
  assert.equal(await page.evaluate(() => window.getSelection().toString()), '', 'Fixed header gesture must not select page content')
  await button('解锁对话位置').click(); await dragChat(-220, 110)
  assert.equal(await page.evaluate(() => window.getSelection().toString()), '', 'Moving the panel must not select page content')
  const moved = await panel.boundingBox(); assert.ok(Math.abs(moved.x - anchored.x + 220) < 1 && Math.abs(moved.y - anchored.y - 110) < 1)
  await layout(); await shot('desktop-dragged')
  await heading.focus(); await heading.press('ArrowLeft'); const keyed = await panel.boundingBox(); assert.ok(Math.abs(keyed.x - moved.x + 10) < 1)
  await input.fill('拖动后的草稿'); await button('收起对话').click(); await button('打开 AI 对话').click()
  assert.ok(samePosition(await panel.boundingBox(), keyed)); assert.equal(await input.inputValue(), '拖动后的草稿')
  await dragChat(60, 40, false); await input.press('Escape'); await page.mouse.up()
  assert.equal(await panel.count(), 1); assert.ok(samePosition(await panel.boundingBox(), keyed), 'Escape cancels drag before closing')
  await dragChat(60, 40, false); await panel.locator('.ww-chat-header').dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up()
  assert.ok(samePosition(await panel.boundingBox(), keyed), 'Pointer cancellation restores the previous placement')
  await dragChat(-3000, -3000); await eventually(floatingInBounds, 'Drag escaped top/left bounds')
  await dragChat(6000, 6000); await eventually(floatingInBounds, 'Drag escaped bottom/right bounds')
  const edge = await panel.boundingBox(); await button('放大对话').click(); await eventually(floatingInBounds, 'Expanded floating chat escaped bounds'); await layout()
  await button('还原对话大小').click(); await page.setViewportSize({ width: 390, height: 844 }); await eventually(floatingInBounds, 'Resize left a floating chat offscreen')
  await layout(); await shot('mobile-dragged'); assert.equal(await button('新对话').isVisible(), true)
  await page.setViewportSize({ width: 1536, height: 1050 }); await button('固定到右上角').click()
  assert.ok(samePosition(await panel.boundingBox(), anchored)); assert.equal(await button('解锁对话位置').getAttribute('aria-pressed'), 'true')
  assert.equal(calls().length, 0); results.placements.push({ anchored, moved, keyboard: keyed, edge })
  results.cases.push('Chat defaults fixed; unlocking enables bounded pointer/keyboard movement; collapse retains placement/draft; Escape and pointercancel roll back drag; resize/expand stay visible; pin restores anchor')
  await send('帮我梳理一个故事创意'); await page.getByLabel('AI 回复', { exact: true }).getByText('明确他想得到什么。', { exact: true }).waitFor(); await completed()
  assert.equal(await panel.locator('script').count(), 0); assert.equal(await page.evaluate(() => window.fixtureInjected), undefined)
  assert.equal(await panel.getByText('fixture private reasoning', { exact: false }).count(), 0)
  assert.equal(calls()[0].provider, 'test-chat'); assert.equal(calls()[0].reasoningEffort, 'high'); assert.equal(calls()[0].maxTokens, 1024); assert.equal(calls()[0].tools, false)
  await button('复制').click(); assert.match(await page.evaluate(() => navigator.clipboard.readText()), /人物的选择/)
  await shot('desktop-reply'); await button('放大对话').click(); await layout(); await shot('desktop-expanded'); await button('还原对话大小').click()
  results.cases.push('Real Typert stream uses selected model/effort/token cap; Markdown is safe; copy and expand work')
  await send('这个人物的代价呢'); await completed(); assert.deepEqual(calls()[1].roles, ['user', 'assistant', 'user']); assert.equal(calls()[1].sources[0].model, 'writer')
  await input.fill('尚未发送的草稿'); await button('收起对话').click(); await page.getByRole('navigation', { name: '写作工作台导航' }).getByRole('button', { name: /世界观/ }).click()
  await button('打开 AI 对话').click(); assert.equal(await input.inputValue(), '尚未发送的草稿'); assert.equal(await panel.getByLabel('你的消息', { exact: true }).count(), 2)
  await input.press('Escape'); assert.equal(await panel.count(), 0); assert.equal(await button('打开 AI 对话').evaluate(e => e === document.activeElement), true)
  await button('打开 AI 对话').click(); await input.fill('中文输入'); const beforeComposition = calls().length
  await input.dispatchEvent('compositionstart'); await input.press('Enter'); assert.equal(calls().length, beforeComposition)
  await input.dispatchEvent('compositionend'); await input.fill('换行'); await input.press('Shift+Enter'); assert.equal(await input.inputValue(), '换行\n')
  results.cases.push('Conversation and draft survive navigation/collapse; Escape returns focus; IME Enter does not send; Shift+Enter inserts newline')
  await button('新对话').click(); await send('慢速测试'); await panel.getByText('这是已经收到的部分内容。', { exact: true }).waitFor()
  const slowCall = calls().at(-1).call; assert.equal(await button('新对话').isDisabled(), true)
  await button('停止生成').click(); await panel.getByText('已停止生成', { exact: true }).waitFor()
  await eventually(() => results.modelEvents.some(m => m.type === 'model-aborted' && m.call === slowCall), 'Stop did not propagate to the provider')
  await button('新对话').click(); await send('错误测试'); await panel.getByRole('alert').waitFor(); assert.match(await panel.innerText(), /回复中途发生错误/)
  await button('重新生成').click(); await completed(); assert.equal(await panel.getByLabel('你的消息', { exact: true }).count(), 1)
  assert.match(await panel.innerText(), /人物的选择/)
  results.cases.push('Stop cancels provider and preserves partial answer; failed answer is visible; retry replaces one turn')
  await button('新对话').click(); await send('超时测试'); await panel.getByRole('alert').filter({ hasText: '回复超时' }).waitFor(); await completed()
  assert.match(await panel.innerText(), /这是已经收到的部分内容/)
  await button('新对话').click(); await send('截断测试'); await completed(); await panel.getByText('本次回复达到长度上限，可以发送“继续”。', { exact: true }).waitFor()
  results.cases.push('Deadline and max-token outcomes preserve visible partial text with an explicit status')
  await page.setViewportSize({ width: 390, height: 844 }); await shot('mobile-reply'); await layout()
  await button('收起对话').click(); await button('切换工作台导航').click(); await page.getByRole('navigation', { name: '写作工作台导航' }).getByRole('button', { name: /工作台/ }).click()
  await shot('mobile-home-collapsed'); await layout(); await button('打开 AI 对话').click(); await layout(); await shot('mobile-home-chat')
  await page.setViewportSize({ width: 1024, height: 500 }); await layout(); await shot('short-window')
  results.cases.push('Chat entry and floating panel remain within the viewport on mobile and short windows')
  await page.setViewportSize({ width: 1536, height: 1050 }); await button('新对话').click(); await send('慢速测试'); await panel.getByText('这是已经收到的部分内容。', { exact: true }).waitFor()
  await context.setOffline(true); await panel.getByText(/连接已断开/).waitFor(); await input.fill('断线期间草稿'); assert.equal(await button('发送消息').isDisabled(), true)
  await context.setOffline(false); await eventually(() => button('发送消息').isEnabled(), 'Chat did not reconnect')
  assert.equal(await input.inputValue(), '断线期间草稿'); await input.fill('恢复后的消息'); await input.press('Enter'); await completed()
  results.cases.push('Transport loss cancels active reply; reconnect preserves draft and accepts a new request')
  await page.reload(); await button('写作工作台').click(); await button('打开 AI 对话').waitFor(); assert.equal(await panel.count(), 0)
  await button('打开 AI 对话').click(); assert.equal(await panel.getByLabel('你的消息', { exact: true }).count(), 0)
  assert.equal(await button('解锁对话位置').getAttribute('aria-pressed'), 'true')
  await button('收起对话').click(); await button('返回 DSH').click(); results.cases.push('Reload starts a fresh collapsed chat; return to native DSH remains available')
  assert.deepEqual(results.errors, []); results.status = 'passed'
} catch (e) {
  results.status = 'failed'; results.failure = redact(e.stack || e.message)
  if (page) { await page.screenshot({ path: join(evidence, 'host-failure.png') }); await writeFile(join(evidence, 'host-failure.txt'), redact((await page.locator('body').innerText()).slice(-10000))) }
  throw e
} finally {
  await browser?.close(); await writeFile(join(evidence, 'host.log'), hostLog); await writeFile(join(evidence, 'host-verification.json'), JSON.stringify(results, null, 2))
  if (child.connected) { child.send({ type: 'shutdown' }); await Promise.race([once(child, 'exit'), delay(5000)]) }
  if (child.exitCode === null) child.kill()
}
console.log(JSON.stringify({ status: results.status, runtime: results.runtime, cases: results.cases.length, screenshots: results.screenshots.length, errors: results.errors }))
