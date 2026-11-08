// Builds a chat transcript PDF in the browser. Nothing is sent to a server.
// jsPDF is loaded only when someone exports, so it doesn't slow down the app.
import type { ChatMessage } from '../api/types.ts'

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

const MARGIN = 56
const TEXT = [26, 27, 30] as const
const MUTED = [89, 86, 78] as const

export async function downloadTranscript(input: TranscriptInput, filename: string) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const width = doc.internal.pageSize.getWidth() - MARGIN * 2
  const bottom = doc.internal.pageSize.getHeight() - MARGIN
  let y = MARGIN

  // The built-in Helvetica covers English and French. Scripts outside Latin-1 would need an embedded font.
  function write(
    text: string,
    { size = 11, bold = false, color = TEXT, after = 4 }: { size?: number; bold?: boolean; color?: readonly [number, number, number]; after?: number } = {},
  ) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(color[0], color[1], color[2])
    const lineHeight = size * 1.4
    for (const line of doc.splitTextToSize(text, width) as string[]) {
      if (y + lineHeight > bottom) {
        doc.addPage()
        y = MARGIN
      }
      doc.text(line, MARGIN, y + size)
      y += lineHeight
    }
    y += after
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
    write(message.content, { after: message.citations.length > 0 ? 4 : 12 })
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
    doc.text(labels.page(page, total), MARGIN + width, doc.internal.pageSize.getHeight() - 28, { align: 'right' })
  }

  doc.save(filename)
}
