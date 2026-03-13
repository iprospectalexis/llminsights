/**
 * Script to manually reprocess audit results from OneSearch API
 *
 * Usage:
 * node scripts/reprocess-audit.js <AUDIT_ID> [JOB_ID]
 *
 * Example:
 * node scripts/reprocess-audit.js e02171c9-39ae-440a-b906-8e42fab52b66
 * node scripts/reprocess-audit.js e02171c9-39ae-440a-b906-8e42fab52b66 74f4ea65-2766-4561-87cb-5c5c4e853e6a
 */

import 'dotenv/config';

const AUDIT_ID = process.argv[2];
const JOB_ID = process.argv[3];

if (!AUDIT_ID) {
  console.error('Error: AUDIT_ID is required');
  console.log('Usage: node scripts/reprocess-audit.js <AUDIT_ID> [JOB_ID]');
  process.exit(1);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Error: Missing environment variables');
  console.error('Required: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

console.log('🔄 Starting audit reprocessing...');
console.log(`Audit ID: ${AUDIT_ID}`);
if (JOB_ID) {
  console.log(`Job ID: ${JOB_ID}`);
}

const apiUrl = `${SUPABASE_URL}/functions/v1/reprocess-audit-results`;

const body = {
  audit_id: AUDIT_ID
};

if (JOB_ID) {
  body.job_id = JOB_ID;
}

try {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const result = await response.json();

  console.log('\n✅ Reprocessing completed successfully!');
  console.log(`\nResults:`);
  console.log(`- Total responses: ${result.total_responses}`);
  console.log(`- Updated responses: ${result.updated_count}`);
  console.log(`- Audit ID: ${result.audit_id}`);
  console.log(`\nMessage: ${result.message}`);

} catch (error) {
  console.error('\n❌ Error reprocessing audit:');
  console.error(error.message);
  process.exit(1);
}
