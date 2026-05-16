import dotenv from 'dotenv';
import { google } from 'googleapis';
import { getAuthenticatedClient } from './src/auth.js';

// override: false — never clobber vars already set in the shell environment.
// The Growth Intelligence .env uses GOOGLE_ADS_CLIENT_ID, not GOOGLE_CLIENT_ID,
// so without this flag dotenv would write empty strings over the real credentials.
dotenv.config({
  path: '/Users/ajinkyathakare/Claude_code/Ticmint/Growth Intelligence/growth-intelligence/.env',
  override: false,
});

const propertyId = process.env.GA4_PROPERTY_ID?.replace(/^properties\//, '');
if (!propertyId) {
  console.error('❌  GA4_PROPERTY_ID not found in .env at the specified path');
  process.exit(1);
}

const auth = await getAuthenticatedClient();
console.log('auth check:', auth.credentials?.access_token ? 'token present' : 'token missing');

const analyticsData = google.analyticsdata({ version: 'v1beta', auth });

const res = await analyticsData.properties.runReport({
  property: `properties/${propertyId}`,
  requestBody: {
    dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
    metrics: [{ name: 'sessions' }],
  },
});

const sessions = res.data?.rows?.[0]?.metricValues?.[0]?.value ?? '(no data)';
console.log(`✅  Token valid. GA4 property ${propertyId} — sessions (last 7 days): ${sessions}`);
