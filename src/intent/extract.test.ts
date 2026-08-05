import { describe, it, expect } from 'vitest';
import { parseSchema, extractFromModel } from './extract.js';
import { makeNode, makeModel } from '../test-utils.js';

// ─── parseSchema ───────────────────────────────────────────────

describe('parseSchema', () => {
  it('parses simple field names', () => {
    const fields = parseSchema('title, price, description');
    expect(fields).toHaveLength(3);
    expect(fields[0]).toMatchObject({ key: 'title', hint: 'title', isRef: false });
    expect(fields[1]).toMatchObject({ key: 'price', hint: 'price', isRef: false });
  });

  it('parses hinted fields with colon', () => {
    const fields = parseSchema('heading: h1, price: textbox');
    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({ key: 'heading', hint: 'h1', isRef: false });
    expect(fields[1]).toMatchObject({ key: 'price', hint: 'textbox', isRef: false });
  });

  it('detects ref hints', () => {
    const fields = parseSchema('button: e15');
    expect(fields[0]).toMatchObject({ key: 'button', hint: 'e15', isRef: true });
  });

  it('handles extra whitespace', () => {
    const fields = parseSchema('  title ,  price  ');
    expect(fields).toHaveLength(2);
    expect(fields[0].key).toBe('title');
  });

  it('returns empty array for empty schema', () => {
    expect(parseSchema('')).toHaveLength(0);
    expect(parseSchema('   ')).toHaveLength(0);
  });
});

// ─── extractFromModel ─────────────────────────────────────────

describe('extractFromModel — key-value extraction', () => {
  it('extracts fields by name match', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'heading', name: 'Product Title', text: 'Product Title' }),
      makeNode({ ref: 'e2', role: 'textbox', name: 'Price', text: '$29.99' }),
      makeNode({ ref: 'e3', role: 'paragraph', text: 'A great product description.' }),
    ]);
    const fields = parseSchema('title, price, description');
    const result = extractFromModel(model, fields);
    expect(result.success).toBe(true);
    expect(result.fieldsFound).toBe(3);
  });

  it('extracts by direct ref', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit' }),
      makeNode({ ref: 'e2', role: 'heading', text: 'Hello World' }),
    ]);
    const fields = parseSchema('button: e2');
    const result = extractFromModel(model, fields);
    expect(result.success).toBe(true);
    const data = result.data as Record<string, string>;
    expect(data['button']).toContain('Hello World');
  });

  it('extracts by role hint', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'paragraph', text: 'Some text' }),
      makeNode({ ref: 'e2', role: 'heading', text: 'Main Heading' }),
      makeNode({ ref: 'e3', role: 'textbox', name: 'email', text: '' }),
    ]);
    const fields = parseSchema('heading: heading, field: textbox');
    const result = extractFromModel(model, fields);
    expect(result.success).toBe(true);
    const data = result.data as Record<string, string>;
    expect(data['heading']).toContain('Main Heading');
    expect(data['field']).toContain('email');
  });

  it('reports fields not found', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'heading', text: 'Title' }),
    ]);
    const fields = parseSchema('title, nonexistent');
    const result = extractFromModel(model, fields);
    expect(result.fieldsTotal).toBe(2);
  });
});

// ─── extractFromModel — table extraction ──────────────────────

describe('extractFromModel — table extraction', () => {
  it('extracts table rows with headers', () => {
    const model = makeModel([
      makeNode({
        ref: 'e1', role: 'table', children: [
          makeNode({
            ref: 'e2', role: 'row', children: [
              makeNode({ ref: 'e3', role: 'columnheader', text: 'Name' }),
              makeNode({ ref: 'e4', role: 'columnheader', text: 'Age' }),
            ],
          }),
          makeNode({
            ref: 'e5', role: 'row', children: [
              makeNode({ ref: 'e6', role: 'cell', text: 'Alice' }),
              makeNode({ ref: 'e7', role: 'cell', text: '30' }),
            ],
          }),
          makeNode({
            ref: 'e8', role: 'row', children: [
              makeNode({ ref: 'e9', role: 'cell', text: 'Bob' }),
              makeNode({ ref: 'e10', role: 'cell', text: '25' }),
            ],
          }),
        ],
      }),
    ]);
    const fields = parseSchema('table');
    const result = extractFromModel(model, fields);
    expect(result.success).toBe(true);
    const data = result.data as Record<string, string>[];
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ Name: 'Alice', Age: '30' });
    expect(data[1]).toMatchObject({ Name: 'Bob', Age: '25' });
  });

  it('reports no tables found', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'paragraph', text: 'No table here' }),
    ]);
    const fields = parseSchema('table');
    const result = extractFromModel(model, fields);
    expect(result.success).toBe(false);
    expect(result.message).toContain('no tables');
  });
});

// ─── extractFromModel — list extraction ───────────────────────

describe('extractFromModel — list extraction', () => {
  it('extracts list items', () => {
    const model = makeModel([
      makeNode({
        ref: 'e1', role: 'list', children: [
          makeNode({ ref: 'e2', role: 'listitem', text: 'Apple' }),
          makeNode({ ref: 'e3', role: 'listitem', text: 'Banana' }),
          makeNode({ ref: 'e4', role: 'listitem', text: 'Cherry' }),
        ],
      }),
    ]);
    const fields = parseSchema('list');
    const result = extractFromModel(model, fields);
    expect(result.success).toBe(true);
    const data = result.data as string[];
    expect(data).toHaveLength(3);
    expect(data[0]).toBe('Apple');
  });

  it('reports no lists found', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'paragraph', text: 'No list here' }),
    ]);
    const fields = parseSchema('list');
    const result = extractFromModel(model, fields);
    expect(result.success).toBe(false);
  });
});
