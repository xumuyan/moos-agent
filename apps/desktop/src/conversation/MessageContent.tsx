import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { withoutCodeBlocks } from './activity';

/** Model output is text, never executable HTML or automatically loaded remote media. */
export default function MessageContent({ text }: { text: string }) {
  return <div className="assistant-content"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    pre: () => <p className="omitted-code">（代码内容已省略）</p>,
    img: ({ alt }) => <span className="message-reference">{alt || '图片'}</span>,
    // References remain readable without navigating the desktop WebView away from the app.
    a: ({ children, href }) => <span className="message-reference" title={href}>{children}</span>,
  }}>{withoutCodeBlocks(text)}</Markdown></div>;
}
