// Run with `npm test` (Node's own test runner; Node 23+ runs TypeScript directly).
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { markdownToBlocks, parseInline, plainInline, runsText, type Run, type TextBlock } from './markdownText.ts'

const cells = (row: Run[][]) => row.map(runsText)
const only = <K extends TextBlock['kind']>(blocks: TextBlock[], kind: K) =>
  blocks.filter((block): block is Extract<TextBlock, { kind: K }> => block.kind === kind)

describe('inline text', () => {
  test('keeps bold and italic as styled runs', () => {
    assert.deepEqual(parseInline('You have **three** options, *not* one.'), [
      { text: 'You have ' },
      { text: 'three', bold: true },
      { text: ' options, ' },
      { text: 'not', italic: true },
      { text: ' one.' },
    ])
  })

  test('bold with underscores, and italic inside bold', () => {
    assert.deepEqual(parseInline('__Call__ now'), [{ text: 'Call', bold: true }, { text: ' now' }])
    assert.deepEqual(parseInline('**see *this* first**'), [
      { text: 'see ', bold: true },
      { text: 'this', bold: true, italic: true },
      { text: ' first', bold: true },
    ])
  })

  test('leaves snake_case, arithmetic and escaped asterisks alone', () => {
    assert.equal(plainInline('see the_file_name and 2*3*4'), 'see the_file_name and 2*3*4')
    assert.deepEqual(parseInline('5 \\* 3 \\*not italic\\*'), [{ text: '5 * 3 *not italic*' }])
  })

  test('code and web addresses are never read as emphasis', () => {
    assert.deepEqual(parseInline('Run `a_b_c *d*` here'), [{ text: 'Run a_b_c *d* here' }])
    assert.equal(plainInline('See https://example.ca/some_page_name ok'), 'See https://example.ca/some_page_name ok')
  })

  test('links become "text (address)"', () => {
    assert.equal(plainInline('Call [Alberta OHS](https://www.alberta.ca/ohs) now'), 'Call Alberta OHS (https://www.alberta.ca/ohs) now')
    assert.equal(plainInline('[https://a.ca](https://a.ca)'), 'https://a.ca')
    assert.deepEqual(parseInline('**[OHS](https://a.ca/x_y_z)**'), [{ text: 'OHS (https://a.ca/x_y_z)', bold: true }])
  })

  test('strikethrough and HTML markers are removed', () => {
    assert.equal(plainInline('~~old~~ <b>new</b>'), 'old new')
  })
})

describe('tables', () => {
  const expected = {
    header: ['Reference', 'What it requires'],
    rows: [
      ['OHS Code s.244(3)', 'Respiratory protection'],
      ['s.397(1)', 'Training on hazardous products'],
    ],
  }

  test('with leading and trailing pipes', () => {
    const [table] = only(
      markdownToBlocks(`| Reference | What it requires |
|---|:---:|
| **OHS Code s.244(3)** | Respiratory protection |
| s.397(1) | Training on hazardous products |`),
      'table',
    )
    assert.deepEqual(cells(table.header), expected.header)
    assert.deepEqual(table.rows.map(cells), expected.rows)
    assert.deepEqual(table.rows[0][0], [{ text: 'OHS Code s.244(3)', bold: true }])
  })

  test('without leading pipes', () => {
    const blocks = markdownToBlocks(`Here is a summary:

Reference | What it requires
--- | ---
OHS Code s.244(3) | Respiratory protection
s.397(1) | Training on hazardous products

That's all.`)
    assert.deepEqual(blocks.map((block) => block.kind), ['paragraph', 'table', 'paragraph'])
    const [table] = only(blocks, 'table')
    assert.deepEqual(cells(table.header), expected.header)
    assert.deepEqual(table.rows.map(cells), expected.rows)
  })

  test('short rows are padded, extra cells dropped, escaped pipes kept', () => {
    const [table] = only(markdownToBlocks('| A | B |\n| - | - |\n| 1 |\n| 2 | 3 | 4 |\n| x \\| y | z |'), 'table')
    assert.deepEqual(table.rows.map(cells), [
      ['1', ''],
      ['2', '3'],
      ['x | y', 'z'],
    ])
  })

  test('a paragraph over a rule, or mismatched columns, is not a table', () => {
    assert.deepEqual(markdownToBlocks('Some text\n---').map((block) => block.kind), ['paragraph', 'rule'])
    assert.equal(only(markdownToBlocks('a | b | c\n--- | ---\n1 | 2 | 3'), 'table').length, 0)
  })
})

describe('lists and other blocks', () => {
  test('numbered, nested, task and wrapped list items', () => {
    const items = only(
      markdownToBlocks(`1. Write down **what happened**
2. Report it
   - include dates
3) Call OHS
  and keep the number

- [ ] Save emails
- [x] Tell a friend`),
      'item',
    )
    assert.deepEqual(
      items.map(({ marker, level, text }) => [marker, level, text]),
      [
        ['1.', 0, 'Write down what happened'],
        ['2.', 0, 'Report it'],
        ['•', 1, 'include dates'],
        ['3.', 0, 'Call OHS and keep the number'],
        ['[ ]', 0, 'Save emails'],
        ['[x]', 0, 'Tell a friend'],
      ],
    )
    assert.deepEqual(items[0].runs, [{ text: 'Write down ' }, { text: 'what happened', bold: true }])
  })

  test('headings, quotes, code and rules', () => {
    const blocks = markdownToBlocks('## Next *steps*\n\n> Keep copies\n\n```\nkeep   spacing\n```\n\n***')
    assert.deepEqual(
      blocks.map((block) => [block.kind, 'text' in block ? block.text : '']),
      [
        ['heading', 'Next steps'],
        ['quote', 'Keep copies'],
        ['code', 'keep   spacing'],
        ['rule', ''],
      ],
    )
  })

  test('wrapped paragraph lines join into one', () => {
    assert.deepEqual(markdownToBlocks('one\ntwo\n\nthree'), [
      { kind: 'paragraph', text: 'one two', runs: [{ text: 'one two' }] },
      { kind: 'paragraph', text: 'three', runs: [{ text: 'three' }] },
    ])
  })
})
