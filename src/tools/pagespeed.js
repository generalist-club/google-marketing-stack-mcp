import { z } from 'zod';

const PSI_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const TIMEOUT_MS = 60_000;
const BULK_DELAY_MS = 2_000;

function buildUrl(pageUrl, strategy) {
  const params = new URLSearchParams({ url: pageUrl, strategy });
  const key = process.env.PSI_API_KEY;
  if (key) params.set('key', key);
  return `${PSI_BASE}?${params}`;
}

async function fetchPsi(pageUrl, strategy) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(buildUrl(pageUrl, strategy), { signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? `PSI API returned HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('PSI request timed out after 60 seconds');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function scores(data) {
  const cats = data.lighthouseResult?.categories ?? {};
  return {
    performance:   Math.round((cats['performance']?.score    ?? 0) * 100),
    accessibility: Math.round((cats['accessibility']?.score  ?? 0) * 100),
    bestPractices: Math.round((cats['best-practices']?.score ?? 0) * 100),
    seo:           Math.round((cats['seo']?.score            ?? 0) * 100),
  };
}

function labCwv(data) {
  const a = data.lighthouseResult?.audits ?? {};
  return {
    lcp:        a['largest-contentful-paint']?.displayValue ?? 'n/a',
    tbt:        a['total-blocking-time']?.displayValue      ?? 'n/a',
    cls:        a['cumulative-layout-shift']?.displayValue  ?? 'n/a',
    fcp:        a['first-contentful-paint']?.displayValue   ?? 'n/a',
    speedIndex: a['speed-index']?.displayValue              ?? 'n/a',
    tti:        a['interactive']?.displayValue              ?? 'n/a',
  };
}

function fieldCwv(data) {
  const m = data.loadingExperience?.metrics;
  if (!m) return null;
  const ms  = (key) => m[key] ? { p75ms: m[key].percentile, category: m[key].category } : null;
  const cls = m['CUMULATIVE_LAYOUT_SHIFT_SCORE'];
  return {
    lcp:             ms('LARGEST_CONTENTFUL_PAINT_MS'),
    fcp:             ms('FIRST_CONTENTFUL_PAINT_MS'),
    fid:             ms('FIRST_INPUT_DELAY_MS'),
    inp:             ms('INTERACTION_TO_NEXT_PAINT'),
    cls:             cls ? { p75: (cls.percentile / 100).toFixed(2), category: cls.category } : null,
    overallCategory: data.loadingExperience?.overall_category ?? null,
  };
}

function summary(data, pageUrl, strategy) {
  return {
    url:       pageUrl,
    strategy,
    fetchTime: data.lighthouseResult?.fetchTime ?? null,
    scores:    scores(data),
    labData:   labCwv(data),
    fieldData: fieldCwv(data),
  };
}

function toResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function toError(err) {
  return {
    content: [{ type: 'text', text: `PSI error: ${err.message}` }],
    isError: true,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function registerPagespeedTools(server) {

  // ── 1. psi_analyze ────────────────────────────────────────────────────────
  server.tool(
    'psi_analyze',
    'Run a full PageSpeed Insights analysis on a URL. Returns Lighthouse category ' +
    'scores (performance, accessibility, best practices, SEO), lab Core Web Vitals ' +
    '(LCP, TBT, CLS, FCP, Speed Index, TTI), and real-world field data from CrUX ' +
    'if available. Defaults to mobile strategy.',
    {
      url:      z.string().describe('URL to analyse, e.g. "https://example.com/page"'),
      strategy: z.enum(['mobile', 'desktop']).optional().describe('Device strategy (default: mobile)'),
    },
    async ({ url, strategy = 'mobile' }) => {
      try {
        const data = await fetchPsi(url, strategy);
        return toResult(summary(data, url, strategy));
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 2. psi_core_web_vitals ────────────────────────────────────────────────
  server.tool(
    'psi_core_web_vitals',
    'Return Core Web Vitals for a URL — both lab measurements (from Lighthouse) and ' +
    'real-world field data (from CrUX, p75). Includes pass/fail category for each metric. ' +
    'Use to diagnose CWV issues or check if a page passes the CWV thresholds.',
    {
      url:      z.string().describe('URL to analyse'),
      strategy: z.enum(['mobile', 'desktop']).optional().describe('Device strategy (default: mobile)'),
    },
    async ({ url, strategy = 'mobile' }) => {
      try {
        const data = await fetchPsi(url, strategy);
        return toResult({
          url,
          strategy,
          performanceScore: Math.round((data.lighthouseResult?.categories?.performance?.score ?? 0) * 100),
          lab:   labCwv(data),
          field: fieldCwv(data),
        });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 3. psi_lighthouse ─────────────────────────────────────────────────────
  server.tool(
    'psi_lighthouse',
    'Return the four Lighthouse category scores for a URL: performance, accessibility, ' +
    'best practices, and SEO. Scores are 0–100. Use for a quick quality check or ' +
    'to compare pages without needing the full Core Web Vitals breakdown.',
    {
      url:      z.string().describe('URL to analyse'),
      strategy: z.enum(['mobile', 'desktop']).optional().describe('Device strategy (default: mobile)'),
    },
    async ({ url, strategy = 'mobile' }) => {
      try {
        const data = await fetchPsi(url, strategy);
        return toResult({ url, strategy, scores: scores(data) });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 4. psi_compare ────────────────────────────────────────────────────────
  server.tool(
    'psi_compare',
    'Analyse the same URL on both mobile and desktop simultaneously and return ' +
    'scores and Core Web Vitals side by side. Use to understand the performance gap ' +
    'between mobile and desktop experiences.',
    {
      url: z.string().describe('URL to analyse on both strategies'),
    },
    async ({ url }) => {
      try {
        const [mobileData, desktopData] = await Promise.all([
          fetchPsi(url, 'mobile'),
          fetchPsi(url, 'desktop'),
        ]);
        return toResult({
          url,
          mobile:  { scores: scores(mobileData),  labData: labCwv(mobileData),  fieldData: fieldCwv(mobileData) },
          desktop: { scores: scores(desktopData), labData: labCwv(desktopData), fieldData: fieldCwv(desktopData) },
        });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 5. psi_bulk ───────────────────────────────────────────────────────────
  server.tool(
    'psi_bulk',
    'Analyse multiple URLs sequentially and return scores and Core Web Vitals for each. ' +
    'Requests are spaced 2 seconds apart to avoid rate limiting. ' +
    'Set PSI_API_KEY in your environment for higher rate limits — without a key, ' +
    'bulk analysis of more than a few URLs may be throttled.',
    {
      urls:     z.array(z.string()).describe('List of URLs to analyse'),
      strategy: z.enum(['mobile', 'desktop']).optional().describe('Device strategy (default: mobile)'),
    },
    async ({ urls, strategy = 'mobile' }) => {
      const warnings = [];
      if (!process.env.PSI_API_KEY) {
        warnings.push('PSI_API_KEY is not set. Bulk requests without an API key are rate-limited. Set PSI_API_KEY for reliable bulk analysis.');
      }

      const results = [];
      for (const url of urls) {
        try {
          const data = await fetchPsi(url, strategy);
          results.push({ url, status: 'ok', ...summary(data, url, strategy) });
        } catch (err) {
          results.push({ url, status: 'error', error: err.message });
        }
        if (url !== urls[urls.length - 1]) await sleep(BULK_DELAY_MS);
      }

      return toResult({ strategy, warnings, results, count: results.length });
    }
  );
}
