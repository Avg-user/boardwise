// Builds a chat transcript PDF in the browser. Nothing is sent to a server.
// jsPDF is loaded only when someone exports, so it doesn't slow down the app.
import type { jsPDF } from 'jspdf'
import type { ChatMessage } from '../api/types.ts'
import { markdownToBlocks, runsText, type Run } from './markdownText.ts'

export type TranscriptLabels = {
  heading: string
  issue: string
  started: string
  exported: string
  notice: string
  you: string
  assistant: string
  sources: string
  nextSteps: string
  noNextSteps: string
  due: (date: string) => string
  page: (page: number, total: number) => string
}

/** One item from the issue's checklist. `due` is already formatted for display. */
export type TranscriptStep = { title: string; notes: string; due: string | null; done: boolean }

export type TranscriptInput = {
  caseTitle: string
  startedAt: string
  messages: ChatMessage[]
  /** The issue's checklist, printed before the conversation. */
  nextSteps: TranscriptStep[]
  formatDateTime: (iso: string) => string
  labels: TranscriptLabels
}

// The characters the built-in PDF fonts can draw (Windows-1252): Latin-1 plus a few
// typographic extras such as curly quotes, dashes, bullets and €.
const WIN_ANSI_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'

/**
 * Makes text safe for the built-in fonts. A single character they can't draw (models often
 * write non-breaking hyphens, as in "de‑escalate", or narrow spaces) makes jsPDF encode the
 * whole line differently: every letter gets spaced apart and the line runs off the page.
 */
function pdfSafe(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‐-‒−]/g, '-') // hyphens and minus signs
    .replace(/―/g, '—')
    .replace(/[  -   　]/g, ' ') // unusual spaces
    .replace(/[​-‍⁠﻿­]/g, '') // invisible characters
    .replace(/[‛′]/g, "'")
    .replace(/[‟″]/g, '"')
    .replace(/…/g, '…')
    .replace(/[‣⁃▪●◦]/g, '•')
    .replace(/[←-⇿]/g, (arrow) => (arrow === '←' ? '<-' : '->'))
    .replace(/[^\n\t -~¡-ÿ]/gu, (char) => (WIN_ANSI_EXTRAS.includes(char) ? char : '?'))
}

// Page layout, in points. Black and white so it prints cleanly: white page, black text
// (secondary text is black too, just smaller), grey only for hairlines and table headers.
const MARGIN = 56
const PAPER = [255, 255, 255] as const
const TEXT = [0, 0, 0] as const
const MUTED = [0, 0, 0] as const
const HAIRLINE = [150, 150, 150] as const
const TABLE_HEAD = [230, 230, 230] as const
const CARD = [255, 255, 255] as const

type Rgb = readonly [number, number, number]
type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic'
type Piece = { text: string; style: FontStyle; width: number }
/** Pieces with no space between them, such as "**bold**," (a bold word, then a comma). */
type Word = { pieces: Piece[]; width: number }
type Line = Word[]

const fontStyle = (bold: boolean, italic: boolean): FontStyle =>
  bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal'

/** The Boardwise owl's head in greys, drawn with shapes so it stays sharp. `size` is its height. */
function drawOwl(doc: jsPDF, left: number, top: number, size: number) {
  // The shapes come from the app's owl (components/brand/Owl.tsx), whose head fills the box 14 2 92 84.
  const scale = size / 84
  const x = (value: number) => left + (value - 14) * scale
  const y = (value: number) => top + (value - 2) * scale
  const fill = (rgb: Rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2])

  fill([110, 110, 110]) // feathers
  doc.triangle(x(22), y(30), x(27), y(6), x(44), y(22), 'F')
  doc.triangle(x(98), y(30), x(93), y(6), x(76), y(22), 'F')
  doc.ellipse(x(60), y(48), 42 * scale, 34 * scale, 'F')
  // Brows: quadratic curves, drawn as the equivalent cubic ones.
  doc.setDrawColor(40, 40, 40)
  doc.setLineWidth(3 * scale)
  doc.setLineCap('round')
  for (const [x0, y0, cx, cy, x1, y1] of [
    [30, 30, 44, 22, 58, 32],
    [90, 30, 76, 22, 62, 32],
  ]) {
    const c1 = [x0 + ((cx - x0) * 2) / 3, y0 + ((cy - y0) * 2) / 3]
    const c2 = [x1 + ((cx - x1) * 2) / 3, y1 + ((cy - y1) * 2) / 3]
    doc.lines(
      [[(c1[0] - x0) * scale, (c1[1] - y0) * scale, (c2[0] - x0) * scale, (c2[1] - y0) * scale, (x1 - x0) * scale, (y1 - y0) * scale]],
      x(x0),
      y(y0),
      [1, 1],
      'S',
      false,
    )
  }
  doc.setLineCap('butt')
  fill([240, 240, 240]) // face discs
  doc.circle(x(43), y(50), 17 * scale, 'F')
  doc.circle(x(77), y(50), 17 * scale, 'F')
  fill([0, 0, 0]) // eyes
  doc.circle(x(43), y(50), 8.5 * scale, 'F')
  doc.circle(x(77), y(50), 8.5 * scale, 'F')
  fill([255, 255, 255])
  doc.circle(x(46), y(47), 2.6 * scale, 'F')
  doc.circle(x(80), y(47), 2.6 * scale, 'F')
  fill([170, 170, 170]) // beak
  doc.triangle(x(54.5), y(60), x(65.5), y(60), x(60), y(71), 'F')
}

export async function downloadTranscript(input: TranscriptInput, filename: string) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const width = pageWidth - MARGIN * 2
  const bottom = pageHeight - MARGIN
  let y = MARGIN

  function paintPage() {
    doc.setFillColor(PAPER[0], PAPER[1], PAPER[2])
    doc.rect(0, 0, pageWidth, pageHeight, 'F')
  }

  function newPage() {
    doc.addPage()
    paintPage()
    y = MARGIN
  }

  // --- Text layout --------------------------------------------------------------------------
  // jsPDF wraps plain strings only, so styled text is measured and wrapped here, word by word.
  // The built-in Helvetica covers English and French. Scripts outside Latin-1 would need an embedded font.

  function measure(text: string, style: FontStyle, size: number) {
    doc.setFont('helvetica', style)
    doc.setFontSize(size)
    return doc.getTextWidth(text)
  }

  /** Splits runs into words and hard line breaks. A word too long for the line is cut into pieces that fit. */
  function toWords(runs: Run[], size: number, base: { bold?: boolean; italic?: boolean }, maxWidth: number) {
    const tokens: (Word | 'break')[] = []
    let word: Word | null = null
    const endWord = () => {
      if (word) tokens.push(word)
      word = null
    }
    for (const run of runs) {
      const style = fontStyle(Boolean(base.bold || run.bold), Boolean(base.italic || run.italic))
      for (const part of pdfSafe(run.text).split(/(\n|[ \t]+)/)) {
        if (part === '\n') {
          endWord()
          tokens.push('break')
        } else if (/^[ \t]+$/.test(part)) {
          endWord()
        } else if (part) {
          const pieceWidth = measure(part, style, size)
          word ??= { pieces: [], width: 0 }
          word.pieces.push({ text: part, style, width: pieceWidth })
          word.width += pieceWidth
        }
      }
    }
    endWord()

    // Cut words wider than the line, such as long web addresses, into pieces that fit.
    return tokens.flatMap((token): (Word | 'break')[] => {
      if (token === 'break' || token.width <= maxWidth) return [token]
      const parts: Word[] = []
      let current: Word = { pieces: [], width: 0 }
      for (const piece of token.pieces) {
        for (const char of piece.text) {
          const charWidth = measure(char, piece.style, size)
          if (current.width + charWidth > maxWidth && current.width > 0) {
            parts.push(current)
            current = { pieces: [], width: 0 }
          }
          const last = current.pieces[current.pieces.length - 1]
          if (last?.style === piece.style) {
            last.text += char
            last.width += charWidth
          } else {
            current.pieces.push({ text: char, style: piece.style, width: charWidth })
          }
          current.width += charWidth
        }
      }
      if (current.width > 0) parts.push(current)
      return parts
    })
  }

  function layout(runs: Run[], maxWidth: number, size: number, base: { bold?: boolean; italic?: boolean } = {}): Line[] {
    const space = measure(' ', 'normal', size)
    const lines: Line[] = []
    let line: Line = []
    let lineWidth = 0
    for (const token of toWords(runs, size, base, maxWidth)) {
      if (token === 'break') {
        lines.push(line)
        line = []
        lineWidth = 0
      } else if (line.length > 0 && lineWidth + space + token.width > maxWidth) {
        lines.push(line)
        line = [token]
        lineWidth = token.width
      } else {
        lineWidth += (line.length > 0 ? space : 0) + token.width
        line.push(token)
      }
    }
    if (line.length > 0 || lines.length === 0) lines.push(line)
    return lines
  }

  function drawLine(line: Line, left: number, baseline: number, size: number) {
    const space = measure(' ', 'normal', size)
    let x = left
    line.forEach((word, index) => {
      if (index > 0) x += space
      for (const piece of word.pieces) {
        doc.setFont('helvetica', piece.style)
        doc.text(piece.text, x, baseline)
        x += piece.width
      }
    })
  }

  type WriteOptions = {
    size?: number
    bold?: boolean
    italic?: boolean
    color?: Rgb
    after?: number
    /** Left indent in points. */
    indent?: number
    /** Drawn in the indent before the first line only, such as a bullet or number. */
    marker?: string
    /** A checkbox in the indent before the first line, ticked when done. */
    box?: 'open' | 'done'
  }

  function drawCheckbox(left: number, top: number, side: number, done: boolean, color: Rgb) {
    doc.setDrawColor(color[0], color[1], color[2])
    doc.setLineWidth(0.9)
    doc.rect(left, top, side, side, 'S')
    if (done) {
      doc.setLineWidth(1.3)
      doc.setLineCap('round')
      doc.line(left + side * 0.2, top + side * 0.55, left + side * 0.42, top + side * 0.78)
      doc.line(left + side * 0.42, top + side * 0.78, left + side * 0.82, top + side * 0.22)
      doc.setLineCap('butt')
    }
  }

  function writeRuns(
    runs: Run[],
    { size = 11, bold = false, italic = false, color = TEXT, after = 4, indent = 0, marker, box }: WriteOptions = {},
  ) {
    const lineHeight = size * 1.4
    layout(runs, width - indent, size, { bold, italic }).forEach((line, index) => {
      if (y + lineHeight > bottom) newPage()
      doc.setFontSize(size)
      doc.setTextColor(color[0], color[1], color[2])
      if (marker && index === 0) {
        doc.setFont('helvetica', 'normal')
        doc.text(pdfSafe(marker), MARGIN + indent - 14, y + size)
      }
      if (box && index === 0) {
        // Sized to the capitals and sitting on the baseline, like a character would.
        const side = size * 0.78
        drawCheckbox(MARGIN + indent - side - 7, y + size - side + 0.5, side, box === 'done', color)
      }
      drawLine(line, MARGIN + indent, y + size, size)
      y += lineHeight
    })
    y += after
  }

  const write = (text: string, options?: WriteOptions) => writeRuns([{ text }], options)

  /** Code keeps its spacing, in a fixed-width font. */
  function writeCode(text: string) {
    doc.setFont('courier', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(TEXT[0], TEXT[1], TEXT[2])
    const lineHeight = 9.5 * 1.4
    for (const line of doc.splitTextToSize(pdfSafe(text), width - 12) as string[]) {
      if (y + lineHeight > bottom) newPage()
      doc.setFont('courier', 'normal')
      doc.text(line, MARGIN + 12, y + 9.5)
      y += lineHeight
    }
    y += 6
  }

  function rule() {
    doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2])
    doc.setLineWidth(0.75)
    doc.line(MARGIN, y, MARGIN + width, y)
    y += 14
  }

  // --- Tables -------------------------------------------------------------------------------

  const CELL_SIZE = 9.5
  const CELL_LINE = CELL_SIZE * 1.35
  const CELL_PAD = 6

  /** A table as a grid, or, when its columns can't fit side by side, as label/value lines per row. */
  function writeTable(header: Run[][], rows: Run[][][]) {
    const columns = header.length
    // Each column's width on one line, and the width of its longest word (it can't be narrower).
    const natural = header.map(() => 0)
    const minimum = header.map(() => 0)
    for (const [rowIndex, row] of [header, ...rows].entries()) {
      row.forEach((cell, column) => {
        for (const line of layout(cell, Infinity, CELL_SIZE, { bold: rowIndex === 0 })) {
          const words = line.map((word) => word.width)
          const lineWidth = words.reduce((sum, w) => sum + w, 0) + Math.max(words.length - 1, 0) * measure(' ', 'normal', CELL_SIZE)
          natural[column] = Math.max(natural[column], lineWidth + CELL_PAD * 2)
          minimum[column] = Math.max(minimum[column], ...words.map((w) => w + CELL_PAD * 2))
        }
      })
    }
    const minimumTotal = minimum.reduce((sum, w) => sum + w, 0)
    if (columns > 4 || minimumTotal > width || width / columns < 72) {
      writeTableAsLines(header, rows)
      return
    }

    // Share the width out: fill the line when everything fits, otherwise give each column its
    // minimum plus a share of what's left, in proportion to how much more it would like.
    const naturalTotal = natural.reduce((sum, w) => sum + w, 0)
    const widths =
      naturalTotal <= width
        ? natural.map((w) => (w / naturalTotal) * width)
        : minimum.map((w, column) => w + ((width - minimumTotal) * (natural[column] - w)) / (naturalTotal - minimumTotal))

    const rowLines = (row: Run[][], bold: boolean) =>
      row.map((cell, column) => layout(cell, widths[column] - CELL_PAD * 2, CELL_SIZE, { bold }))
    const rowHeight = (lines: Line[][]) => Math.max(...lines.map((cell) => cell.length)) * CELL_LINE + CELL_PAD * 2

    function drawRow(lines: Line[][], fillColor: Rgb) {
      const height = rowHeight(lines)
      let x = MARGIN
      doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2])
      doc.setLineWidth(0.5)
      doc.setFontSize(CELL_SIZE)
      lines.forEach((cell, column) => {
        // Set for every cell: drawing text changes the PDF's fill colour to the text colour.
        doc.setFillColor(fillColor[0], fillColor[1], fillColor[2])
        doc.rect(x, y, widths[column], height, 'FD')
        doc.setTextColor(TEXT[0], TEXT[1], TEXT[2])
        cell.forEach((line, index) => drawLine(line, x + CELL_PAD, y + CELL_PAD + index * CELL_LINE + CELL_SIZE, CELL_SIZE))
        x += widths[column]
      })
      y += height
    }

    const headerLines = rowLines(header, true)
    const firstRow = rows.length > 0 ? rowHeight(rowLines(rows[0], false)) : 0
    // Don't leave the header alone at the bottom of a page.
    if (y + rowHeight(headerLines) + firstRow > bottom && y > MARGIN) newPage()
    drawRow(headerLines, TABLE_HEAD)
    for (const row of rows) {
      const lines = rowLines(row, false)
      if (y + rowHeight(lines) > bottom && y > MARGIN) {
        // Carry on over the page, repeating the header.
        newPage()
        drawRow(headerLines, TABLE_HEAD)
      }
      drawRow(lines, CARD)
    }
    y += 10
  }

  /** Each row as a short group of "Header: value" lines, for tables too wide for the page. */
  function writeTableAsLines(header: Run[][], rows: Run[][][]) {
    for (const row of rows) {
      let first = true
      row.forEach((cell, column) => {
        if (!runsText(cell).trim()) return
        const label = runsText(header[column]).trim()
        const runs = label ? [{ text: `${label}: `, bold: true }, ...cell] : cell
        writeRuns(runs, { indent: 18, marker: first ? '•' : undefined, after: 1 })
        first = false
      })
      y += 6
    }
    y += 4
  }

  /** The assistant's reply, with its Markdown laid out. */
  function writeMarkdown(markdown: string) {
    for (const block of markdownToBlocks(markdown)) {
      switch (block.kind) {
        case 'heading':
          y += 2
          writeRuns(block.runs, { size: 12, bold: true, after: 4 })
          break
        case 'paragraph':
          writeRuns(block.runs, { after: 6 })
          break
        case 'item':
          writeRuns(block.runs, { indent: 18 + block.level * 16, marker: block.marker, after: 3 })
          break
        case 'quote':
          writeRuns(block.runs, { italic: true, color: MUTED, indent: 16, after: 6 })
          break
        case 'code':
          writeCode(block.text)
          break
        case 'table':
          y += 2
          writeTable(block.header, block.rows)
          break
        case 'rule':
          rule()
          break
      }
    }
  }

  // --- The document ---------------------------------------------------------------------------

  paintPage()
  // Letterhead: the owl and the name, like the app's header.
  const owlSize = 40
  const nameSize = 26
  drawOwl(doc, MARGIN, y, owlSize)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(nameSize)
  doc.setTextColor(TEXT[0], TEXT[1], TEXT[2])
  // Baseline placed so the capitals sit centred on the owl (Helvetica caps are ~0.72 em tall).
  doc.text('Boardwise', MARGIN + owlSize * (92 / 84) + 10, y + owlSize / 2 + nameSize * 0.36)
  y += owlSize + 18

  const { labels } = input
  write(labels.heading, { size: 18, bold: true, after: 8 })
  writeRuns([{ text: `${labels.issue}: `, bold: true }, { text: input.caseTitle }], { after: 2 })
  write(`${labels.started}: ${input.formatDateTime(input.startedAt)}`, { size: 10, color: MUTED, after: 2 })
  write(`${labels.exported}: ${input.formatDateTime(new Date().toISOString())}`, { size: 10, color: MUTED, after: 10 })
  write(labels.notice, { size: 10, color: MUTED, after: 12 })
  rule()

  // The issue's checklist comes first, so whoever reads this sees what's planned before the
  // whole conversation. Steps still to do come before finished ones.
  write(labels.nextSteps, { size: 13, bold: true, after: 6 })
  if (input.nextSteps.length === 0) {
    write(labels.noNextSteps, { italic: true, color: MUTED, after: 8 })
  } else {
    const steps = [...input.nextSteps.filter((step) => !step.done), ...input.nextSteps.filter((step) => step.done)]
    for (const step of steps) {
      const notes = step.notes.trim()
      writeRuns([{ text: step.title }, ...(step.due ? [{ text: ` · ${labels.due(step.due)}` }] : [])], {
        indent: 18,
        box: step.done ? 'done' : 'open',
        color: step.done ? MUTED : TEXT,
        after: notes ? 1 : 5,
      })
      if (notes) write(notes, { size: 9.5, color: MUTED, indent: 18, after: 5 })
    }
    y += 3
  }
  rule()

  for (const message of input.messages) {
    const speaker = message.role === 'user' ? labels.you : labels.assistant
    write(`${speaker} · ${input.formatDateTime(message.created_at)}`, { size: 10, bold: true, color: MUTED, after: 2 })
    if (message.role === 'user') {
      // The person's own words, exactly as they typed them.
      write(message.content, { after: 4 })
    } else {
      writeMarkdown(message.content)
    }
    y += message.citations.length > 0 ? 0 : 8
    if (message.citations.length > 0) {
      write(`${labels.sources}:`, { size: 9, bold: true, color: MUTED, after: 1 })
      for (const citation of message.citations) {
        write(`${citation.title} (${citation.url})`, { size: 9, color: MUTED, after: 1 })
      }
      y += 10
    }
  }

  const total = doc.getNumberOfPages()
  for (let page = 1; page <= total; page++) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2])
    doc.text('Boardwise', MARGIN, pageHeight - 28)
    doc.text(pdfSafe(labels.page(page, total)), MARGIN + width, pageHeight - 28, { align: 'right' })
  }

  doc.save(filename)
}
