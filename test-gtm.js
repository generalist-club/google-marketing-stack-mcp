import dotenv from 'dotenv';
import { google } from 'googleapis';
import { getAuthenticatedClient } from './src/auth.js';

dotenv.config({
  path: '/Users/ajinkyathakare/Claude_code/Ticmint/Growth Intelligence/growth-intelligence/.env',
  override: false,
});

const auth = await getAuthenticatedClient();
const tagmanager = google.tagmanager({ version: 'v2', auth });

async function run(label, fn) {
  console.log(`\n── ${label} ──`);
  try {
    return await fn();
  } catch (err) {
    const msg = err?.response?.data?.error?.message ?? err.message;
    console.error(`  ERROR: ${msg}`);
    return null;
  }
}

// ── 1. gtm_list_accounts ───────────────────────────────────────────────────
await run('GTM accounts', async () => {
  const res = await tagmanager.accounts.list();
  const accounts = res.data.account ?? [];
  accounts.forEach(a => console.log(`  ${a.accountId.padEnd(16)} ${a.name}`));
  console.log(`  (${accounts.length} account${accounts.length === 1 ? '' : 's'})`);
  return accounts;
});

// ── 2. gtm_list_containers ─────────────────────────────────────────────────
const accountId = process.env.GTM_ACCOUNT_ID;
if (!accountId) {
  console.log('\n  GTM_ACCOUNT_ID not set — skipping containers and audit');
  console.log('\n✅  Done (partial)\n');
  process.exit(0);
}

await run(`Containers in account ${accountId}`, async () => {
  const res = await tagmanager.accounts.containers.list({
    parent: `accounts/${accountId}`,
  });
  const containers = res.data.container ?? [];
  containers.forEach(c =>
    console.log(`  ${c.publicId.padEnd(16)} ${c.containerId.padEnd(12)} ${c.name}`)
  );
  console.log(`  (${containers.length} container${containers.length === 1 ? '' : 's'})`);
  return containers;
});

// ── 3. gtm_audit ──────────────────────────────────────────────────────────
const containerId = process.env.GTM_CONTAINER_ID;
if (!containerId) {
  console.log('\n  GTM_CONTAINER_ID not set — skipping audit');
  console.log('\n✅  Done (partial)\n');
  process.exit(0);
}

await run('GTM audit', async () => {
  const wsRes = await tagmanager.accounts.containers.workspaces.list({
    parent: `accounts/${accountId}/containers/${containerId}`,
  });
  const workspaces = wsRes.data.workspace ?? [];
  if (!workspaces.length) { console.log('  No workspaces found'); return; }

  const wPath = workspaces[0].path;
  console.log(`  Workspace : ${workspaces[0].name} (${workspaces[0].workspaceId})`);

  const [tagsRes, triggersRes, variablesRes] = await Promise.all([
    tagmanager.accounts.containers.workspaces.tags.list({ parent: wPath }),
    tagmanager.accounts.containers.workspaces.triggers.list({ parent: wPath }),
    tagmanager.accounts.containers.workspaces.variables.list({ parent: wPath }),
  ]);

  const tags      = tagsRes.data.tag          ?? [];
  const triggers  = triggersRes.data.trigger   ?? [];
  const variables = variablesRes.data.variable ?? [];

  console.log(`  Tags      : ${tags.length}`);
  console.log(`  Triggers  : ${triggers.length}`);
  console.log(`  Variables : ${variables.length}`);

  // Orphaned triggers
  const usedIds = new Set(tags.flatMap(t => [
    ...(t.firingTriggerId ?? []), ...(t.blockingTriggerId ?? []),
  ]));
  const orphaned = triggers.filter(t => !usedIds.has(t.triggerId));
  console.log(`\n  Orphaned triggers (${orphaned.length}):`);
  if (orphaned.length === 0) console.log('    none');
  else orphaned.forEach(t => console.log(`    • [${t.triggerId}] ${t.name} (${t.type})`));

  // Duplicate tag names
  const counts = {};
  tags.forEach(t => { counts[t.name] = (counts[t.name] ?? 0) + 1; });
  const dupes = Object.entries(counts).filter(([, n]) => n > 1);
  console.log(`\n  Duplicate tag names (${dupes.length}):`);
  if (dupes.length === 0) console.log('    none');
  else dupes.forEach(([name, n]) => console.log(`    • "${name}" — ${n} tags`));

  // Unused variables
  const allRefs = new Set();
  const scanRefs = obj => {
    for (const m of JSON.stringify(obj ?? {}).matchAll(/\{\{([^}]+)\}\}/g)) allRefs.add(m[1]);
  };
  tags.forEach(scanRefs);
  triggers.forEach(scanRefs);
  const unused = variables.filter(v => !allRefs.has(v.name));
  console.log(`\n  Unused variables (${unused.length}):`);
  if (unused.length === 0) console.log('    none');
  else unused.slice(0, 10).forEach(v => console.log(`    • ${v.name} (${v.type})`));
  if (unused.length > 10) console.log(`    … and ${unused.length - 10} more`);
});

console.log('\n✅  Done\n');
