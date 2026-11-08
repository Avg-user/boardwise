// Builds a chat transcript PDF in the browser. Nothing is sent to a server.
// jsPDF is loaded only when someone exports, so it doesn't slow down the app.
import type { ChatMessage } from '../api/types.ts'
import { markdownToBlocks } from './markdownText.ts'

export type TranscriptLabels = {
  heading: string
  issue: string
  started: string
  exported: string
  notice: string
  you: string
  assistant: string
  sources: string
  page: (page: number, total: number) => string
}

export type TranscriptInput = {
  caseTitle: string
  startedAt: string
  messages: ChatMessage[]
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

const MARGIN = 56
const TEXT = [26, 27, 30] as const
const MUTED = [89, 86, 78] as const

export async function downloadTranscript(input: TranscriptInput, filename: string) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const width = doc.internal.pageSize.getWidth() - MARGIN * 2
  const bottom = doc.internal.pageSize.getHeight() - MARGIN
  let y = MARGIN

  type WriteOptions = {
    size?: number
    bold?: boolean
    italic?: boolean
    mono?: boolean
    color?: readonly [number, number, number]
    after?: number
    /** Left indent in points. */
    indent?: number
    /** Drawn in the indent before the first line only, such as a bullet or number. */
    marker?: string
  }

  // The built-in Helvetica covers English and French. Scripts outside Latin-1 would need an embedded font.
  function write(
    text: string,
    { size = 11, bold = false, italic = false, mono = false, color = TEXT, after = 4, indent = 0, marker }: WriteOptions = {},
  ) {
    const style = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal'
    doc.setFont(mono ? 'courier' : 'helvetica', style)
    doc.setFontSize(size)
    doc.setTextColor(color[0], color[1], color[2])
    const lineHeight = size * 1.4
    const lines = doc.splitTextToSize(pdfSafe(text), width - indent) as string[]
    lines.forEach((line, index) => {
      if (y + lineHeight > bottom) {
        doc.addPage()
        y = MARGIN
      }
      if (marker && index === 0) doc.text(marker, MARGIN + indent - 14, y + size)
      doc.text(line, MARGIN + indent, y + size)
      y += lineHeight
    })
    y += after
  }

  /** The assistant's reply, with Markdown turned into plain, structured text. */
  function writeMarkdown(markdown: string) {
    for (const block of markdownToBlocks(markdown)) {
      switch (block.kind) {
        case 'heading':
          y += 2
          write(block.text, { bold: true, after: 4 })
          break
        case 'paragraph':
          write(block.text, { after: 6 })
          break
        case 'item':
          write(block.text, { indent: 18 + block.level * 16, marker: block.marker, after: 3 })
          break
        case 'quote':
          write(block.text, { italic: true, color: MUTED, indent: 16, after: 6 })
          break
        case 'code':
          write(block.text, { mono: true, size: 9.5, indent: 12, after: 6 })
          break
        case 'rule':
          rule()
          break
      }
    }
  }

  function rule() {
    doc.setDrawColor(211, 206, 192)
    doc.line(MARGIN, y, MARGIN + width, y)
    y += 14
  }

  const { labels } = input
  write(labels.heading, { size: 18, bold: true, after: 8 })
  write(`${labels.issue}: ${input.caseTitle}`, { size: 11, bold: true, after: 2 })
  write(`${labels.started}: ${input.formatDateTime(input.startedAt)}`, { size: 10, color: MUTED, after: 2 })
  write(`${labels.exported}: ${input.formatDateTime(new Date().toISOString())}`, { size: 10, color: MUTED, after: 10 })
  write(labels.notice, { size: 10, color: MUTED, after: 12 })
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
    doc.text(pdfSafe(labels.page(page, total)), MARGIN + width, doc.internal.pageSize.getHeight() - 28, { align: 'right' })
  }

  doc.save(filename)
}
