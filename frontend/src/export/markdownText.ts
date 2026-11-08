// Turns the assistant's Markdown into plain-text blocks for the PDF transcript. Structure
// survives (headings, lists, quotes, tables, links); styling markers don't. A small
// line-based converter rather than a full parser: chat replies use simple Markdown, and
// this keeps the export light.

export type TextBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'item'; marker: string; text: string; level: number }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }

/** Removes inline Markdown: emphasis, code ticks, links and stray HTML. */
export function plainInline(text: string): string {
  return (
    text
      // Images: keep the description.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Links: "text (address)", or just the address when they're the same.
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label: string, url: string) =>
        label === url ? url : `${label} (${url})`,
      )
      // Autolinks like <https://…>.
      .replace(/<(https?:\/\/[^>\s]+)>/g, '$1')
      // Inline code keeps its text.
      .replace(/`([^`]+)`/g, '$1')
      // Bold, then italic, then strikethrough. Underscores only count at word edges,
      // so names like snake_case stay intact.
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
      .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1$2')
      .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
      // Any leftover HTML tags.
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')
      // Backslash escapes, such as \* for a literal asterisk.
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
  )
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => plainInline(cell.trim()))
}

const isTableSeparator = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)

export function markdownToBlocks(markdown: string): TextBlock[] {
  const blocks: TextBlock[] = []
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: plainInline(paragraph.join(' ')) })
      paragraph = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Fenced code: keep the lines exactly as written.
    const fence = trimmed.match(/^(```|~~~)/)
    if (fence) {
      flush()
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) code.push(lines[i])
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }

    if (!trimmed) {
      flush()
      continue
    }

    const heading = trimmed.match(/^#{1,6}\s+(.*?)\s*#*$/)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', text: plainInline(heading[1]) })
      continue
    }

    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flush()
      blocks.push({ kind: 'rule' })
      continue
    }

    // Tables: a header row, a separator row, then data rows. Each data row becomes
    // "Header: value · Header: value", which reads clearly without a grid.
    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flush()
      const headers = splitRow(trimmed)
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
        const cells = splitRow(lines[i])
        const text = cells
          .map((cell, index) => (headers[index] ? `${headers[index]}: ${cell}` : cell))
          .filter((part) => part.trim())
          .join(' · ')
        blocks.push({ kind: 'item', marker: '•', text, level: 0 })
      }
      i--
      continue
    }

    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      flush()
      blocks.push({ kind: 'quote', text: plainInline(quote[1]) })
      continue
    }

    // List items, including task lists. Two spaces of indent per nesting level.
    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/)
    if (item) {
      flush()
      const level = Math.min(Math.floor(item[1].replace(/\t/g, '  ').length / 2), 4)
      const marker = item[3] !== undefined ? (item[3] === ' ' ? '[ ]' : '[x]') : /\d/.test(item[2]) ? item[2].replace(')', '.') : '•'
      blocks.push({ kind: 'item', marker, text: plainInline(item[4]), level })
      continue
    }

    // A wrapped line that continues the previous list item.
    const previous = blocks[blocks.length - 1]
    if (paragraph.length === 0 && previous?.kind === 'item' && /^\s{2,}\S/.test(line)) {
      previous.text = `${previous.text} ${plainInline(trimmed)}`
      continue
    }

    paragraph.push(trimmed)
  }
  flush()
  return blocks
}
