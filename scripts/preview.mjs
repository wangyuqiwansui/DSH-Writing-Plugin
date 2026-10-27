// Local review server; never reads user projects or starts a DSH session.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { qualityPreviewServer } from './quality-preview-server.mjs'
import './create-wiki-preview.mjs'
await build({ entryPoints: ['scripts/preview.tsx'], outfile: '.preview/app.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' } })
const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH Writing Plugin · 本地预览</title><body style="margin:0;background:#f6f6f6"><div id="root"></div><script src="/app.js"></script></body></html>'
let quality
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  if (path === '/quality-api' && req.method === 'POST') {
    if (req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end(); return }
    const abort = new AbortController()
    res.on('close', () => { if (!res.writableEnded) abort.abort() })
    try {
      let body = ''
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 2_000_000) throw new Error('请求过大') }
      quality ??= qualityPreviewServer()
      const result = await (await quality).invoke(JSON.parse(body), abort.signal)
      res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(result))
    } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: error.message })) }
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
  if (path !== '/' && path !== '/app.js') { res.writeHead(404).end(); return }
  try {
    res.setHeader('Content-Type', path === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(req.method === 'HEAD' ? undefined : path === '/' ? html : await readFile('.preview/app.js'))
  } catch { res.writeHead(500).end('Preview unavailable') }
})
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Writing workbench preview: http://127.0.0.1:${server.address().port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { if (quality) await (await quality).dispose() }))
