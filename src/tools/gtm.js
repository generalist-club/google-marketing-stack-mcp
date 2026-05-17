import { z } from 'zod';
import { google } from 'googleapis';

const TIMEOUT_MS = 30_000;

function getAccountId() {
  const id = process.env.GTM_ACCOUNT_ID;
  if (!id) throw new Error(
    'GTM_ACCOUNT_ID is not set. Add GTM_ACCOUNT_ID=your_account_id to your environment.'
  );
  return id;
}

function getContainerId() {
  const id = process.env.GTM_CONTAINER_ID;
  if (!id) throw new Error(
    'GTM_CONTAINER_ID is not set. Add GTM_CONTAINER_ID=your_container_id to your environment.'
  );
  return id;
}

function containerPath() {
  return `accounts/${getAccountId()}/containers/${getContainerId()}`;
}

async function runWithTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('GTM API request timed out after 30 seconds')),
      TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Returns the workspace path, using an explicit ID, GTM_WORKSPACE_ID env var,
// or auto-resolving to the first workspace in the container.
async function resolveWorkspacePath(tagmanager, workspaceId) {
  const wsId = workspaceId ?? process.env.GTM_WORKSPACE_ID;
  if (wsId) return `${containerPath()}/workspaces/${wsId}`;

  const res = await runWithTimeout(
    tagmanager.accounts.containers.workspaces.list({ parent: containerPath() })
  );
  const workspaces = res.data.workspace ?? [];
  if (!workspaces.length) throw new Error('No workspaces found in this GTM container.');
  return workspaces[0].path;
}

// Extract {{Variable Name}} references from any serialised GTM object
function extractVarRefs(obj) {
  const refs = new Set();
  for (const m of JSON.stringify(obj ?? {}).matchAll(/\{\{([^}]+)\}\}/g)) {
    refs.add(m[1]);
  }
  return refs;
}

function toResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function toError(err) {
  const msg = err?.response?.data?.error?.message ?? err.message ?? 'Unknown error';
  const status = err?.response?.status ?? err?.status ?? null;
  return {
    content: [{ type: 'text', text: status ? `GTM error ${status}: ${msg}` : `GTM error: ${msg}` }],
    isError: true,
  };
}

export function registerGtmTools(server, client) {
  const tagmanager = google.tagmanager({ version: 'v2', auth: client });

  // ── 1. gtm_list_accounts ──────────────────────────────────────────────────
  server.tool(
    'gtm_list_accounts',
    'List all GTM accounts accessible with the connected Google account. ' +
    'Use to find your GTM_ACCOUNT_ID if you do not know it.',
    {},
    async () => {
      try {
        const res = await runWithTimeout(tagmanager.accounts.list());
        const accounts = (res.data.account ?? []).map(a => ({
          accountId: a.accountId,
          name:      a.name,
          path:      a.path,
        }));
        return toResult({ accounts, count: accounts.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 2. gtm_list_containers ────────────────────────────────────────────────
  server.tool(
    'gtm_list_containers',
    'List all GTM containers in the configured account. ' +
    'Use to find your GTM_CONTAINER_ID and the public GTM-XXXXXX ID.',
    {},
    async () => {
      try {
        const res = await runWithTimeout(
          tagmanager.accounts.containers.list({ parent: `accounts/${getAccountId()}` })
        );
        const containers = (res.data.container ?? []).map(c => ({
          containerId:  c.containerId,
          name:         c.name,
          publicId:     c.publicId,
          usageContext: c.usageContext ?? [],
          path:         c.path,
        }));
        return toResult({ containers, count: containers.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 3. gtm_list_workspaces ────────────────────────────────────────────────
  server.tool(
    'gtm_list_workspaces',
    'List all workspaces in the configured GTM container. ' +
    'Returns workspace IDs and names. Use to find the workspaceId for other GTM tools.',
    {},
    async () => {
      try {
        const res = await runWithTimeout(
          tagmanager.accounts.containers.workspaces.list({ parent: containerPath() })
        );
        const workspaces = (res.data.workspace ?? []).map(w => ({
          workspaceId: w.workspaceId,
          name:        w.name,
          description: w.description ?? '',
          path:        w.path,
        }));
        return toResult({ workspaces, count: workspaces.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 4. gtm_list_tags ──────────────────────────────────────────────────────
  server.tool(
    'gtm_list_tags',
    'List all tags in a GTM workspace — name, type, firing triggers, and paused state. ' +
    'Defaults to the first workspace if workspaceId is not provided.',
    {
      workspaceId: z.string().optional().describe('Workspace ID (default: first workspace in the container)'),
    },
    async ({ workspaceId }) => {
      try {
        const wPath = await resolveWorkspacePath(tagmanager, workspaceId);
        const res = await runWithTimeout(
          tagmanager.accounts.containers.workspaces.tags.list({ parent: wPath })
        );
        const tags = (res.data.tag ?? []).map(t => ({
          tagId:              t.tagId,
          name:               t.name,
          type:               t.type,
          paused:             t.paused ?? false,
          firingTriggerIds:   t.firingTriggerId   ?? [],
          blockingTriggerIds: t.blockingTriggerId ?? [],
        }));
        return toResult({ tags, count: tags.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 5. gtm_list_triggers ──────────────────────────────────────────────────
  server.tool(
    'gtm_list_triggers',
    'List all triggers in a GTM workspace — name, type, and trigger ID. ' +
    'Defaults to the first workspace if workspaceId is not provided.',
    {
      workspaceId: z.string().optional().describe('Workspace ID (default: first workspace in the container)'),
    },
    async ({ workspaceId }) => {
      try {
        const wPath = await resolveWorkspacePath(tagmanager, workspaceId);
        const res = await runWithTimeout(
          tagmanager.accounts.containers.workspaces.triggers.list({ parent: wPath })
        );
        const triggers = (res.data.trigger ?? []).map(t => ({
          triggerId: t.triggerId,
          name:      t.name,
          type:      t.type,
        }));
        return toResult({ triggers, count: triggers.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 6. gtm_list_variables ─────────────────────────────────────────────────
  server.tool(
    'gtm_list_variables',
    'List all variables in a GTM workspace — name and type. ' +
    'Defaults to the first workspace if workspaceId is not provided.',
    {
      workspaceId: z.string().optional().describe('Workspace ID (default: first workspace in the container)'),
    },
    async ({ workspaceId }) => {
      try {
        const wPath = await resolveWorkspacePath(tagmanager, workspaceId);
        const res = await runWithTimeout(
          tagmanager.accounts.containers.workspaces.variables.list({ parent: wPath })
        );
        const variables = (res.data.variable ?? []).map(v => ({
          variableId: v.variableId,
          name:       v.name,
          type:       v.type,
        }));
        return toResult({ variables, count: variables.length });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 7. gtm_get_tag ────────────────────────────────────────────────────────
  server.tool(
    'gtm_get_tag',
    'Get full details for a single GTM tag by ID, including all parameters and trigger bindings. ' +
    'Use after gtm_list_tags to inspect a specific tag in depth.',
    {
      tagId:       z.string().describe('Tag ID from gtm_list_tags'),
      workspaceId: z.string().optional().describe('Workspace ID (default: first workspace in the container)'),
    },
    async ({ tagId, workspaceId }) => {
      try {
        const wPath = await resolveWorkspacePath(tagmanager, workspaceId);
        const res = await runWithTimeout(
          tagmanager.accounts.containers.workspaces.tags.get({
            path: `${wPath}/tags/${tagId}`,
          })
        );
        const t = res.data;
        return toResult({
          tagId:              t.tagId,
          name:               t.name,
          type:               t.type,
          paused:             t.paused ?? false,
          tagFiringOption:    t.tagFiringOption,
          firingTriggerIds:   t.firingTriggerId   ?? [],
          blockingTriggerIds: t.blockingTriggerId ?? [],
          parameters:         t.parameter        ?? [],
          monitoringMetadata: t.monitoringMetadata ?? null,
          notes:              t.notes ?? '',
        });
      } catch (err) {
        return toError(err);
      }
    }
  );

  // ── 8. gtm_audit ──────────────────────────────────────────────────────────
  server.tool(
    'gtm_audit',
    'Audit a GTM workspace and return a structured report of issues: ' +
    'orphaned triggers (not used by any tag), duplicate tag names, and ' +
    'unused variables (not referenced by any tag or trigger). ' +
    'Defaults to the first workspace if workspaceId is not provided.',
    {
      workspaceId: z.string().optional().describe('Workspace ID (default: first workspace in the container)'),
    },
    async ({ workspaceId }) => {
      try {
        const wPath = await resolveWorkspacePath(tagmanager, workspaceId);

        const [tagsRes, triggersRes, variablesRes] = await Promise.all([
          runWithTimeout(tagmanager.accounts.containers.workspaces.tags.list({ parent: wPath })),
          runWithTimeout(tagmanager.accounts.containers.workspaces.triggers.list({ parent: wPath })),
          runWithTimeout(tagmanager.accounts.containers.workspaces.variables.list({ parent: wPath })),
        ]);

        const tags      = tagsRes.data.tag          ?? [];
        const triggers  = triggersRes.data.trigger   ?? [];
        const variables = variablesRes.data.variable ?? [];

        // Orphaned triggers — not referenced by any tag
        const usedTriggerIds = new Set(
          tags.flatMap(t => [
            ...(t.firingTriggerId   ?? []),
            ...(t.blockingTriggerId ?? []),
          ])
        );
        const orphanedTriggers = triggers
          .filter(t => !usedTriggerIds.has(t.triggerId))
          .map(t => ({ triggerId: t.triggerId, name: t.name, type: t.type }));

        // Duplicate tag names
        const nameCounts = {};
        tags.forEach(t => { nameCounts[t.name] = (nameCounts[t.name] ?? 0) + 1; });
        const duplicateTagNames = Object.entries(nameCounts)
          .filter(([, count]) => count > 1)
          .map(([name, count]) => ({ name, count }));

        // Unused variables — not referenced in any tag or trigger
        const allRefs = new Set();
        for (const t of tags)     for (const r of extractVarRefs(t)) allRefs.add(r);
        for (const t of triggers) for (const r of extractVarRefs(t)) allRefs.add(r);

        const unusedVariables = variables
          .filter(v => !allRefs.has(v.name))
          .map(v => ({ variableId: v.variableId, name: v.name, type: v.type }));

        const issueCount =
          orphanedTriggers.length + duplicateTagNames.length + unusedVariables.length;

        return toResult({
          summary: {
            totalTags:      tags.length,
            totalTriggers:  triggers.length,
            totalVariables: variables.length,
            issuesFound:    issueCount,
          },
          orphanedTriggers,
          duplicateTagNames,
          unusedVariables,
        });
      } catch (err) {
        return toError(err);
      }
    }
  );
}
