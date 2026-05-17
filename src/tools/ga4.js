import { z } from 'zod';
import { google } from 'googleapis';

const TIMEOUT_MS = 30_000;
const DEFAULT_START = '28daysAgo';
const DEFAULT_END = 'today';

function getPropertyId() {
  const raw = process.env.GA4_PROPERTY_ID;
  if (!raw) throw new Error(
    'GA4_PROPERTY_ID is not set. Add GA4_PROPERTY_ID=123456789 to your environment.'
  );
  return raw.replace(/^properties\//, '');
}

function formatReport(response) {
  const dimHeaders = (response.dimensionHeaders ?? []).map(h => h.name);
  const metHeaders = (response.metricHeaders ?? []).map(h => h.name);
  return (response.rows ?? []).map(row => {
    const obj = {};
    (row.dimensionValues ?? []).forEach((v, i) => { obj[dimHeaders[i]] = v.value; });
    (row.metricValues ?? []).forEach((v, i) => { obj[metHeaders[i]] = v.value; });
    return obj;
  });
}

async function runWithTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('GA4 API request timed out after 30 seconds')),
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
    content: [{ type: 'text', text: status ? `GA4 error ${status}: ${msg}` : `GA4 error: ${msg}` }],
    isError: true,
  };
}

export function registerGa4Tools(server, client) {
  const analytics = google.analyticsdata({ version: 'v1beta', auth: client });
  // Audiences are only available in the Admin API v1alpha (not v1beta)
  const adminAlpha = google.analyticsadmin({ version: 'v1alpha', auth: client });

  // ── 1. ga4_run_report ──────────────────────────────────────────────────────
  server.tool(
    'ga4_run_report',
    'Run a fully custom GA4 report with any dimensions and metrics you choose. ' +
    'Use this when none of the specific report tools cover your exact needs. ' +
    'Dimensions and metrics must use GA4 API field names (e.g. "pagePath", "sessions").',
    {
      dimensions: z.array(z.string()).describe('GA4 dimension names, e.g. ["pagePath","sessionSource"]'),
      metrics: z.array(z.string()).describe('GA4 metric names, e.g. ["sessions","totalUsers"]'),
      startDate: z.string().optional().describe('Start date — "2024-01-01" or "28daysAgo" (default)'),
      endDate: z.string().optional().describe('End date — "2024-01-31" or "today" (default)'),
      limit: z.number().optional().describe('Max rows to return (default: 20)'),
    },
    async ({ dimensions, metrics, startDate, endDate, limit }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: dimensions.map(name => ({ name })),
              metrics: metrics.map(name => ({ name })),
              limit: limit ?? 20,
            },
          })
        );
        return toResult({ rows: formatReport(res.data), rowCount: res.data.rowCount ?? null });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 2. ga4_realtime ────────────────────────────────────────────────────────
  server.tool(
    'ga4_realtime',
    'Get live GA4 data for the last 30 minutes — active users, current pages, ' +
    'and real-time event counts. Use for dashboards and live monitoring.',
    {
      metrics: z.array(z.string()).describe('Metric names, e.g. ["activeUsers","screenPageViews"]'),
      dimensions: z.array(z.string()).optional().describe('Optional dimensions, e.g. ["pagePath","country"]'),
    },
    async ({ metrics, dimensions }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runRealtimeReport({
            property: `properties/${propertyId}`,
            requestBody: {
              metrics: metrics.map(name => ({ name })),
              ...(dimensions?.length ? { dimensions: dimensions.map(name => ({ name })) } : {}),
            },
          })
        );
        return toResult({ rows: formatReport(res.data), rowCount: res.data.rowCount ?? null });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 3. ga4_traffic_overview ────────────────────────────────────────────────
  server.tool(
    'ga4_traffic_overview',
    'Get a high-level traffic summary: sessions, users, new users, pageviews, ' +
    'bounce rate, and average session duration. Use as a first step when ' +
    'assessing overall site performance for a date range.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
    },
    async ({ startDate, endDate }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              metrics: [
                { name: 'sessions' },
                { name: 'totalUsers' },
                { name: 'newUsers' },
                { name: 'screenPageViews' },
                { name: 'bounceRate' },
                { name: 'averageSessionDuration' },
              ],
            },
          })
        );
        return toResult({ rows: formatReport(res.data) });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 4. ga4_traffic_sources ─────────────────────────────────────────────────
  server.tool(
    'ga4_traffic_sources',
    'Break down traffic by source and medium (e.g. google/organic, direct/none). ' +
    'Use to understand where your sessions are coming from.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
              metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'bounceRate' }],
              limit: limit ?? 20,
              orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            },
          })
        );
        return toResult({ rows: formatReport(res.data), rowCount: res.data.rowCount ?? null });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 5. ga4_channel_breakdown ───────────────────────────────────────────────
  server.tool(
    'ga4_channel_breakdown',
    'Show traffic split by GA4 default channel groupings: Organic Search, Direct, ' +
    'Paid Search, Email, Referral, Social, and others.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
    },
    async ({ startDate, endDate }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
              metrics: [
                { name: 'sessions' },
                { name: 'totalUsers' },
                { name: 'screenPageViews' },
                { name: 'bounceRate' },
              ],
              orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            },
          })
        );
        return toResult({ rows: formatReport(res.data) });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 6. ga4_campaign_performance ────────────────────────────────────────────
  server.tool(
    'ga4_campaign_performance',
    'Show performance by UTM campaign, source, and medium. ' +
    'Use to evaluate paid and organic campaign effectiveness.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: [
                { name: 'sessionCampaignName' },
                { name: 'sessionSource' },
                { name: 'sessionMedium' },
              ],
              metrics: [
                { name: 'sessions' },
                { name: 'totalUsers' },
                { name: 'conversions' },
                { name: 'bounceRate' },
              ],
              limit: limit ?? 20,
              orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            },
          })
        );
        return toResult({ rows: formatReport(res.data), rowCount: res.data.rowCount ?? null });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 7. ga4_page_performance ────────────────────────────────────────────────
  server.tool(
    'ga4_page_performance',
    'Show pageviews, users, and engagement metrics per page path. ' +
    'Use to find your most visited content and identify underperforming pages.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
              metrics: [
                { name: 'screenPageViews' },
                { name: 'totalUsers' },
                { name: 'averageSessionDuration' },
                { name: 'bounceRate' },
              ],
              limit: limit ?? 20,
              orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
            },
          })
        );
        return toResult({ rows: formatReport(res.data), rowCount: res.data.rowCount ?? null });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 8. ga4_landing_pages ───────────────────────────────────────────────────
  server.tool(
    'ga4_landing_pages',
    'Show performance for landing pages — the first page seen per session. ' +
    'Includes sessions, users, bounce rate, and conversions per landing URL.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: [{ name: 'landingPage' }],
              metrics: [
                { name: 'sessions' },
                { name: 'totalUsers' },
                { name: 'bounceRate' },
                { name: 'conversions' },
              ],
              limit: limit ?? 20,
              orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            },
          })
        );
        return toResult({ rows: formatReport(res.data), rowCount: res.data.rowCount ?? null });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 9. ga4_geo_breakdown ───────────────────────────────────────────────────
  server.tool(
    'ga4_geo_breakdown',
    'Break down traffic by country and city. ' +
    'Use to understand the geographic distribution of your audience.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: [{ name: 'country' }, { name: 'city' }],
              metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
              limit: limit ?? 20,
              orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            },
          })
        );
        return toResult({ rows: formatReport(res.data), rowCount: res.data.rowCount ?? null });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 10. ga4_device_breakdown ───────────────────────────────────────────────
  server.tool(
    'ga4_device_breakdown',
    'Show traffic split by device category: mobile, desktop, and tablet. ' +
    'Includes sessions, users, pageviews, and bounce rate per device type.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
    },
    async ({ startDate, endDate }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: [{ name: 'deviceCategory' }],
              metrics: [
                { name: 'sessions' },
                { name: 'totalUsers' },
                { name: 'screenPageViews' },
                { name: 'bounceRate' },
              ],
              orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            },
          })
        );
        return toResult({ rows: formatReport(res.data) });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 11. ga4_events ─────────────────────────────────────────────────────────
  server.tool(
    'ga4_events',
    'List all GA4 events and their counts for a date range. ' +
    'Use to audit event tracking or understand which user interactions are most common.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: [{ name: 'eventName' }],
              metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
              limit: limit ?? 20,
              orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            },
          })
        );
        return toResult({ rows: formatReport(res.data), rowCount: res.data.rowCount ?? null });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 12. ga4_conversions ────────────────────────────────────────────────────
  server.tool(
    'ga4_conversions',
    'Show conversion counts by event name. Only events marked as key events ' +
    '(conversions) in GA4 will appear. Use to measure goal completions.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: [{ name: 'eventName' }],
              metrics: [{ name: 'conversions' }, { name: 'totalUsers' }],
              limit: limit ?? 20,
              orderBys: [{ metric: { metricName: 'conversions' }, desc: true }],
            },
          })
        );
        const rows = formatReport(res.data).filter(r => parseFloat(r.conversions) > 0);
        return toResult({ rows, rowCount: rows.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 13. ga4_user_acquisition ───────────────────────────────────────────────
  server.tool(
    'ga4_user_acquisition',
    'Show where new users came from — first user source, medium, and campaign. ' +
    'Use to evaluate top-of-funnel acquisition channels.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: [
                { name: 'firstUserSource' },
                { name: 'firstUserMedium' },
                { name: 'firstUserCampaignName' },
              ],
              metrics: [{ name: 'newUsers' }, { name: 'totalUsers' }],
              limit: limit ?? 20,
              orderBys: [{ metric: { metricName: 'newUsers' }, desc: true }],
            },
          })
        );
        return toResult({ rows: formatReport(res.data), rowCount: res.data.rowCount ?? null });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 14. ga4_session_acquisition ───────────────────────────────────────────
  server.tool(
    'ga4_session_acquisition',
    'Show where sessions came from — session source, medium, and campaign. ' +
    'Use to evaluate which channels are driving the most traffic volume.',
    {
      startDate: z.string().optional().describe('Start date (default: 28daysAgo)'),
      endDate: z.string().optional().describe('End date (default: today)'),
      limit: z.number().optional().describe('Max rows (default: 20)'),
    },
    async ({ startDate, endDate, limit }) => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          analytics.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
              dateRanges: [{ startDate: startDate ?? DEFAULT_START, endDate: endDate ?? DEFAULT_END }],
              dimensions: [
                { name: 'sessionSource' },
                { name: 'sessionMedium' },
                { name: 'sessionCampaignName' },
              ],
              metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
              limit: limit ?? 20,
              orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
            },
          })
        );
        return toResult({ rows: formatReport(res.data), rowCount: res.data.rowCount ?? null });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 15. ga4_get_audiences ──────────────────────────────────────────────────
  // Uses Admin API v1alpha — audiences are not available in v1beta
  server.tool(
    'ga4_get_audiences',
    'List all audiences configured in this GA4 property — names, descriptions, ' +
    'and membership duration. Use to audit your audience setup.',
    {},
    async () => {
      try {
        const propertyId = getPropertyId();
        const res = await runWithTimeout(
          adminAlpha.properties.audiences.list({
            parent: `properties/${propertyId}`,
          })
        );
        const audiences = (res.data.audiences ?? []).map(a => ({
          name: a.displayName,
          description: a.description ?? '',
          membershipDurationDays: a.membershipDurationDays,
          resourceName: a.name,
        }));
        return toResult({ audiences, count: audiences.length });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
