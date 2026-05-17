import { z } from 'zod';
import { google } from 'googleapis';

const TIMEOUT_MS = 30_000;
const MAX_ROWS = 25_000;
const PAGE_SIZE = 5_000;

function getSiteUrl() {
  const url = process.env.GSC_SITE_URL;
  if (!url) throw new Error(
    'GSC_SITE_URL is not set. Add GSC_SITE_URL=sc-domain:example.com to your environment.'
  );
  return url;
}

// GSC requires real dates — no relative strings like GA4 accepts
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function defaultDates() {
  return { start: daysAgo(28), end: daysAgo(3) };
}

function formatRows(rows, dimensions) {
  return (rows ?? []).map(row => {
    const obj = {};
    dimensions.forEach((dim, i) => { obj[dim] = row.keys[i]; });
    obj.clicks      = row.clicks;
    obj.impressions = row.impressions;
    obj.ctr         = parseFloat((row.ctr * 100).toFixed(1));
    obj.position    = parseFloat(row.position.toFixed(1));
    return obj;
  });
}

async function runWithTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('GSC API request timed out after 30 seconds')),
      TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function toResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function toError(err) {
  const msg = err?.response?.data?.error?.message ?? err.message ?? 'Unknown error';
  const status = err?.response?.status ?? err?.status ?? null;
  return {
    content: [{ type: 'text', text: status ? `GSC error ${status}: ${msg}` : `GSC error: ${msg}` }],
    isError: true,
  };
}

export function registerGscTools(server, client) {
  const webmasters = google.webmasters({ version: 'v3', auth: client });

  // ── 1. gsc_search_analytics ────────────────────────────────────────────────
  server.tool(
    'gsc_search_analytics',
    'Run a fully custom Search Console query with any combination of dimensions, ' +
    'date range, row limit, and optional dimension filters. Use when the specific ' +
    'GSC tools do not cover your exact breakdown.',
    {
      dimensions: z.array(z.string()).describe('Dimensions to group by, e.g. ["query","page","device","country","date"]'),
      startDate: z.string().optional().describe('Start date YYYY-MM-DD (default: 28 days ago)'),
      endDate: z.string().optional().describe('End date YYYY-MM-DD (default: 3 days ago — GSC has a 3-day delay)'),
      rowLimit: z.number().optional().describe('Max rows to return (default: 20, max: 25000)'),
      dimensionFilterGroups: z.array(z.any()).optional().describe('GSC filter groups, e.g. [{"filters":[{"dimension":"query","operator":"contains","expression":"keyword"}]}]'),
    },
    async ({ dimensions, startDate, endDate, rowLimit, dimensionFilterGroups }) => {
      try {
        const dates = defaultDates();
        const body = {
          startDate: startDate ?? dates.start,
          endDate:   endDate   ?? dates.end,
          dimensions,
          rowLimit:  rowLimit  ?? 20,
        };
        if (dimensionFilterGroups?.length) body.dimensionFilterGroups = dimensionFilterGroups;

        const res = await runWithTimeout(
          webmasters.searchanalytics.query({
            siteUrl: getSiteUrl(),
            requestBody: body,
          })
        );
        const rows = formatRows(res.data.rows, dimensions);
        return toResult({ rows, rowCount: rows.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 2. gsc_all_rows ────────────────────────────────────────────────────────
  server.tool(
    'gsc_all_rows',
    'Fetch the complete GSC dataset for a date range and dimension set, automatically ' +
    'paginating through all results. Capped at 25,000 rows. Use when you need the full ' +
    'dataset rather than a top-N slice.',
    {
      dimensions: z.array(z.string()).describe('Dimensions to group by, e.g. ["query","page"]'),
      startDate: z.string().optional().describe('Start date YYYY-MM-DD (default: 28 days ago)'),
      endDate: z.string().optional().describe('End date YYYY-MM-DD (default: 3 days ago)'),
    },
    async ({ dimensions, startDate, endDate }) => {
      try {
        const siteUrl = getSiteUrl();
        const dates   = defaultDates();
        const sd      = startDate ?? dates.start;
        const ed      = endDate   ?? dates.end;
        const allRows = [];
        let startRow  = 0;

        while (allRows.length < MAX_ROWS) {
          const remaining = MAX_ROWS - allRows.length;
          const rowLimit  = Math.min(PAGE_SIZE, remaining);

          const res = await runWithTimeout(
            webmasters.searchanalytics.query({
              siteUrl,
              requestBody: { startDate: sd, endDate: ed, dimensions, rowLimit, startRow },
            })
          );

          const page = res.data.rows ?? [];
          allRows.push(...formatRows(page, dimensions));

          if (page.length < rowLimit) break;
          startRow += page.length;
        }

        return toResult({ rows: allRows, rowCount: allRows.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 3. gsc_top_queries ─────────────────────────────────────────────────────
  server.tool(
    'gsc_top_queries',
    'Show the top search queries driving clicks to your site, with impressions, ' +
    'CTR, and average position. Use to understand which keywords are performing best.',
    {
      startDate: z.string().optional().describe('Start date YYYY-MM-DD (default: 28 days ago)'),
      endDate: z.string().optional().describe('End date YYYY-MM-DD (default: 3 days ago)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const dates = defaultDates();
        const res = await runWithTimeout(
          webmasters.searchanalytics.query({
            siteUrl: getSiteUrl(),
            requestBody: {
              startDate:  startDate ?? dates.start,
              endDate:    endDate   ?? dates.end,
              dimensions: ['query'],
              rowLimit:   limit ?? 20,
            },
          })
        );
        const rows = formatRows(res.data.rows, ['query']);
        return toResult({ rows, rowCount: rows.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 4. gsc_top_pages ───────────────────────────────────────────────────────
  server.tool(
    'gsc_top_pages',
    'Show the top pages on your site by organic search clicks, with impressions, ' +
    'CTR, and average position. Use to identify your best-performing content in search.',
    {
      startDate: z.string().optional().describe('Start date YYYY-MM-DD (default: 28 days ago)'),
      endDate: z.string().optional().describe('End date YYYY-MM-DD (default: 3 days ago)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const dates = defaultDates();
        const res = await runWithTimeout(
          webmasters.searchanalytics.query({
            siteUrl: getSiteUrl(),
            requestBody: {
              startDate:  startDate ?? dates.start,
              endDate:    endDate   ?? dates.end,
              dimensions: ['page'],
              rowLimit:   limit ?? 20,
            },
          })
        );
        const rows = formatRows(res.data.rows, ['page']);
        return toResult({ rows, rowCount: rows.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 5. gsc_by_country ─────────────────────────────────────────────────────
  server.tool(
    'gsc_by_country',
    'Break down search performance by country — clicks, impressions, CTR, and ' +
    'average position per country. Use to understand geographic search distribution.',
    {
      startDate: z.string().optional().describe('Start date YYYY-MM-DD (default: 28 days ago)'),
      endDate: z.string().optional().describe('End date YYYY-MM-DD (default: 3 days ago)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const dates = defaultDates();
        const res = await runWithTimeout(
          webmasters.searchanalytics.query({
            siteUrl: getSiteUrl(),
            requestBody: {
              startDate:  startDate ?? dates.start,
              endDate:    endDate   ?? dates.end,
              dimensions: ['country'],
              rowLimit:   limit ?? 20,
            },
          })
        );
        const rows = formatRows(res.data.rows, ['country']);
        return toResult({ rows, rowCount: rows.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 6. gsc_by_device ──────────────────────────────────────────────────────
  server.tool(
    'gsc_by_device',
    'Show search performance split by device type: mobile, desktop, and tablet. ' +
    'Use to compare organic search behaviour across devices.',
    {
      startDate: z.string().optional().describe('Start date YYYY-MM-DD (default: 28 days ago)'),
      endDate: z.string().optional().describe('End date YYYY-MM-DD (default: 3 days ago)'),
    },
    async ({ startDate, endDate }) => {
      try {
        const dates = defaultDates();
        const res = await runWithTimeout(
          webmasters.searchanalytics.query({
            siteUrl: getSiteUrl(),
            requestBody: {
              startDate:  startDate ?? dates.start,
              endDate:    endDate   ?? dates.end,
              dimensions: ['device'],
              rowLimit:   10,
            },
          })
        );
        const rows = formatRows(res.data.rows, ['device']);
        return toResult({ rows });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 7. gsc_daily_performance ──────────────────────────────────────────────
  server.tool(
    'gsc_daily_performance',
    'Show day-by-day search performance trend: clicks, impressions, CTR, and position ' +
    'for each date in the range. Use to spot traffic drops, spikes, or seasonal patterns.',
    {
      startDate: z.string().optional().describe('Start date YYYY-MM-DD (default: 28 days ago)'),
      endDate: z.string().optional().describe('End date YYYY-MM-DD (default: 3 days ago)'),
    },
    async ({ startDate, endDate }) => {
      try {
        const dates = defaultDates();
        const res = await runWithTimeout(
          webmasters.searchanalytics.query({
            siteUrl: getSiteUrl(),
            requestBody: {
              startDate:  startDate ?? dates.start,
              endDate:    endDate   ?? dates.end,
              dimensions: ['date'],
              rowLimit:   500,
            },
          })
        );
        const rows = formatRows(res.data.rows, ['date']);
        return toResult({ rows, rowCount: rows.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 8. gsc_query_page_combos ──────────────────────────────────────────────
  server.tool(
    'gsc_query_page_combos',
    'Show which queries are driving traffic to which specific pages. ' +
    'Use to understand keyword-to-page mapping and find optimisation opportunities.',
    {
      startDate: z.string().optional().describe('Start date YYYY-MM-DD (default: 28 days ago)'),
      endDate: z.string().optional().describe('End date YYYY-MM-DD (default: 3 days ago)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const dates = defaultDates();
        const res = await runWithTimeout(
          webmasters.searchanalytics.query({
            siteUrl: getSiteUrl(),
            requestBody: {
              startDate:  startDate ?? dates.start,
              endDate:    endDate   ?? dates.end,
              dimensions: ['query', 'page'],
              rowLimit:   limit ?? 20,
            },
          })
        );
        const rows = formatRows(res.data.rows, ['query', 'page']);
        return toResult({ rows, rowCount: rows.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 9. gsc_sitemaps ───────────────────────────────────────────────────────
  server.tool(
    'gsc_sitemaps',
    'List all sitemaps submitted to Search Console for this property, including ' +
    'submission date, last crawl, warning and error counts, and indexed page counts. ' +
    'Use to audit sitemap health.',
    {},
    async () => {
      try {
        const res = await runWithTimeout(
          webmasters.sitemaps.list({ siteUrl: getSiteUrl() })
        );
        const sitemaps = (res.data.sitemap ?? []).map(s => ({
          path:            s.path,
          lastSubmitted:   s.lastSubmitted,
          lastDownloaded:  s.lastDownloaded,
          isPending:       s.isPending,
          isSitemapsIndex: s.isSitemapsIndex,
          warnings:        Number(s.warnings ?? 0),
          errors:          Number(s.errors   ?? 0),
          contents:        (s.contents ?? []).map(c => ({
            type:      c.type,
            submitted: Number(c.submitted ?? 0),
            indexed:   Number(c.indexed   ?? 0),
          })),
        }));
        return toResult({ sitemaps, count: sitemaps.length });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
