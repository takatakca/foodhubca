// ON2GO storefront: page metadata, JSON-LD (Restaurant + Menu + OrderAction), no hours when unknown, overnight slots
// joined, no round-the-clock wording, sitemap of live pages only, and the page texts' wording rules.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allDayWeek } from '../lib/foodhub/hours';
import { buildPublicMenu } from '../lib/foodhub/storefront/catalog';
import { SF_TEXT } from '../lib/foodhub/storefront/i18n';
import { jsonLdScript, openingHoursSpec, sitemapXml, storefrontJsonLd, storefrontMetadata } from '../lib/foodhub/storefront/seo';
import type { HoursConfig } from '../lib/foodhub/types';
import { BRAND, LOC, SLUG, at, everyDay, fixtureMenu } from './helpers/storefront-fixture';

const HOURS: HoursConfig = { locations: { [LOC]: everyDay('16:00', '03:00') }, brands: {}, holidays: [] };
const menu = () => buildPublicMenu({ slug: SLUG, brandName: BRAND, cfg: { enabled: true, slug: SLUG, locationCode: LOC, payOnline: false, payAtPickup: true, pickupMaxTotal: 150 }, brandActive: true, menu: fixtureMenu(), hours: HOURS, stores: [], location: null, now: at(18) }).menu;

beforeEach(() => { process.env.FOODHUB_PUBLIC_URL = 'https://hub.example.test'; process.env.FOODHUB_PUBLIC_PHONE = '+15145550100'; });
afterEach(() => { delete process.env.FOODHUB_PUBLIC_URL; delete process.env.FOODHUB_PUBLIC_PHONE; });

describe('JSON-LD', () => {
  it('Restaurant with address, geo, phone, cuisine, hours, Menu > MenuSection > MenuItem offers in CAD, OrderAction', () => {
    const ld = storefrontJsonLd(menu(), { hours: HOURS, brandName: BRAND, locationCode: LOC }) as any;
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Restaurant');
    expect(ld.name).toBe('Pi Pita');
    expect(ld.url).toBe('https://hub.example.test/commander/pi-pita');
    expect(ld.address).toMatchObject({ '@type': 'PostalAddress', streetAddress: '6280 Av Somerled', addressRegion: 'QC', addressCountry: 'CA' });
    expect(ld.geo['@type']).toBe('GeoCoordinates');
    expect(ld.telephone).toBe('+15145550100');
    expect(ld.servesCuisine.length).toBeGreaterThan(0);
    expect(ld.image).toBe('https://hub.example.test/media/pita.jpg');
    expect(ld.hasMenu['@type']).toBe('Menu');
    const section = ld.hasMenu.hasMenuSection[0];
    expect(section['@type']).toBe('MenuSection');
    expect(section.name).toBe('Plats');
    expect(section.hasMenuItem[0]).toMatchObject({ '@type': 'MenuItem', name: 'Pita au poulet', offers: { '@type': 'Offer', price: '12.50', priceCurrency: 'CAD' } });
    expect(ld.potentialAction).toMatchObject({ '@type': 'OrderAction', target: { '@type': 'EntryPoint', urlTemplate: 'https://hub.example.test/commander/pi-pita?src=google' } });
    // Overnight hours joined back into one slot; 7 days.
    expect(ld.openingHoursSpecification).toHaveLength(7);
    expect(ld.openingHoursSpecification[0]).toEqual({ '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '16:00', closes: '03:00' });
    const text = JSON.stringify(ld);
    for (const secret of ['CLV-', 'MID-FIXTURE', 'operator only note', 'Beer', 'Bière']) expect(text).not.toContain(secret);
  });

  it('no opening hours when unknown, and never a whole-day schedule', () => {
    const none = storefrontJsonLd(menu(), { hours: { locations: {}, brands: {}, holidays: [] }, brandName: BRAND, locationCode: LOC }) as any;
    expect(none.openingHoursSpecification).toBeUndefined();
    const allDay = storefrontJsonLd(menu(), { hours: { locations: { [LOC]: allDayWeek() }, brands: {}, holidays: [] }, brandName: BRAND, locationCode: LOC }) as any;
    expect(allDay.openingHoursSpecification).toBeUndefined();
    expect(openingHoursSpec(everyDay('11:00', '22:00'))[2]).toEqual({ '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Wednesday', opens: '11:00', closes: '22:00' });
    delete process.env.FOODHUB_PUBLIC_PHONE;
    expect((storefrontJsonLd(menu(), { hours: HOURS, brandName: BRAND, locationCode: LOC }) as any).telephone).toBeUndefined();
  });

  it('the script text can never close its tag', () => {
    expect(jsonLdScript({ name: '</script><b>' })).not.toContain('</script>');
  });
});

describe('metadata and sitemap', () => {
  it('title "<Brand>: Commander en ligne", canonical, fr/en alternates, OpenGraph and Twitter with the first photo', () => {
    const fr = storefrontMetadata(menu(), 'fr');
    expect(fr.title).toBe('Pi Pita: Commander en ligne');
    expect(fr.alternates?.canonical).toBe('https://hub.example.test/commander/pi-pita');
    expect(fr.alternates?.languages).toMatchObject({ 'fr-CA': 'https://hub.example.test/commander/pi-pita', 'en-CA': 'https://hub.example.test/commander/pi-pita?lang=en' });
    expect((fr.openGraph as any).images[0].url).toBe('https://hub.example.test/media/pita.jpg');
    expect((fr.twitter as any).card).toBe('summary_large_image');
    expect(storefrontMetadata(menu(), 'en').title).toBe('Pi Pita: Order online');
  });

  it('sitemap lists the given live pages with their English alternate', () => {
    const xml = sitemapXml([{ slug: 'pi-pita', lastmod: '2026-10-16' }]);
    expect(xml).toContain('<loc>https://hub.example.test/commander/pi-pita</loc>');
    expect(xml).toContain('hreflang="en-CA" href="https://hub.example.test/commander/pi-pita?lang=en"');
    expect(sitemapXml([])).not.toContain('<url>');
  });
});

describe('wording rules', () => {
  it('no round-the-clock, "virtual" or "ghost" wording, and no delivery-platform names in the page texts', () => {
    const all = JSON.stringify(SF_TEXT, (_k, v) => (typeof v === 'function' ? v('X', 'Y') : v)) + JSON.stringify(storefrontMetadata(menu(), 'fr')) + JSON.stringify(storefrontJsonLd(menu(), { hours: HOURS, brandName: BRAND, locationCode: LOC }));
    expect(all).not.toMatch(/\b24\s?h\b|24\/7|24 heures|virtuel|virtual|fantôme|ghost/i);
    expect(all).not.toMatch(/doordash|uber|skip|too good to go/i);
  });
});
