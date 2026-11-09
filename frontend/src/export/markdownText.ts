// Turns the assistant's Markdown into simple blocks for the PDF transcript and for reading
// aloud. Structure survives (headings, lists, quotes, tables, links) and so do bold and
// italic, as styled runs; other markers are dropped. A small line-based converter rather
// than a full parser: chat replies use simple Markdown, and this keeps the export light.

/** A stretch of text in one style. */
export type Run = { text: string; bold?: boolean; italic?: boolean }

export type TextBlock =
  | { kind: 'heading'; text: string; runs: Run[] }
  | { kind: 'paragraph'; text: string; runs: Run[] }
  | { kind: 'item'; marker: string; text: string; runs: Run[]; level: number }
  | { kind: 'quote'; text: string; runs: Run[] }
  | { kind: 'code'; text: string }
  /** Every row has as many cells as the header. Each cell is a list of runs. */
  | { kind: 'table'; header: Run[][]; rows: Run[][][] }
  | { kind: 'rule' }

// Characters that must not be read as Markdown (escaped ones, and those inside code or web
// addresses) are swapped for private-use characters while parsing, then swapped back.
const HIDE_OFFSET = 0xe000
const hideAll = (text: string) => text.replace(/[*_~|\\`[\]()<>]/g, (char) => String.fromCharCode(HIDE_OFFSET + char.charCodeAt(0)))
const unhide = (text: string) => text.replace(/[-]/g, (char) => String.fromCharCode(char.charCodeAt(0) - HIDE_OFFSET))
const hideEscapes = (text: string) =>
  text.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, (_, char: string) => String.fromCharCode(HIDE_OFFSET + char.charCodeAt(0)))

/** Splits text into italic and upright runs. Underscores only count at word edges, so names like snake_case stay intact. */
function splitItalic(text: string, bold: boolean): Run[] {
  const runs: Run[] = []
  let last = 0
  const italic = /(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\*)|(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g
  for (const match of text.matchAll(italic)) {
    const prefix = match[1] ?? match[3]
    const start = match.index + prefix.length
    runs.push({ text: text.slice(last, start), bold }, { text: match[2] ?? match[4], bold, italic: true })
    last = match.index + match[0].length
  }
  runs.push({ text: text.slice(last), bold })
  return runs
}

/** Parses inline Markdown into styled runs: bold and italic are kept, other markers removed. */
export function parseInline(markdown: string): Run[] {
  const text = hideEscapes(markdown)
    // Inline code keeps its text exactly.
    .replace(/`([^`]+)`/g, (_, code: string) => hideAll(code))
    // Images: keep the description.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Links: "text (address)", or just the address when they're the same.
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label: string, url: string) =>
      label === url ? hideAll(url) : `${label} (${hideAll(url)})`,
    )
    // Autolinks like <https://…>, and bare addresses.
    .replace(/<(https?:\/\/[^>\s]+)>/g, (_, url: string) => hideAll(url))
    .replace(/\bhttps?:\/\/[^\s<>()]+/g, (url) => hideAll(url))
    // Any HTML tags, and strikethrough markers.
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')

  const runs: Run[] = []
  let last = 0
  for (const match of text.matchAll(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g)) {
    runs.push(...splitItalic(text.slice(last, match.index), false), ...splitItalic(match[2], true))
    last = match.index + match[0].length
  }
  runs.push(...splitItalic(text.slice(last), false))

  // Restore hidden characters, drop empty runs and merge neighbours in the same style.
  const merged: Run[] = []
  for (const run of runs) {
    const piece = { ...run, text: unhide(run.text) }
    if (!piece.bold) delete piece.bold
    if (!piece.italic) delete piece.italic
    if (!piece.text) continue
    const previous = merged[merged.length - 1]
    if (previous && Boolean(previous.bold) === Boolean(piece.bold) && Boolean(previous.italic) === Boolean(piece.italic)) {
      previous.text += piece.text
    } else {
      merged.push(piece)
    }
  }
  return merged
}

export const runsText = (runs: Run[]) => runs.map((run) => run.text).join('')

/** Removes inline Markdown: emphasis, code ticks, links and stray HTML. */
export function plainInline(text: string): string {
  return runsText(parseInline(text))
}

function inline(markdown: string): { text: string; runs: Run[] } {
  const runs = parseInline(markdown)
  return { text: runsText(runs), runs }
}

/** A table row's cells. The outer pipes are optional; escaped pipes stay in the cell. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/\\\|/g, hideAll('|'))
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

const isSeparatorCell = (cell: string) => /^:?-+:?$/.test(cell)

/**
 * Whether a table starts at this line: a header row, then a separator row such as
 * "| --- | :---: |" or "--- | ---". Pipes at the ends of the rows are optional.
 */
function isTableStart(header: string, separator: string | undefined): boolean {
  if (!separator || !header.includes('|') || !separator.includes('-')) return false
  // A single column needs its pipes, or "Text" followed by "---" would count.
  if (!separator.includes('|') && !header.trim().startsWith('|')) return false
  const cells = splitRow(separator)
  return cells.every(isSeparatorCell) && cells.length === splitRow(header).length
}

export function markdownToBlocks(markdown: string): TextBlock[] {
  const blocks: TextBlock[] = []
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', ...inline(paragraph.join(' ')) })
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
      blocks.push({ kind: 'heading', ...inline(heading[1]) })
      continue
    }

    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flush()
      blocks.push({ kind: 'rule' })
      continue
    }

    // Tables: a header row, a separator row, then rows until a blank line or a line without pipes.
    if (isTableStart(trimmed, lines[i + 1])) {
      flush()
      const header = splitRow(trimmed)
      const rows: Run[][][] = []
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|'); i++) {
        const cells = splitRow(lines[i])
        rows.push(header.map((_, index) => parseInline(unhide(cells[index] ?? ''))))
      }
      blocks.push({ kind: 'table', header: header.map((cell) => parseInline(unhide(cell))), rows })
      i--
      continue
    }

    const quote = line.match(/^\s*>\s?(.*)$/)
    if (quote) {
      flush()
      blocks.push({ kind: 'quote', ...inline(quote[1]) })
      continue
    }

    // List items, including task lists. Two spaces of indent per nesting level.
    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/)
    if (item) {
      flush()
      const level = Math.min(Math.floor(item[1].replace(/\t/g, '  ').length / 2), 4)
      const marker = item[3] !== undefined ? (item[3] === ' ' ? '[ ]' : '[x]') : /\d/.test(item[2]) ? item[2].replace(')', '.') : '•'
      blocks.push({ kind: 'item', marker, level, ...inline(item[4]) })
      continue
    }

    // A wrapped line that continues the previous list item.
    const previous = blocks[blocks.length - 1]
    if (paragraph.length === 0 && previous?.kind === 'item' && /^\s{2,}\S/.test(line)) {
      const more = inline(trimmed)
      previous.text = `${previous.text} ${more.text}`
      previous.runs = [...previous.runs, { text: ' ' }, ...more.runs]
      continue
    }

    paragraph.push(trimmed)
  }
  flush()
  return blocks
}
