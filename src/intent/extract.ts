/**
 * Structured Data Extraction — schema → JSON.
 *
 * docs/PRODUCTION.md §3 item 5: "Schema → JSON structured extraction. Natural
 * complement to goto; completes the command surface from docs/DESIGN.md §4.5."
 *
 * Given a schema description (field names + optional hints), walk the page
 * model and extract matching data into JSON. Supports:
 *
 *   1. Key-value extraction: "title, price, description"
 *      Each field name is matched against node names/text in the model.
 *
 *   2. Hinted extraction: "heading: h1, price: textbox, name: label"
 *      The hint (after ":") narrows by role or text content.
 *
 *   3. Ref extraction: "button: e15"
 *      The hint is a direct ref — extracts that element's text.
 *
 *   4. Table/list auto-extraction: "table" or "list"
 *      Detects <table> or <ul>/<ol> structures and extracts all rows/items.
 *
 * The extraction is deterministic (no LLM call) — it uses the page model's
 * name/text/role fields. This is the DOM/AX approach from docs/PRODUCTION.md §5
 * ("Extract strategy: Pure DOM/AX extraction, deterministic, cheap").
 */

import type { Page } from 'playwright';
import type { PageModel, EnhancedNode } from '../model/page-model.js';
import { buildPageModel } from '../model/page-model.js';

// ─── Types ─────────────────────────────────────────────────────

export interface SchemaField {
  key: string;       // output JSON key
  hint: string;      // text/role/ref to match (defaults to key)
  isRef: boolean;    // hint is a direct ref (e.g. "e15")
}

export interface ExtractResult {
  success: boolean;
  data: Record<string, unknown> | unknown[];
  message: string;
  fieldsFound: number;
  fieldsTotal: number;
}

// ─── Schema parsing ─────────────────────────────────────────────

/**
 * Parse a schema string into field definitions.
 *
 * Formats:
 *   "title, price, description"              → 3 fields, hint = key
 *   "heading: h1, price: textbox"            → hint is role/text
 *   "button: e15"                             → hint is a ref
 *   "table"                                   → auto table extraction
 *   "list"                                    → auto list extraction
 */
export function parseSchema(schema: string): SchemaField[] {
  const fields: SchemaField[] = [];
  const parts = schema.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx > 0) {
      const key = part.slice(0, colonIdx).trim();
      const hint = part.slice(colonIdx + 1).trim();
      const isRef = /^e\d+$/i.test(hint);
      fields.push({ key, hint, isRef });
    } else {
      // No colon — key and hint are the same
      const key = part;
      const isRef = /^e\d+$/i.test(key);
      fields.push({ key, hint: key, isRef });
    }
  }

  return fields;
}

// ─── Extraction from page model ───────────────────────────────

/** Get all text from a node (name + text + children text). */
function nodeFullText(node: EnhancedNode): string {
  const parts: string[] = [];
  if (node.name) parts.push(node.name);
  if (node.text) parts.push(node.text);
  for (const child of node.children) {
    const childText = nodeFullText(child);
    if (childText) parts.push(childText);
  }
  return parts.join(' ').trim();
}

/** Flatten the model tree into a list of all nodes. */
function flattenNodes(node: EnhancedNode, result: EnhancedNode[] = []): EnhancedNode[] {
  result.push(node);
  for (const child of node.children) {
    flattenNodes(child, result);
  }
  return result;
}

/**
 * Extract structured data from a page model using the given schema fields.
 * Pure function — no browser needed, fully testable with mock models.
 */
export function extractFromModel(model: PageModel, fields: SchemaField[]): ExtractResult {
  // Auto-detect table/list extraction
  if (fields.length === 1) {
    const hint = fields[0].hint.toLowerCase();
    if (hint === 'table' || hint === 'list') {
      return extractTableOrList(model, hint);
    }
  }

  const allNodes = flattenNodes(model.tree);
  const data: Record<string, string> = {};

  for (const field of fields) {
    // 1. Direct ref extraction
    if (field.isRef) {
      const node = model.refIndex.get(field.hint);
      if (node) {
        data[field.key] = nodeFullText(node).slice(0, 500) || node.name || '';
      } else {
        data[field.key] = '';
      }
      continue;
    }

    // 2. Match by hint (text or role)
    const hintLower = field.hint.toLowerCase();

    // Check if hint is a role name
    const isRoleHint = ['heading', 'button', 'link', 'textbox', 'combobox',
      'paragraph', 'listitem', 'cell', 'row', 'img', 'checkbox', 'radio',
      'searchbox', 'menuitem', 'tab', 'option', 'label'].includes(hintLower);

    let bestNode: EnhancedNode | null = null;
    let bestScore = 0;

    for (const node of allNodes) {
      let score = 0;
      const nodeText = nodeFullText(node).toLowerCase();
      const nodeName = (node.name || '').toLowerCase();

      // Role match
      if (isRoleHint && node.role === hintLower) {
        score += 0.5;
      }

      // Name/text contains the hint (or vice versa)
      if (nodeText.includes(hintLower) && hintLower.length >= 2) {
        score += 0.4;
      } else if (nodeName.includes(hintLower) && hintLower.length >= 2) {
        score += 0.3;
      } else if (hintLower.includes(nodeName) && nodeName.length >= 3) {
        score += 0.2;
      }

      // Prefer leaf nodes (those with direct text)
      if (node.text) score += 0.1;

      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    // Extract the value from the best match
    if (bestNode && bestScore > 0) {
      const value = nodeFullText(bestNode).slice(0, 500);
      data[field.key] = value;
    } else {
      data[field.key] = '';
    }
  }

  const fieldsFound = Object.values(data).filter((v) => v.length > 0).length;
  return {
    success: true,
    data,
    message: `extracted ${fieldsFound}/${fields.length} fields`,
    fieldsFound,
    fieldsTotal: fields.length,
  };
}

/** Auto-extract table or list data into a JSON array. */
function extractTableOrList(model: PageModel, type: string): ExtractResult {
  const allNodes = flattenNodes(model.tree);

  if (type === 'table') {
    // Find table nodes and extract rows
    const tables = allNodes.filter((n) => n.role === 'table');
    if (tables.length === 0) {
      return {
        success: false,
        data: [],
        message: 'no tables found on the page',
        fieldsFound: 0,
        fieldsTotal: 1,
      };
    }

    const records: Record<string, string>[] = [];
    for (const table of tables) {
      const rows = table.children.filter((n) => n.role === 'row');
      // Use first row as headers
      let headers: string[] = [];
      if (rows.length > 0) {
        const firstRow = rows[0];
        headers = firstRow.children
          .filter((n) => n.role === 'columnheader' || n.role === 'cell')
          .map((n) => nodeFullText(n).slice(0, 100) || '');
      }

      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].children
          .filter((n) => n.role === 'cell' || n.role === 'columnheader');
        const record: Record<string, string> = {};
        for (let j = 0; j < cells.length; j++) {
          const key = headers[j] || `col${j + 1}`;
          record[key] = nodeFullText(cells[j]).slice(0, 500);
        }
        records.push(record);
      }
    }

    return {
      success: true,
      data: records,
      message: `extracted ${records.length} rows from ${tables.length} table(s)`,
      fieldsFound: records.length,
      fieldsTotal: 1,
    };
  }

  // List extraction
  const lists = allNodes.filter((n) => n.role === 'list');
  if (lists.length === 0) {
    return {
      success: false,
      data: [],
      message: 'no lists found on the page',
      fieldsFound: 0,
      fieldsTotal: 1,
    };
  }

  const items: string[] = [];
  for (const list of lists) {
    const listItems = list.children.filter((n) => n.role === 'listitem');
    for (const item of listItems) {
      const text = nodeFullText(item).slice(0, 500);
      if (text) items.push(text);
    }
  }

  return {
    success: true,
    data: items,
    message: `extracted ${items.length} items from ${lists.length} list(s)`,
    fieldsFound: items.length,
    fieldsTotal: 1,
  };
}

// ─── Page-level wrapper ─────────────────────────────────────────

/**
 * Extract structured data from the current page.
 * Builds the page model, parses the schema, and extracts matching data.
 */
export async function extractData(page: Page, schema: string): Promise<ExtractResult> {
  const fields = parseSchema(schema);
  if (fields.length === 0) {
    return {
      success: false,
      data: {},
      message: 'empty schema — provide field names, e.g. "title, price, description"',
      fieldsFound: 0,
      fieldsTotal: 0,
    };
  }

  const model = await buildPageModel(page);
  return extractFromModel(model, fields);
}
