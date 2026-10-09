import { approvalGate, inScope, withPerm } from '@/lib/foodhub/auth';
import { decideAlcohol } from '@/lib/foodhub/alcohol/rules';
import { requireFeature } from '@/lib/foodhub/expansion/features';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { adjustStock, cleanProduct, deleteProduct, findByBarcode, getProduct, listProducts, parseProductCsv, productProblems, saveProduct, saveProductsBulk, type RetailProduct } from '@/lib/foodhub/retail/catalog';
import { importRetailFromClover, pushProductToClover } from '@/lib/foodhub/retail/clover';
import { previewRetailPayloads, RETAIL_PLATFORMS } from '@/lib/foodhub/retail/platforms';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Grocery / retail catalogue. GET ?barcode= finds one product (scanner); ?preview=<location> shows the platform payloads.
export const GET = withPerm('view', async (req, _ctx, actor) => {
  const url = new URL(req.url);
  const barcode = url.searchParams.get('barcode');
  if (barcode) return ok({ product: await findByBarcode(barcode) });
  const preview = url.searchParams.get('preview');
  if (preview) {
    if (!inScope(actor, preview)) return fail('Not your location.', 403);
    const [dd, ue] = await Promise.all([decideAlcohol(preview, 'doordash', { ignoreHours: true }), decideAlcohol(preview, 'uber_eats', { ignoreHours: true })]);
    return ok({ preview: previewRetailPayloads(await listProducts(), preview, { doordash: dd.allowed, uber_eats: ue.allowed }) });
  }
  return ok({ products: await listProducts(), platforms: Object.values(RETAIL_PLATFORMS) });
});

// save | delete | stock | import_csv | import_clover | push_clover
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  await requireFeature('retail');
  const b = await readJson(req);
  switch (b.action) {
    case 'save': {
      const prev = b.product?.id ? await getProduct(b.product.id) : null;
      if (prev && Number(b.product.price) !== prev.price) {
        const gate = await approvalGate(req, actor, 'menu.price', null, `price of ${prev.name}`);
        if (gate) return gate;
      }
      return ok({ product: await saveProduct(b.product ?? {}, actor) });
    }
    case 'delete':
      await deleteProduct(String(b.id ?? ''), actor);
      return ok({});
    case 'stock': {
      const loc = String(b.locationCode ?? '');
      if (!inScope(actor, loc)) return fail('Not your location.', 403);
      return ok({ product: await adjustStock(String(b.id ?? ''), loc, Number(b.delta) || 0, actor, String(b.reason ?? 'count').slice(0, 60)) });
    }
    case 'import_csv': {
      const loc = String(b.locationCode ?? '');
      const parsed = parseProductCsv(String(b.csv ?? ''), loc);
      if (b.dryRun) return ok({ ...parsed, products: parsed.products.length });
      const existing = await listProducts();
      const merged: RetailProduct[] = parsed.products.map((p) => {
        const prev = existing.find((x) => x.sku === p.sku);
        return cleanProduct({ ...p, ...(prev ? { stock: { ...prev.stock, ...(p.stock ?? {}) } } : {}) }, prev);
      }).filter((p) => productProblems(p).length === 0);
      await saveProductsBulk(merged);
      return ok({ saved: merged.length, errors: parsed.errors });
    }
    case 'import_clover':
      return ok(await importRetailFromClover({ merchantId: b.merchantId ? String(b.merchantId) : null, locationCode: b.locationCode ? String(b.locationCode) : null, all: b.all === true, actor }));
    case 'push_clover': {
      const p = await getProduct(String(b.id ?? ''));
      if (!p) return fail('Product not found.', 404);
      const r = await pushProductToClover(p, String(b.locationCode ?? ''), actor);
      return r.ok ? ok({ message: r.message }) : fail(r.message, 502);
    }
    default:
      return fail('Unknown action.');
  }
});
