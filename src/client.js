/**
 * Shared OAuth2 client singleton.
 *
 * All tool modules import getClient() from here. Auth runs once at startup;
 * every subsequent call returns the same already-authenticated client instance.
 */

import { getAuthenticatedClient } from './auth.js';

let _client = null;

export async function getClient() {
  if (!_client) {
    _client = await getAuthenticatedClient();
  }
  return _client;
}
