// /api/library
//
// Serverless function (Vercel) that fetches the "Smart Tender Content Library"
// Notion database server-side and reshapes it into the four arrays the frontend
// (public/index.html) expects:
//
//   { contentBlocks: [...], linkBlocks: [...], warrantyData: [...], testimonials: [...] }
//
// Why this exists as a backend function rather than calling Notion directly from
// the browser: the Notion integration token is a secret. It must never be sent to
// or embedded in client-side code. This function holds that secret as a server
// environment variable (NOTION_TOKEN) and only ever returns the already-public,
// already-reshaped tender content to the browser.

const NOTION_VERSION = '2025-09-03';
const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID || '379063cc-a383-8042-8559-000bb1987a05';

// Cache the reshaped library in memory between invocations on the same warm
// serverless instance, to avoid re-querying Notion on every single page load.
// This is a soft cache only — cold starts will always refetch, and that's fine.
let CACHE = null;
let CACHE_AT = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'Server is not configured: NOTION_TOKEN is missing.' });
    return;
  }

  try {
    if (CACHE && Date.now() - CACHE_AT < CACHE_TTL_MS) {
      res.status(200).json(CACHE);
      return;
    }

    const rows = await fetchAllRows(token);
    const library = reshapeLibrary(rows);

    CACHE = library;
    CACHE_AT = Date.now();

    res.status(200).json(library);
  } catch (err) {
    console.error('library API error:', err);
    res.status(502).json({ error: 'Could not reach the content library. Please try again shortly.' });
  }
};

// ── Notion fetching ──────────────────────────────────────────────────────────

async function fetchAllRows(token) {
  const rows = [];
  let cursor = undefined;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const resp = await fetch(`https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Notion API error ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    rows.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return rows;
}

// ── Reshaping Notion pages into the library contract ─────────────────────────

function reshapeLibrary(rows) {
  const contentBlocks = [];
  const linkBlocks = [];
  const warrantyData = [];
  const testimonials = [];

  for (const row of rows) {
    const props = row.properties || {};
    const blockName = getTitle(props['Block Name']);
    if (!blockName) continue;

    const status = getSelect(props['Status']);
    // Don't ship retired or under-review content into live tenders.
    if (status === 'Retired' || status === 'Under Review') continue;

    const blockType = getSelect(props['Block Type']);
    const content = getRichText(props['Content']);

    if (blockName.toLowerCase().startsWith('warranty data')) {
      const parsed = parseWarrantyContent(content);
      if (parsed) warrantyData.push(parsed);
      // Warranty rows are also valid generic content blocks (some callers look
      // them up via findContentBlock), so fall through and let them get added
      // below as well.
    }

    if (blockName.toLowerCase().startsWith('testimonial')) {
      testimonials.push({ blockName, content: normalizeParagraphs(content) });
    }

    if (blockType === 'Link' || blockType === 'Linked Graphic') {
      linkBlocks.push({ blockName, content: content.trim() });
    } else {
      contentBlocks.push({ blockName, content: normalizeParagraphs(content) });
    }
  }

  return { contentBlocks, linkBlocks, warrantyData, testimonials };
}

// Notion stores multi-paragraph text with literal "<br>" tags. The frontend
// expects paragraphs separated by "\n\n" and line-breaks within a paragraph by "\n".
function normalizeParagraphs(text) {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim();
}

// Parses the convention used in "Warranty Data — X" blocks:
//   Supplier: Sungrow<br>Equipment: SG5RT<br>Product Warranty: 10 years<br>Performance Warranty: —<br>Notes: ...
function parseWarrantyContent(content) {
  if (!content) return null;
  const plain = content.replace(/<br\s*\/?>/gi, '\n');
  const fields = {};
  for (const line of plain.split('\n')) {
    const m = line.match(/^\s*([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === 'supplier') fields.supplier = value;
    else if (key === 'equipment') fields.equipment = value;
    else if (key === 'product warranty') fields.productWarranty = value;
    else if (key === 'performance warranty') fields.performanceWarranty = value;
  }
  if (!fields.supplier) return null;
  return fields;
}

// ── Notion property readers ───────────────────────────────────────────────────

function getTitle(prop) {
  if (!prop || prop.type !== 'title' || !Array.isArray(prop.title)) return '';
  return prop.title.map(t => t.plain_text).join('').trim();
}

function getRichText(prop) {
  if (!prop || prop.type !== 'rich_text' || !Array.isArray(prop.rich_text)) return '';
  return prop.rich_text.map(t => t.plain_text).join('');
}

function getSelect(prop) {
  if (!prop || prop.type !== 'select' || !prop.select) return '';
  return prop.select.name || '';
}
