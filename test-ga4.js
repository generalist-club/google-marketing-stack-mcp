import dotenv from 'dotenv';
import { google } from 'googleapis';
import { getAuthenticatedClient } from './src/auth.js';

dotenv.config(); // create a .env file from .env.example and fill in your values

const propertyId = process.env.GA4_PROPERTY_ID?.replace(/^properties\//, '');
if (!propertyId) {
  console.error('GA4_PROPERTY_ID not set');
  process.exit(1);
}

const auth = await getAuthenticatedClient();
const analytics = google.analyticsdata({ version: 'v1beta', auth });

function formatRows(response) {
  const dimHeaders = (response.dimensionHeaders ?? []).map(h => h.name);
  const metHeaders = (response.metricHeaders ?? []).map(h => h.name);
  return (response.rows ?? []).map(row => {
    const obj = {};
    (row.dimensionValues ?? []).forEach((v, i) => { obj[dimHeaders[i]] = v.value; });
    (row.metricValues ?? []).forEach((v, i) => { obj[metHeaders[i]] = v.value; });
    return obj;
  });
}

async function run(label, requestBody) {
  console.log(`\n── ${label} ──`);
  try {
    const res = await analytics.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody,
    });
    return formatRows(res.data);
  } catch (err) {
    const msg = err?.response?.data?.error?.message ?? err.message;
    console.error(`  ERROR: ${msg}`);
    return null;
  }
}

// 1. Traffic overview — last 28 days
const overview = await run('Traffic overview — last 28 days', {
  dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
  metrics: [
    { name: 'sessions' },
    { name: 'totalUsers' },
    { name: 'screenPageViews' },
    { name: 'bounceRate' },
    { name: 'averageSessionDuration' },
  ],
});
if (overview) {
  const r = overview[0];
  console.log(`  Sessions          : ${Number(r.sessions).toLocaleString()}`);
  console.log(`  Users             : ${Number(r.totalUsers).toLocaleString()}`);
  console.log(`  Pageviews         : ${Number(r.screenPageViews).toLocaleString()}`);
  console.log(`  Bounce rate       : ${(parseFloat(r.bounceRate) * 100).toFixed(1)}%`);
  console.log(`  Avg session (sec) : ${parseFloat(r.averageSessionDuration).toFixed(0)}`);
}

// 2. Channel breakdown
const channels = await run('Sessions by channel — last 28 days', {
  dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
  dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
  metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
  orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
});
if (channels) {
  channels.forEach(r => {
    console.log(`  ${r.sessionDefaultChannelGrouping.padEnd(28)} ${Number(r.sessions).toLocaleString()} sessions  ${Number(r.totalUsers).toLocaleString()} users`);
  });
}

// 3. Top 5 pages by pageviews
const pages = await run('Top 5 pages by pageviews — last 28 days', {
  dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
  dimensions: [{ name: 'pagePath' }],
  metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }],
  orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
  limit: 5,
});
if (pages) {
  pages.forEach((r, i) => {
    const path = r.pagePath.length > 50 ? r.pagePath.slice(0, 47) + '...' : r.pagePath;
    console.log(`  ${String(i + 1).padStart(2)}. ${path.padEnd(52)} ${Number(r.screenPageViews).toLocaleString()} views`);
  });
}

console.log('\n✅  Done\n');
