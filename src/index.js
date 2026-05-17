#!/usr/bin/env node

/**
 * Google Marketing Stack MCP — server entry point.
 *
 * Starts the MCP server over stdio, authenticates with Google once,
 * and registers all tools across GA4, GSC, Sheets, GTM, and PageSpeed.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getClient } from './client.js';

// Tool registration — imported as each phase is built
import { registerGa4Tools } from './tools/ga4.js';
import { registerGscTools } from './tools/gsc.js';
import { registerSheetsTools } from './tools/sheets.js';
import { registerGtmTools } from './tools/gtm.js';
import { registerPagespeedTools } from './tools/pagespeed.js';

async function main() {
  const server = new McpServer({
    name: 'google-marketing-stack-mcp',
    version: '1.0.0',
  });

  // Authenticate before registering tools so all tool handlers have a live client
  const client = await getClient();

  registerGa4Tools(server, client);
  registerGscTools(server, client);
  registerSheetsTools(server, client);
  registerGtmTools(server, client);
  registerPagespeedTools(server);

  // Utility tools — available from Phase 1
  registerUtilityTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function registerUtilityTools(server, client) {
  server.tool(
    'get_status',
    'Check authentication status and confirm which Google account is connected. ' +
    'Run this first to verify the MCP server is working correctly.',
    {},
    async () => {
      try {
        const { google } = await import('googleapis');
        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const { data } = await oauth2.userinfo.get();
        return {
          content: [{
            type: 'text',
            text: [
              'Google Marketing Stack MCP — connected',
              `Account: ${data.email}`,
              '',
              'Available tool groups (enabled as each phase ships):',
              '  GA4         — ga4_* tools',
              '  GSC         — gsc_* tools',
              '  Sheets      — sheets_* tools',
              '  GTM         — gtm_* tools',
              '  PageSpeed   — psi_* tools (no auth required)',
            ].join('\n'),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Status check failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'reauthenticate',
    'Clear the stored Google token and restart the login flow. ' +
    'Use this if you need to switch accounts or if authentication has stopped working.',
    {},
    async () => {
      const { clearToken } = await import('./auth.js');
      await clearToken();
      return {
        content: [{
          type: 'text',
          text: 'Token cleared. Restart the MCP server to log in again.',
        }],
      };
    }
  );
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
