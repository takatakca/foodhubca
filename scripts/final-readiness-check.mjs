const requiredFiles = [
  'supabase/schema.sql',
  'supabase/seed.sql',
  'supabase/rls.sql',
  'supabase/storage.sql',
  'supabase/phase25_live_connectors.sql',
  'supabase/final_operational_patch.sql',
  'supabase/rc4_security_patch.sql',
  'supabase/foodhub.sql',
  'supabase/release_1_4_0_patch.sql',
  'lib/backend/connectors/live-registry.ts',
  'lib/backend/live-sync-orchestrator.ts',
  'docs/FINAL_PRODUCT_READINESS.md',
  'docs/GO_LIVE_STEPS.md',
];

const fs = await import('node:fs');
let failed = false;
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    console.error(`Missing required final file: ${file}`);
    failed = true;
  } else {
    console.log(`OK ${file}`);
  }
}

const blocked = process.env.LIVE_CONNECTORS_GLOBAL_ENABLED !== 'true';
console.log(blocked ? 'INFO live connectors disabled by default' : 'WARN live connectors enabled');
if (failed) process.exit(1);
