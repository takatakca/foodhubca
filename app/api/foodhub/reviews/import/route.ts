import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { IMPORT_ERRORS, importReviews, MAX_IMPORT_BYTES, type ReviewMapping } from '@/lib/foodhub/reviews/import';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TOO_LARGE = IMPORT_ERRORS.tooLarge;
const tooLarge = () => fail(TOO_LARGE.en, 413, { errorFr: TOO_LARGE.fr });
/** The largest body worth reading: a 5 MB file as base64 (4/3) or multipart, plus the form fields. */
const MAX_BODY_BYTES = Math.ceil(MAX_IMPORT_BYTES * 1.4) + 64 * 1024;
const MAX_BASE64_CHARS = Math.ceil((MAX_IMPORT_BYTES * 4) / 3) + 4;

// POST multipart/form-data: file, platform?, mapping? (JSON { date, stars, text, store, storeName, order } column
// indexes), brandName?, locationCode?. ?dryRun=1 → preview (first 20 rows + counts), nothing saved.
// Also accepts JSON { fileName, contentBase64, platform?, mapping?, brandName?, locationCode? }.
// A body announced larger than a 5 MB file is refused before it is read.
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
  const dryRun = /^(1|true)$/i.test(new URL(req.url).searchParams.get('dryRun') ?? '');
  let fileName = ''; let bytes: Uint8Array;
  let fields: Record<string, unknown> = {};
  if (/multipart\/form-data/i.test(req.headers.get('content-type') ?? '')) {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !file || typeof file === 'string') return fail('Choose a file.', 400, { errorFr: 'Choisissez un fichier.' });
    if (file.size > MAX_IMPORT_BYTES) return tooLarge();
    fileName = file.name; bytes = new Uint8Array(await file.arrayBuffer());
    fields = Object.fromEntries([...form.entries()].filter(([k, v]) => k !== 'file' && typeof v === 'string'));
  } else {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!b.fileName || !b.contentBase64) return fail('Choose a file.', 400, { errorFr: 'Choisissez un fichier.' });
    const base64 = String(b.contentBase64);
    if (base64.length > MAX_BASE64_CHARS) return tooLarge();
    fileName = String(b.fileName);
    bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    fields = b;
  }
  if (bytes.length > MAX_IMPORT_BYTES) return tooLarge();
  let mapping: ReviewMapping | null = null;
  if (fields.mapping) {
    try { mapping = typeof fields.mapping === 'string' ? JSON.parse(fields.mapping) : (fields.mapping as ReviewMapping); } catch { return fail('Invalid column mapping.', 400, { errorFr: 'Choix de colonnes invalide.' }); }
  }
  const locationCode = fields.locationCode ? String(fields.locationCode) : null;
  if (locationCode && actor.locations.length && !actor.locations.includes(locationCode)) return fail('This kitchen is not in your access.', 403, { errorFr: 'Cette cuisine n’est pas dans votre accès.' });
  const out = await importReviews(fileName, bytes, {
    platform: fields.platform ? String(fields.platform) : null, mapping, dryRun,
    brandName: fields.brandName ? String(fields.brandName) : null, locationCode,
    allowedLocations: actor.locations.length ? actor.locations : undefined,
  }, actor);
  if (!out.ok) {
    // Columns to choose is a normal answer (HTTP 200), not an error.
    if (out.needsMapping) return ok({ imported: false, needsMapping: true, headers: out.headers, fields: out.fields, platform: out.platform, message: out.error, messageFr: out.errorFr });
    return fail(out.error, out.error === TOO_LARGE.en ? 413 : 400, { errorFr: out.errorFr });
  }
  return ok({ ...out, imported: !out.dryRun });
});
