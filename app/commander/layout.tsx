import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

// Public shell of the ordering pages ("Commander direct", proxy.ts lets /commander/ through without a sign-in): no
// console chrome, its own neutral light / dark tokens. Each brand page sets its accent colour (--sf-accent) from the
// public directory; everything else stays Food Hub / ON2GO neutral.
const TOKENS = `
.sf{--sf-bg:#f5f6f8;--sf-surface:#ffffff;--sf-sunken:#eef0f4;--sf-ink:#11151c;--sf-ink-2:#3b4350;--sf-ink-3:#5d6573;--sf-line:#e2e5eb;
--sf-accent:#1565d8;--sf-on-accent:#ffffff;--sf-ok:#137a46;--sf-ok-soft:#e5f5ec;--sf-warn:#8a5a00;--sf-warn-soft:#fdf3dc;--sf-shadow:0 1px 2px rgba(16,24,40,.06),0 4px 16px rgba(16,24,40,.06);
background:var(--sf-bg);color:var(--sf-ink);min-height:100dvh;-webkit-tap-highlight-color:transparent}
@media (prefers-color-scheme: dark){.sf{--sf-bg:#0d1117;--sf-surface:#151b23;--sf-sunken:#1c232d;--sf-ink:#eef1f5;--sf-ink-2:#c3cad4;--sf-ink-3:#97a1ae;--sf-line:#28313d;
--sf-ok:#5fd69a;--sf-ok-soft:#12291d;--sf-warn:#f2c46b;--sf-warn-soft:#2a2210;--sf-shadow:0 1px 2px rgba(0,0,0,.4)}}
.sf a{color:inherit}
.sf :focus-visible{outline:3px solid var(--sf-accent);outline-offset:2px}
.sf-accent-bg{background:var(--sf-accent);color:var(--sf-on-accent)}
.sf-card{background:var(--sf-surface);border:1px solid var(--sf-line);border-radius:14px;box-shadow:var(--sf-shadow)}
.sf-btn{min-height:48px;border-radius:12px;font-weight:800;padding:0 18px;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.sf-btn[disabled]{opacity:.45;cursor:not-allowed}
.sf-chip{min-height:40px;border-radius:999px;padding:0 14px;display:inline-flex;align-items:center;white-space:nowrap;border:1px solid var(--sf-line);background:var(--sf-surface);font-weight:700;font-size:14px}
.sf-input{width:100%;min-height:48px;border-radius:10px;border:1px solid var(--sf-line);background:var(--sf-surface);color:var(--sf-ink);padding:0 14px;font-size:16px}
.sf-muted{color:var(--sf-ink-3)}
.sf-noscroll{scrollbar-width:none}.sf-noscroll::-webkit-scrollbar{display:none}
`;

export default function CommanderLayout({ children }: { children: ReactNode }) {
  return (
    <div className="sf font-sans antialiased">
      <style dangerouslySetInnerHTML={{ __html: TOKENS }} />
      {children}
    </div>
  );
}
