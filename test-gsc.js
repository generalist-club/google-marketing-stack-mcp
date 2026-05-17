import dotenv from 'dotenv';
import { google } from 'googleapis';
import { getAuthenticatedClient } from './src/auth.js';

dotenv.config(); // create a .env file from .env.example and fill in your values

const siteUrl = process.env.GSC_SITE_URL;
if (!siteUrl) {
  console.error('GSC_SITE_URL not set');
  process.exit(1);
}

const auth = await getAuthenticatedClient();
const webmasters = google.webmasters({ version: 'v3', auth });

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
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

async function run(label, requestBody) {
  console.log(`\n── ${label} ──`);
  try {
    const res = await webmasters.searchanalytics.query({ siteUrl, requestBody });
    return formatRows(res.data.rows, requestBody.dimensions);
  } catch (err) {
    const msg = err?.response?.data?.error?.message ?? err.message;
    console.error(`  ERROR: ${msg}`);
    return null;
  }
}

const startDate = daysAgo(28);
const endDate   = daysAgo(3);

// 1. Top queries
const queries = await run('Top 10 queries by clicks — last 28 days', {
  startDate, endDate, dimensions: ['query'], rowLimit: 10,
});
if (queries) {
  console.log(`  ${'Query'.padEnd(45)} Clicks  Impr   CTR    Pos`);
  console.log(`  ${'─'.repeat(45)} ──────  ────   ───    ───`);
  queries.forEach(r => {
    const q = r.query.length > 44 ? r.query.slice(0, 41) + '...' : r.query;
    console.log(
      `  ${q.padEnd(45)} ${String(r.clicks).padStart(6)}  ${String(r.impressions).padStart(4)}   ${String(r.ctr + '%').padStart(5)}  ${r.position}`
    );
  });
}

// 2. Top pages
const pages = await run('Top 10 pages by clicks — last 28 days', {
  startDate, endDate, dimensions: ['page'], rowLimit: 10,
});
if (pages) {
  console.log(`  ${'Page'.padEnd(55)} Clicks  Impr`);
  console.log(`  ${'─'.repeat(55)} ──────  ────`);
  pages.forEach(r => {
    const p = r.page.length > 54 ? r.page.slice(0, 51) + '...' : r.page;
    console.log(`  ${p.padEnd(55)} ${String(r.clicks).padStart(6)}  ${String(r.impressions).padStart(4)}`);
  });
}

// 3. Daily performance
const daily = await run('Daily performance — last 28 days', {
  startDate, endDate, dimensions: ['date'], rowLimit: 500,
});
if (daily) {
  const totalClicks      = daily.reduce((s, r) => s + r.clicks, 0);
  const totalImpressions = daily.reduce((s, r) => s + r.impressions, 0);
  const avgCtr           = parseFloat((daily.reduce((s, r) => s + r.ctr, 0) / daily.length).toFixed(1));
  const avgPosition      = parseFloat((daily.reduce((s, r) => s + r.position, 0) / daily.length).toFixed(1));

  console.log(`  Days in range     : ${daily.length}`);
  console.log(`  Total clicks      : ${totalClicks.toLocaleString()}`);
  console.log(`  Total impressions : ${totalImpressions.toLocaleString()}`);
  console.log(`  Avg daily CTR     : ${avgCtr}%`);
  console.log(`  Avg position      : ${avgPosition}`);
  console.log(`\n  Last 5 days:`);
  daily.slice(-5).forEach(r => {
    console.log(`    ${r.date}  clicks: ${String(r.clicks).padStart(5)}  impr: ${String(r.impressions).padStart(6)}  pos: ${r.position}`);
  });
}

console.log('\n✅  Done\n');
