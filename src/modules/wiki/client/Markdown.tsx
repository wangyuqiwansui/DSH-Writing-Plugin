import { Markdown as SharedMarkdown } from '../../../shared/client/Markdown.js'

export function Markdown({ text }: { text: string }) {
  return <SharedMarkdown text={text} className="ww-wiki-markdown"/>
}
