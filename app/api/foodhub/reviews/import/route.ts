import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { importReviews, MAX_IMPORT_BYTES, type ReviewMapping } from '@/lib/foodhub/reviews/import';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TOO_LARGE = 'File too large (max 5 MB): export a shorter period.';

// POST multipart/form-data: file, platform?, mapping? (JSON { date, stars, text, store, order } column indexes),
// brandName?, locationCode?. ?dryRun=1 → preview (first 20 rows + counts), nothing saved.
// Also accepts JSON { fileName, contentBase64, platform?, mapping?, brandName?, locationCode? }.
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  const dryRun = /^(1|true)$/i.test(new URL(req.url).searchParams.get('dryRun') ?? '');
  let fileName = ''; let bytes: Uint8Array;
  let fields: Record<string, unknown> = {};
  if (/multipart\/form-data/i.test(req.headers.get('content-type') ?? '')) {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !file || typeof file === 'string') return fail('Choose a file.');
    if (file.size > MAX_IMPORT_BYTES) return fail(TOO_LARGE, 413);
    fileName = file.name; bytes = new Uint8Array(await file.arrayBuffer());
    fields = Object.fromEntries([...form.entries()].filter(([k, v]) => k !== 'file' && typeof v === 'string'));
  } else {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!b.fileName || !b.contentBase64) return fail('Choose a file.');
    fileName = String(b.fileName);
    bytes = new Uint8Array(Buffer.from(String(b.contentBase64), 'base64'));
    fields = b;
  }
  if (bytes.length > MAX_IMPORT_BYTES) return fail(TOO_LARGE, 413);
  let mapping: ReviewMapping | null = null;
  if (fields.mapping) {
    try { mapping = typeof fields.mapping === 'string' ? JSON.parse(fields.mapping) : (fields.mapping as ReviewMapping); } catch { return fail('Invalid column mapping.'); }
  }
  const locationCode = fields.locationCode ? String(fields.locationCode) : null;
  if (locationCode && actor.locations.length && !actor.locations.includes(locationCode)) return fail('This kitchen is not in your access.', 403);
  const out = await importReviews(fileName, bytes, {
    platform: fields.platform ? String(fields.platform) : null, mapping, dryRun,
    brandName: fields.brandName ? String(fields.brandName) : null, locationCode,
    allowedLocations: actor.locations.length ? actor.locations : undefined,
  }, actor);
  if (!out.ok) {
    // Columns to choose is a normal answer (HTTP 200), not an error.
    if (out.needsMapping) return ok({ imported: false, needsMapping: true, headers: out.headers, fields: out.fields, platform: out.platform, message: out.error });
    return fail(out.error, out.error === TOO_LARGE ? 413 : 400);
  }
  return ok({ ...out, imported: !out.dryRun });
});
