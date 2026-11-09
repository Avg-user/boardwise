// Highlights the sentence being read aloud, using the CSS Custom Highlight API: the rendered
// Markdown isn't changed, a Range over its text is just painted (`::highlight(reading)` in
// index.css). Browsers without the API simply read without a highlight.

import { findSentence } from './readAloudText.ts'

const NAME = 'reading'

const supported = () =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'

/** The element holding a reply's rendered text (ChatPanel marks it with data-reading-id). */
function rootFor(messageId: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-reading-id="${messageId}"]`)
}

let lastEnd = 0
let lastId: number | null = null

/** Paints `sentence` inside that reply, and scrolls it into view if it's off screen. */
export function highlightSentence(messageId: number, sentence: string) {
  if (!supported()) return
  const root = rootFor(messageId)
  if (!root) return clearHighlight()
  if (lastId !== messageId) lastEnd = 0
  lastId = messageId

  const nodes: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  const text = nodes.map((node) => node.data).join('')
  const found = findSentence(text, sentence, lastEnd)
  if (!found) return clearHighlight()
  lastEnd = found[1]

  const range = document.createRange()
  let offset = 0
  for (const node of nodes) {
    const next = offset + node.data.length
    if (found[0] >= offset && found[0] < next) range.setStart(node, found[0] - offset)
    if (found[1] > offset && found[1] <= next) {
      range.setEnd(node, found[1] - offset)
      break
    }
    offset = next
  }
  CSS.highlights.set(NAME, new Highlight(range))

  const box = range.getBoundingClientRect()
  if (box.top < 0 || box.bottom > window.innerHeight) {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' })
  }
}

export function clearHighlight() {
  lastEnd = 0
  lastId = null
  if (supported()) CSS.highlights.delete(NAME)
}
