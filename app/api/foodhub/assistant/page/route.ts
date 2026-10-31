import { withPerm } from '@/lib/foodhub/auth';
import { pageBrief } from '@/lib/foodhub/assistant/chat';
import { assistantConfigured, assistantModel } from '@/lib/foodhub/assistant/config';
import { buildPageSnapshot } from '@/lib/foodhub/assistant/snapshot';
import { ok, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST { route, lang, extra?, ai? } → { snapshot, brief, aiConfigured }: the page's key numbers (computed here, for the
// person's kitchens), a summary and 3–4 numbered next steps, and the nudges ("Investigate this"). ai: true asks Claude
// for the summary (cached 3 min); otherwise, and always without ANTHROPIC_API_KEY, the built-in rules write it.
export const POST = withPerm('view', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const lang = b.lang === 'en' ? 'en' : 'fr';
  const snapshot = await buildPageSnapshot(typeof b.route === 'string' ? b.route : '/', actor, { extra: b.extra });
  const brief = await pageBrief(snapshot, actor, lang, { useAi: b.ai === true });
  const ai = assistantConfigured();
  return ok({ snapshot, brief, aiConfigured: ai, ...(ai ? { model: assistantModel() } : {}) });
});
