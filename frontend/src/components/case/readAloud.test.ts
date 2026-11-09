// Run with `npm test` (Node's own test runner; Node 23+ runs TypeScript directly).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { findSentence, pcmToFloat, voiceScore } from './readAloudText.ts'

describe('finding the sentence being read', () => {
  const text = 'Short answer: yes.Call OHS at 1-866-415-8690 right away. You have **180 days** to file.'

  test('finds a sentence and returns offsets into the original text', () => {
    const [start, end] = findSentence(text, 'Call OHS at 1-866-415-8690 right away.')!
    assert.equal(text.slice(start, end), 'Call OHS at 1-866-415-8690 right away.')
  })

  test('ignores Markdown marks, case and spacing', () => {
    const [start, end] = findSentence(text, 'you have 180   days to file.')!
    assert.equal(text.slice(start, end), 'You have **180 days** to file.')
  })

  test('ignores a spoken list number that is not in the rendered text', () => {
    const list = 'Write down the date.Keep copies.'
    const [start, end] = findSentence(list, '2. Keep copies.')!
    assert.equal(list.slice(start, end), 'Keep copies.')
  })

  test('searches forward from the last sentence, so repeats land on the right one', () => {
    const repeated = 'Call now. Then wait. Call now.'
    assert.deepEqual(findSentence(repeated, 'Call now.', 9), [21, 30])
    assert.deepEqual(findSentence(repeated, 'Call now.', 0), [0, 9])
  })

  test('returns null when it is not there', () => {
    assert.equal(findSentence(text, 'Header: value.'), null)
    assert.equal(findSentence(text, '   '), null)
  })
})

describe('voices', () => {
  test('natural voices beat the old robotic desktop ones', () => {
    const desktop = { name: 'Microsoft David Desktop', lang: 'en-US', default: true }
    const natural = { name: 'Microsoft Andrew Online (Natural)', lang: 'en-US', default: false }
    assert.ok(voiceScore(natural, 'en') > voiceScore(desktop, 'en'))
  })

  test('PCM becomes -1..1 floats', () => {
    assert.deepEqual([...pcmToFloat(new Int16Array([0, 16384, -32768]))], [0, 0.5, -1])
  })
})
