import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { google } from 'googleapis';

dotenv.config({
  path: '/Users/ajinkyathakare/Claude_code/Ticmint/Growth Intelligence/growth-intelligence/.env',
});

const ENV_PROPERTY_ID = process.env.GA4_PROPERTY_ID;
if (!ENV_PROPERTY_ID) {
  console.error('❌  GA4_PROPERTY_ID not found in .env at the specified path');
  process.exit(1);
}

const TOKEN_PATH = '/Users/ajinkyathakare/.google-marketing-mcp/token.json';

let tokens;
try {
  tokens = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));
} catch {
  console.error(`❌  Could not read token file at ${TOKEN_PATH}`);
  console.error('    Run the OAuth flow first (npm run auth)');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2Client.setCredentials(tokens);

const analyticsData = google.analyticsdata({ version: 'v1beta', auth: oauth2Client });

try {
  const propertyId = ENV_PROPERTY_ID.replace(/^properties\//, '');
  const res = await analyticsData.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'sessions' }],
    },
  });

  const sessions = res.data?.rows?.[0]?.metricValues?.[0]?.value ?? '(no data)';
  console.log(`✅  Token valid. GA4 property ${propertyId} — sessions (last 7 days): ${sessions}`);
} catch (err) {
  console.error('❌  GA4 API call failed:', err.message);
  process.exit(1);
}
