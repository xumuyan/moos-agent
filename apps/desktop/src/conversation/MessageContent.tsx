import Markdown from 'react-markdown';
import mdCss from '../vendor/dsh/conversation/MarkdownText.module.css';
import assistantCss from '../vendor/dsh/conversation/AssistantMarkdown.module.css';
import remarkGfm from 'remark-gfm';
import { withoutCodeBlocks } from './activity';

/** Model output is text, never executable HTML or automatically loaded remote media. */
export default function MessageContent({ text }: { text: string }) {
  return <div className={assistantCss.root}><div className={`${assistantCss.body} assistant-content`}><div className={mdCss.markdown}><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    pre: () => <p className="omitted-code">（代码内容已省略）</p>,
    table: ({ children }) => <div className={`${mdCss.tableScroll} markdown-table-scroll`} role="region" aria-label="表格内容（可横向滚动）" tabIndex={0}><table>{children}</table></div>,
    img: ({ alt }) => <span className="message-reference">{alt || '图片'}</span>,
    // References remain readable without navigating the desktop WebView away from the app.
    a: ({ children, href }) => <span className={mdCss.fileLink} title={href}>{children}</span>,
  }}>{withoutCodeBlocks(text)}</Markdown></div></div></div>;
}
