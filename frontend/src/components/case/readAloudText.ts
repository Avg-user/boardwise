// Read-aloud helpers with no browser APIs, so they can be unit-tested (readAloud.test.ts).

/** Higher is better: natural-sounding voices first, then Canadian, then the default; old robotic ones last. */
export function voiceScore(voice: { name: string; lang: string; default: boolean }, base: string): number {
  let score = 0
  if (/natural|neural|enhanced|premium|siri/i.test(voice.name)) score += 4
  if (voice.lang.toLowerCase().replace('_', '-') === `${base}-ca`) score += 2
  if (voice.default) score += 1
  if (/desktop|espeak/i.test(voice.name)) score -= 2
  return score
}

/** 16-bit PCM to the -1..1 floats Web Audio plays. */
export function pcmToFloat(pcm: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

/** Lower case, Markdown marks dropped, whitespace collapsed: how text and sentences are compared. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[*_`]/g, '').replace(/\s+/g, ' ')
}

/**
 * Where `sentence` appears in `text`, as [start, end) offsets into `text`, searching from
 * `from`. Spacing, case and Markdown marks are ignored. A spoken list number ("1. ") that
 * isn't in the rendered text is ignored too. Null when it can't be found.
 */
export function findSentence(text: string, sentence: string, from = 0): [number, number] | null {
  // Map every kept character of the normalised text back to its offset in `text`.
  const kept: number[] = []
  let flat = ''
  for (let i = 0; i < text.length; i++) {
    const char = normalise(text[i])
    if (!char) continue
    if (char === ' ' && (flat.endsWith(' ') || flat === '')) continue
    flat += char
    kept.push(i)
  }
  const needle = normalise(sentence).trim().replace(/^\d+[.)] /, '')
  if (!needle) return null
  const startAt = kept.findIndex((offset) => offset >= from)
  let at = flat.indexOf(needle, Math.max(startAt, 0))
  if (at < 0) at = flat.indexOf(needle) // e.g. resumed earlier in the reply
  if (at < 0) return null
  return [kept[at], kept[at + needle.length - 1] + 1]
}
