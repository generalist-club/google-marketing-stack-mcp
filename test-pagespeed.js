// No .env needed — PSI works without a key (rate limited but functional)

const PSI_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const URL = 'https://ticmint.com';

async function fetchPsi(url, strategy) {
  const params = new URLSearchParams({ url, strategy });
  const key = process.env.PSI_API_KEY;
  if (key) params.set('key', key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${PSI_BASE}?${params}`, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('timed out after 60s');
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
  };
}

function fieldCwv(data) {
  const m = data.loadingExperience?.metrics;
  if (!m) return null;
  const cls = m['CUMULATIVE_LAYOUT_SHIFT_SCORE'];
  return {
    lcp: m['LARGEST_CONTENTFUL_PAINT_MS']
      ? `${m['LARGEST_CONTENTFUL_PAINT_MS'].percentile}ms (${m['LARGEST_CONTENTFUL_PAINT_MS'].category})` : 'n/a',
    inp: m['INTERACTION_TO_NEXT_PAINT']
      ? `${m['INTERACTION_TO_NEXT_PAINT'].percentile}ms (${m['INTERACTION_TO_NEXT_PAINT'].category})` : 'n/a',
    cls: cls
      ? `${(cls.percentile / 100).toFixed(2)} (${cls.category})` : 'n/a',
    overall: data.loadingExperience?.overall_category ?? 'n/a',
  };
}

// ── 1. psi_lighthouse ─────────────────────────────────────────────────────
console.log(`\n── psi_lighthouse — ${URL} (mobile) ──`);
try {
  const data = await fetchPsi(URL, 'mobile');
  const s = scores(data);
  console.log(`  Performance   : ${s.performance}`);
  console.log(`  Accessibility : ${s.accessibility}`);
  console.log(`  Best Practices: ${s.bestPractices}`);
  console.log(`  SEO           : ${s.seo}`);
} catch (err) {
  console.error(`  ERROR: ${err.message}`);
}

// ── 2. psi_core_web_vitals ────────────────────────────────────────────────
console.log(`\n── psi_core_web_vitals — ${URL} (mobile) ──`);
try {
  const data = await fetchPsi(URL, 'mobile');
  const lab   = labCwv(data);
  const field = fieldCwv(data);
  console.log('  Lab data:');
  console.log(`    LCP        : ${lab.lcp}`);
  console.log(`    TBT        : ${lab.tbt}`);
  console.log(`    CLS        : ${lab.cls}`);
  console.log(`    FCP        : ${lab.fcp}`);
  console.log(`    Speed Index: ${lab.speedIndex}`);
  if (field) {
    console.log('  Field data (CrUX p75):');
    console.log(`    LCP        : ${field.lcp}`);
    console.log(`    INP        : ${field.inp}`);
    console.log(`    CLS        : ${field.cls}`);
    console.log(`    Overall    : ${field.overall}`);
  } else {
    console.log('  Field data : not available for this URL');
  }
} catch (err) {
  console.error(`  ERROR: ${err.message}`);
}

// ── 3. psi_compare ────────────────────────────────────────────────────────
console.log(`\n── psi_compare — ${URL} (mobile vs desktop) ──`);
try {
  const [mobile, desktop] = await Promise.all([
    fetchPsi(URL, 'mobile'),
    fetchPsi(URL, 'desktop'),
  ]);
  const ms = scores(mobile);
  const ds = scores(desktop);
  const ml = labCwv(mobile);
  const dl = labCwv(desktop);

  console.log(`  ${'Metric'.padEnd(18)} ${'Mobile'.padStart(8)}  ${'Desktop'.padStart(8)}`);
  console.log(`  ${'─'.repeat(18)} ${'─'.repeat(8)}  ${'─'.repeat(8)}`);
  console.log(`  ${'Performance'.padEnd(18)} ${String(ms.performance).padStart(8)}  ${String(ds.performance).padStart(8)}`);
  console.log(`  ${'Accessibility'.padEnd(18)} ${String(ms.accessibility).padStart(8)}  ${String(ds.accessibility).padStart(8)}`);
  console.log(`  ${'Best Practices'.padEnd(18)} ${String(ms.bestPractices).padStart(8)}  ${String(ds.bestPractices).padStart(8)}`);
  console.log(`  ${'SEO'.padEnd(18)} ${String(ms.seo).padStart(8)}  ${String(ds.seo).padStart(8)}`);
  console.log(`  ${'LCP'.padEnd(18)} ${ml.lcp.padStart(8)}  ${dl.lcp.padStart(8)}`);
  console.log(`  ${'CLS'.padEnd(18)} ${ml.cls.padStart(8)}  ${dl.cls.padStart(8)}`);
  console.log(`  ${'TBT'.padEnd(18)} ${ml.tbt.padStart(8)}  ${dl.tbt.padStart(8)}`);
} catch (err) {
  console.error(`  ERROR: ${err.message}`);
}

console.log('\n✅  Done\n');
