import { createElement, type ReactNode } from 'react'

/** Small safe reading renderer: no HTML execution, embedded images, plugins or remote fetches. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part)
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>
    return part
  })
}
export function Markdown({ text, className = 'ww-markdown' }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!
    const key = i
    if (!line.trim()) { i++; continue }
    if (/^```/.test(line)) {
      const code = []
      i++
      while (i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i++]!)
      i++; blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>); continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) { blocks.push(createElement(`h${Math.min(heading[1]!.length + 2, 6)}`, { key }, inline(heading[2]!))); i++; continue }
    if (/^>\s?/.test(line)) { blocks.push(<blockquote key={key}>{inline(line.replace(/^>\s?/, ''))}</blockquote>); i++; continue }
    if (/^([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\d/.test(line)
      const items: ReactNode[] = []
      const pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/
      while (i < lines.length && pattern.test(lines[i]!)) { items.push(<li key={i}>{inline(lines[i]!.replace(pattern, ''))}</li>); i++ }
      blocks.push(createElement(ordered ? 'ol' : 'ul', { key }, items)); continue
    }
    if (/^([-*_])\1\1+$/.test(line.trim())) { blocks.push(<hr key={key}/>); i++; continue }
    const paragraph = [line]; i++
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|```|>\s?|[-*]\s|\d+\.\s)/.test(lines[i]!)) paragraph.push(lines[i++]!)
    blocks.push(<p key={key}>{inline(paragraph.join('\n'))}</p>)
  }
  return <div className={className}>{blocks}</div>
}
