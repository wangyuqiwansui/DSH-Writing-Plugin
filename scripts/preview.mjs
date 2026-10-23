// Local review server; never reads user projects or starts a DSH session.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
await build({ entryPoints: ['scripts/preview.tsx'], outfile: '.preview/app.js', bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"development"' } })
const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH Writing Plugin · 本地预览</title><body style="margin:0;background:#e6ebe2"><div id="root"></div><script src="/app.js"></script></body></html>'
const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  if (path !== '/' && path !== '/app.js') { res.writeHead(404).end(); return }
  try {
    res.setHeader('Content-Type', path === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(req.method === 'HEAD' ? undefined : path === '/' ? html : await readFile('.preview/app.js'))
  } catch { res.writeHead(500).end('Preview unavailable') }
})
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Writing workbench preview: http://127.0.0.1:${server.address().port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close())
