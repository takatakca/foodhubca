'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Minus, PackagePlus, Plus, ScanBarcode, ShoppingBasket, Upload, Wine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Banner, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/card';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Drawer, Modal } from '@/components/ui/overlay';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useViewer } from '@/components/shell/viewer';
import type { RetailProduct } from '@/lib/foodhub/retail/catalog';
import { api, money } from '@/lib/ui/api';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/ui/cn';
import { MenuTabs } from '../menu-tabs';

type Platform = { platform: string; label: string; note: string; noteFr: string; steps: Array<{ fr: string; en: string }> };
const UNITS = ['each', 'kg', 'g', 'lb', 'oz', 'l', 'ml'] as const;

export default function RetailPage() {
  const { t, loc, lang } = useI18n();
  const { features, can, locations } = useViewer();
  const toast = useToast();
  const [products, setProducts] = useState<RetailProduct[] | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [location, setLocation] = useState(locations[0]?.code ?? '');
  const [edit, setEdit] = useState<Partial<RetailProduct> | null>(null);
  const [csv, setCsv] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState('');
  const scan = useRef<HTMLInputElement>(null);
  const on = features.includes('retail');
  const editor = can('menu:edit');

  const load = useCallback(() => api<{ products: RetailProduct[]; platforms: Platform[] }>('/api/foodhub/retail').then((d) => { setProducts(d.products); setPlatforms(d.platforms); }).catch((e) => toast.error(e instanceof Error ? e.message : String(e))), [toast]);
  useEffect(() => { if (on) load(); }, [load, on]);

  const categories = useMemo(() => [...new Set((products ?? []).map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'fr')), [products]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (products ?? []).filter((p) => (!cat || p.category === cat) && (!s || p.name.toLowerCase().includes(s) || (p.nameFr ?? '').toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.barcodes.some((b) => b.includes(s))));
  }, [products, q, cat]);

  async function post(action: string, json: Record<string, unknown>, okText?: string) {
    setBusy(action);
    try { const r = await api<Record<string, any>>('/api/foodhub/retail', { method: 'POST', json: { action, ...json } }); if (okText) toast.success(okText); await load(); return r; }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); return null; } finally { setBusy(''); }
  }

  /** A barcode scanner types the code then Enter: open that product, or a new one with the code filled in. */
  async function onScan(code: string) {
    const c = code.replace(/\s/g, '');
    if (!c) return;
    const r = await api<{ product: RetailProduct | null }>(`/api/foodhub/retail?barcode=${encodeURIComponent(c)}`).catch(() => ({ product: null }));
    if (r.product) setEdit(r.product);
    else if (editor) { toast.info(t('Code inconnu — nouveau produit', 'Unknown code — new product'), c); setEdit({ barcodes: [c], soldBy: 'unit', unit: 'each', trackStock: true, taxable: false, active: true, stock: {} }); }
    if (scan.current) scan.current.value = '';
  }

  if (!on) return <div><PageHeader eyebrow={t('Menus', 'Menus')} title={t('Épicerie et produits', 'Grocery & retail')} /><MenuTabs /><EmptyState icon={<ShoppingBasket className="size-6" />} title={t('Le catalogue épicerie est désactivé', 'The grocery catalogue is turned off')} body={t('Le propriétaire l’active dans Réglages → Expansion.', 'The owner turns it on in Settings → Expansion.')} action={can('admin') ? <ButtonLink href="/settings/expansion">{t('Ouvrir Expansion', 'Open Expansion')}</ButtonLink> : undefined} /></div>;

  return (
    <div>
      <PageHeader eyebrow={t('Menus', 'Menus')} title={t('Épicerie et produits', 'Grocery & retail')}
        subtitle={t('Produits emballés et au poids, avec code-barres, unités et inventaire par succursale — reliés aux articles Clover.', 'Packaged and by-weight products with barcodes, units and stock per location — linked to Clover items.')}
        right={editor ? <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" icon={<Download className="size-4" />} loading={busy === 'import_clover'} onClick={() => post('import_clover', { locationCode: location }).then((r) => r && toast.success(t('Importé de Clover', 'Imported from Clover'), `${r.added} ${t('nouveaux', 'new')} · ${r.updated} ${t('mis à jour', 'updated')}`))}>{t('Importer de Clover', 'Import from Clover')}</Button>
          <Button variant="outline" size="sm" icon={<Upload className="size-4" />} onClick={() => setCsv(true)}>CSV</Button>
          <Button size="sm" icon={<PackagePlus className="size-4" />} onClick={() => setEdit({ soldBy: 'unit', unit: 'each', trackStock: true, taxable: false, active: true, stock: {}, barcodes: [] })}>{t('Produit', 'Product')}</Button>
        </div> : undefined} />
      <MenuTabs />

      <Banner tone="info" className="mb-4" action={<Button size="xs" variant="ghost" onClick={() => setPreview(true)}>{t('Voir les envois prévus', 'See planned payloads')}</Button>}>
        {t('DoorDash Marketplace Retail et Uber Eats (épicerie) demandent l’approbation de chaque plateforme : rien n’est envoyé tant qu’elles n’ont pas approuvé.', 'DoorDash Marketplace Retail and Uber Eats (grocery) need each platform’s approval: nothing is sent until they approve.')}
      </Banner>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input ref={scan} className="pl-9" placeholder={t('Scanner ou taper un code-barres, puis Entrée', 'Scan or type a barcode, then Enter')} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan((e.target as HTMLInputElement).value); } }} />
        </div>
        <Input className="min-w-48 flex-1" placeholder={t('Chercher nom, SKU…', 'Search name, SKU…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-44"><option value="">{t('Toutes catégories', 'All categories')}</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <Select value={location} onChange={(e) => setLocation(e.target.value)} className="w-52" aria-label={t('Inventaire de', 'Stock at')}>{locations.map((l) => <option key={l.code} value={l.code}>{t('Inventaire', 'Stock')} · {l.name.split(' — ')[0]}</option>)}</Select>
      </div>

      <Card>
        {!products ? <div className="p-5"><Skeleton className="h-48" /></div> : !shown.length ? <EmptyState icon={<ShoppingBasket className="size-6" />} title={products.length ? t('Aucun produit trouvé', 'No product found') : t('Catalogue vide', 'Empty catalogue')} body={t('Importez les articles Clover qui ont un code-barres, un fichier CSV, ou scannez un produit.', 'Import the Clover items that have a barcode, a CSV file, or scan a product.')} /> : (
          <Table>
            <thead><tr><Th>{t('Produit', 'Product')}</Th><Th>SKU / {t('code', 'barcode')}</Th><Th>{t('Catégorie', 'Category')}</Th><Th align="right">{t('Prix', 'Price')}</Th><Th align="right">{t('Inventaire', 'Stock')}</Th>{editor && <Th />}</tr></thead>
            <tbody>
              {shown.map((p) => {
                const qty = p.stock[location];
                const low = p.trackStock && p.lowStockAt !== undefined && (qty ?? 0) <= p.lowStockAt;
                return (
                  <Tr key={p.id} className={cn(!p.active && 'opacity-50')}>
                    <Td><button type="button" className="text-left font-semibold hover:underline" onClick={() => setEdit(p)}>{lang === 'fr' && p.nameFr ? p.nameFr : p.name}</button>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-ink-3">{p.brand && <span>{p.brand}</span>}{p.size && <span>· {p.size}</span>}{p.alcohol && <Badge tone="violet" icon={<Wine className="size-3" />}>{p.alcohol.abv ?? '?'} %</Badge>}{p.posItemRef && <Badge tone="neutral">Clover</Badge>}{p.soldBy === 'weight' && <Badge tone="info">{t('au poids', 'by weight')}</Badge>}</div></Td>
                    <Td className="num text-xs"><div>{p.sku}</div><div className="text-ink-3">{p.barcodes[0] ?? '—'}</div></Td>
                    <Td className="text-sm">{p.category}</Td>
                    <Td align="right" className="num">{money(p.price, loc)}{p.unit !== 'each' ? <span className="text-xs text-ink-3"> / {p.unit}</span> : null}</Td>
                    <Td align="right" className={cn('num', low && 'font-bold text-stop', p.trackStock && !qty && 'text-wait-2')}>{p.trackStock ? (qty ?? 0) : '∞'}</Td>
                    {editor && <Td align="right">{p.trackStock && <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" aria-label="-1" disabled={busy === 'stock'} onClick={() => post('stock', { id: p.id, locationCode: location, delta: -1, reason: 'sale / loss' })}><Minus className="size-3.5" /></Button>
                      <Button size="xs" variant="ghost" aria-label="+1" disabled={busy === 'stock'} onClick={() => post('stock', { id: p.id, locationCode: location, delta: 1, reason: 'received' })}><Plus className="size-3.5" /></Button>
                    </div>}</Td>}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {edit && <ProductDrawer product={edit} location={location} editor={editor} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {csv && <CsvImport location={location} onClose={() => setCsv(false)} onDone={() => { setCsv(false); load(); }} />}
      {preview && <PlatformPreview location={location} platforms={platforms} onClose={() => setPreview(false)} />}
    </div>
  );
}

function ProductDrawer({ product, location, editor, onClose, onSaved }: { product: Partial<RetailProduct>; location: string; editor: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { locations } = useViewer();
  const toast = useToast();
  const [p, setP] = useState<Partial<RetailProduct>>(product);
  const [barcodes, setBarcodes] = useState((product.barcodes ?? []).join(', '));
  const [busy, setBusy] = useState('');
  const set = (patch: Partial<RetailProduct>) => setP((x) => ({ ...x, ...patch }));

  async function save() {
    setBusy('save');
    try {
      // Prices and counts typed with a French decimal comma ("3,49") become numbers.
      const num = (v: unknown) => Number(String(v ?? '').replace(',', '.')) || 0;
      const stock = Object.fromEntries(Object.entries(p.stock ?? {}).filter(([, v]) => String(v) !== '').map(([k, v]) => [k, num(v)]));
      await api('/api/foodhub/retail', { method: 'POST', json: { action: 'save', product: { ...p, price: num(p.price), stock, barcodes: barcodes.split(/[\s,;]+/).filter(Boolean) } } });
      toast.success(t('Produit enregistré', 'Product saved'), p.name);
      onSaved();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  async function pushClover() {
    setBusy('push');
    try { const r = await api<{ message: string }>('/api/foodhub/retail', { method: 'POST', json: { action: 'push_clover', id: p.id, locationCode: location } }); toast.success(r.message); }
    catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }

  return (
    <Drawer width="lg" onClose={onClose} title={p.id ? p.name : t('Nouveau produit', 'New product')} subtitle={p.posItemRef ? `Clover ${p.posItemRef}` : undefined}
      footer={editor ? <><Button variant="ghost" onClick={onClose}>{t('Fermer', 'Close')}</Button>{p.id && p.posItemRef && <Button variant="outline" loading={busy === 'push'} onClick={pushClover}>{t('Envoyer prix et inventaire à Clover', 'Send price & stock to Clover')}</Button>}<Button loading={busy === 'save'} disabled={!p.name || !p.sku} onClick={save}>{t('Enregistrer', 'Save')}</Button></> : undefined}>
      <fieldset disabled={!editor} className="grid gap-3">
        <div className="grid grid-cols-2 gap-3"><Field label={t('Nom (anglais)', 'Name (English)')}><Input value={p.name ?? ''} onChange={(e) => set({ name: e.target.value })} /></Field><Field label={t('Nom (français)', 'Name (French)')}><Input value={p.nameFr ?? ''} onChange={(e) => set({ nameFr: e.target.value })} /></Field></div>
        <div className="grid grid-cols-2 gap-3"><Field label="SKU"><Input value={p.sku ?? ''} onChange={(e) => set({ sku: e.target.value })} /></Field><Field label={t('Codes-barres (UPC / EAN / PLU)', 'Barcodes (UPC / EAN / PLU)')} hint={t('Le chiffre de contrôle est vérifié.', 'The check digit is verified.')}><Input value={barcodes} onChange={(e) => setBarcodes(e.target.value)} /></Field></div>
        <div className="grid grid-cols-3 gap-3"><Field label={t('Marque', 'Brand')}><Input value={p.brand ?? ''} onChange={(e) => set({ brand: e.target.value })} /></Field><Field label={t('Catégorie', 'Category')}><Input value={p.category ?? ''} onChange={(e) => set({ category: e.target.value })} placeholder="Épicerie" /></Field><Field label={t('Format', 'Size')}><Input value={p.size ?? ''} onChange={(e) => set({ size: e.target.value })} placeholder="500 g" /></Field></div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('Vendu', 'Sold')}><Select value={p.soldBy ?? 'unit'} onChange={(e) => set({ soldBy: e.target.value as 'unit' | 'weight', unit: e.target.value === 'weight' ? 'kg' : 'each' })}><option value="unit">{t('à l’unité', 'by the item')}</option><option value="weight">{t('au poids', 'by weight')}</option></Select></Field>
          <Field label={t('Unité', 'Unit')}><Select value={p.unit ?? 'each'} onChange={(e) => set({ unit: e.target.value as RetailProduct['unit'] })}>{UNITS.map((u) => <option key={u} value={u}>{u === 'each' ? t('unité', 'each') : u}</option>)}</Select></Field>
          <Field label={p.soldBy === 'weight' ? t(`Prix / ${p.unit ?? 'kg'}`, `Price / ${p.unit ?? 'kg'}`) : t('Prix', 'Price')}><Input inputMode="decimal" value={p.price ?? ''} onChange={(e) => set({ price: e.target.value as unknown as number })} /></Field>
        </div>
        <div className="rounded-md border border-line p-3">
          <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-semibold">{t('Inventaire par succursale', 'Stock per location')}</span><Checkbox checked={p.trackStock !== false} onChange={(v) => set({ trackStock: v })} label={t('Suivre l’inventaire', 'Track stock')} /></div>
          {p.trackStock !== false && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{locations.map((l) => <Field key={l.code} label={l.name.split(' — ')[0]}><Input inputMode="decimal" value={p.stock?.[l.code] ?? ''} onChange={(e) => set({ stock: { ...(p.stock ?? {}), [l.code]: e.target.value as unknown as number } })} /></Field>)}<Field label={t('Alerte stock bas à', 'Low stock at')}><Input inputMode="decimal" value={p.lowStockAt ?? ''} onChange={(e) => set({ lowStockAt: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field></div>}
        </div>
        <div className="rounded-md border border-line p-3">
          <Checkbox checked={Boolean(p.alcohol)} onChange={(v) => set({ alcohol: v ? { abv: 5 } : null })} label={t('Alcool (bière, vin, cidre…) — vendu seulement là où les règles d’alcool le permettent', 'Alcohol (beer, wine, cider…) — sold only where the alcohol rules allow it')} />
          {p.alcohol && <div className="mt-2 grid grid-cols-2 gap-3"><Field label={t('% alcool', '% alcohol')}><Input inputMode="decimal" value={p.alcohol.abv ?? ''} onChange={(e) => set({ alcohol: { ...p.alcohol, abv: Number(e.target.value.replace(',', '.')) || 0 } })} /></Field><Field label={t('Volume (ml)', 'Volume (ml)')}><Input inputMode="numeric" value={p.alcohol.volumeMl ?? ''} onChange={(e) => set({ alcohol: { ...p.alcohol, volumeMl: Number(e.target.value) || undefined } })} /></Field></div>}
        </div>
        <Field label={t('Description', 'Description')}><Textarea rows={2} value={p.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Field label={t('Photo (lien)', 'Photo (link)')} hint={t('DoorDash demande au moins 1400×800.', 'DoorDash asks for at least 1400×800.')}><Input value={p.imageUrl ?? ''} onChange={(e) => set({ imageUrl: e.target.value })} /></Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2"><Checkbox checked={p.taxable === true} onChange={(v) => set({ taxable: v })} label={t('Taxable (TPS + TVQ)', 'Taxable (GST + QST)')} /><Checkbox checked={p.active !== false} onChange={(v) => set({ active: v })} label={t('En vente', 'For sale')} /></div>
      </fieldset>
    </Drawer>
  );
}

function CsvImport({ location, onClose, onDone }: { location: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [text, setText] = useState('');
  const [check, setCheck] = useState<{ products: number; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api<{ products?: number; saved?: number; errors: string[] }>('/api/foodhub/retail', { method: 'POST', json: { action: 'import_csv', csv: text, locationCode: location, dryRun } });
      if (dryRun) setCheck({ products: r.products ?? 0, errors: r.errors });
      else { toast.success(t(`${r.saved} produit(s) importé(s)`, `${r.saved} product(s) imported`)); onDone(); }
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <Modal size="lg" title={t('Importer un fichier CSV', 'Import a CSV file')} subtitle={t('Colonnes : sku, code-barres, nom, nom_fr, marque, catégorie, prix, unité, format, stock, taxable, alcool (%).', 'Columns: sku, barcode, name, name_fr, brand, category, price, unit, size, stock, taxable, abv (%).')} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Annuler', 'Cancel')}</Button><Button variant="outline" loading={busy && !check} disabled={!text.trim()} onClick={() => run(true)}>{t('Vérifier', 'Check')}</Button><Button loading={busy && Boolean(check)} disabled={!check || !check.products} onClick={() => run(false)}>{t('Importer', 'Import')}</Button></>}>
      <input type="file" accept=".csv,text/csv" className="mb-3 text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); setCheck(null); } }} />
      <Textarea rows={8} value={text} onChange={(e) => { setText(e.target.value); setCheck(null); }} placeholder={'sku;code-barres;nom;prix;unité;stock\nB1;036000291452;Bière blonde;3,49;each;24'} className="font-mono text-xs" />
      {check && <div className="mt-3 space-y-2"><Banner tone={check.errors.length ? 'warn' : 'go'}>{t(`${check.products} produit(s) prêts`, `${check.products} product(s) ready`)}{check.errors.length ? ` · ${check.errors.length} ${t('ligne(s) refusée(s)', 'row(s) refused')}` : ''}</Banner>{check.errors.slice(0, 8).map((e) => <div key={e} className="text-xs text-stop-2">{e}</div>)}</div>}
    </Modal>
  );
}

function PlatformPreview({ location, platforms, onClose }: { location: string; platforms: Platform[]; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<Record<string, any> | null>(null);
  useEffect(() => { api<{ preview: Record<string, any> }>(`/api/foodhub/retail?preview=${encodeURIComponent(location)}`).then((d) => setData(d.preview)).catch(() => undefined); }, [location]);
  return (
    <Modal size="xl" title={t('Envois prévus aux plateformes', 'Planned platform payloads')} subtitle={t('Aperçu seulement — rien n’est envoyé avant l’approbation de la plateforme.', 'Preview only — nothing is sent before the platform approves.')} onClose={onClose}>
      <div className="grid gap-4 lg:grid-cols-2">
        {platforms.map((p) => (
          <div key={p.platform} className="rounded-lg border border-line p-4">
            <div className="flex items-center justify-between gap-2"><h3 className="font-extrabold">{p.label}</h3><Badge tone="wait">{t('Approbation requise', 'Needs approval')}</Badge></div>
            <p className="mt-1 text-[13px] text-ink-3">{lang === 'fr' ? p.noteFr : p.note}</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px]">{p.steps.map((s, i) => <li key={i}>{lang === 'fr' ? s.fr : s.en}</li>)}</ol>
            {data?.[p.platform] && <>
              {data[p.platform].leftOut > 0 && <p className="mt-2 text-xs text-wait-2">{t(`${data[p.platform].leftOut} produit(s) laissé(s) de côté (inactifs ou alcool non permis).`, `${data[p.platform].leftOut} product(s) left out (inactive or alcohol not allowed).`)}</p>}
              <pre className="scrollbar-thin mt-2 max-h-72 overflow-auto rounded-md bg-ink p-3 text-[11px] leading-relaxed text-canvas">{JSON.stringify(data[p.platform].items.slice(0, 3), null, 2)}</pre>
            </>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
