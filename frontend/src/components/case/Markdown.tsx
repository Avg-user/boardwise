import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Renders the assistant's Markdown (bold, lists, tables, links). react-markdown never renders
// raw HTML from the text, so a reply can't inject markup into the page.
const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // Wide tables scroll inside the message instead of stretching the chat.
  table: ({ children }) => (
    <div className="markdown__table">
      <table>{children}</table>
    </div>
  ),
  // Headings stay small inside a chat bubble.
  h1: ({ children }) => <p className="markdown__heading">{children}</p>,
  h2: ({ children }) => <p className="markdown__heading">{children}</p>,
  h3: ({ children }) => <p className="markdown__heading">{children}</p>,
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

export default Markdown
