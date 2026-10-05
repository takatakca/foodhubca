// Regenerates supabase/INSTALL_ALL.sql (one paste in the Supabase SQL Editor) from the Food Hub install files.
// Every file is idempotent, so INSTALL_ALL.sql can be run again after an upgrade.
import { readFileSync, writeFileSync } from 'node:fs';

const files = ['foodhub.sql', 'rc10.sql'];
const parts = [
  '-- TAKATAK Food Hub — ONE-PASTE DATABASE INSTALL',
  '-- Paste this entire file into the Supabase SQL Editor and click Run. Safe to run again after an upgrade.',
  `-- It contains ${files.length} install files in order. Regenerate with: node scripts/build-install-sql.mjs`,
  '',
];
for (const f of files) {
  parts.push('-- ============================================================', `-- FILE: ${f}`, '-- ============================================================', readFileSync(`supabase/${f}`, 'utf8').trimEnd(), '');
}
writeFileSync('supabase/INSTALL_ALL.sql', parts.join('\n') + '\n');
console.log(`supabase/INSTALL_ALL.sql written (${files.length} files).`);
