import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { logActivity } from '@/lib/foodhub/activity';
import { MEDIA_MAX_BYTES, saveImage } from '@/lib/foodhub/media';

export const dynamic = 'force-dynamic';

// Upload a menu photo (multipart field "file"). Returns the public URL the delivery apps download it from.
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return fail('Choose a photo (field "file").');
  if (file.size > MEDIA_MAX_BYTES) return fail('The photo is larger than 5 MB.', 413);
  const r = await saveImage(Buffer.from(await file.arrayBuffer()));
  if (!r.ok) return fail(r.error, 415);
  await logActivity({ actor: actor.name || actor.username, source: 'dashboard', kind: 'settings', action: 'photo_uploaded', status: 'success', summary: `Menu photo uploaded (${r.width}×${r.height}).` });
  return ok({ url: r.url, name: r.name, width: r.width, height: r.height, warning: r.warning ?? null });
});
