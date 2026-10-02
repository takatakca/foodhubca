// Regenerates supabase/INSTALL_ALL.sql (one paste in Supabase SQL Editor) from the 8 install files.
import { readFileSync, writeFileSync } from 'node:fs';

const files = ['schema.sql', 'seed.sql', 'storage.sql', 'rls.sql', 'phase25_live_connectors.sql', 'final_operational_patch.sql', 'rc4_security_patch.sql', 'foodhub.sql'];
const parts = [
  '-- TAKATAK Accounting Control Tower + Food Hub — ONE-PASTE DATABASE INSTALL',
  '-- Paste this entire file into Supabase SQL Editor and click Run once.',
  `-- It contains all ${files.length} install files in the correct order. Regenerate with: node scripts/build-install-sql.mjs`,
  '',
];
for (const f of files) {
  parts.push('-- ============================================================', `-- FILE: ${f}`, '-- ============================================================', readFileSync(`supabase/${f}`, 'utf8').trimEnd(), '');
}
writeFileSync('supabase/INSTALL_ALL.sql', parts.join('\n') + '\n');
console.log(`supabase/INSTALL_ALL.sql written (${files.length} files).`);
