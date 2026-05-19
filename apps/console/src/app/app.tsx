import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';

import { CatalogView } from '../views/Catalog';
import { LiveView } from '../views/Live';
import { TraceView } from '../views/Trace';

export function App() {
  return (
    <div className="relative min-h-screen">
      <SideRail />
      <div className="pl-16">
        <TopStrip />
        <main className="mx-auto max-w-[1320px] px-8 pt-8 pb-24">
          <Routes>
            <Route path="/" element={<TraceView />} />
            <Route path="/catalog" element={<CatalogView />} />
            <Route path="/live" element={<LiveView />} />
          </Routes>
        </main>
        <FooterMark />
      </div>
    </div>
  );
}

export default App;

/* ---------- side rail ---------- */

function SideRail() {
  return (
    <aside
      aria-label="primary"
      className="fixed inset-y-0 left-0 z-20 flex w-16 flex-col items-center justify-between border-r border-line bg-ink-1/80 py-5 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-6">
        {/* Monogram — also satisfies the "Prose Console" accessible-name link */}
        <Link
          to="/"
          aria-label="Prose Console"
          className="group flex h-9 w-9 items-center justify-center rounded-[2px] border border-line-2 bg-ink-2 transition-colors hover:border-signal/60"
        >
          <span className="monogram text-fg-strong text-[20px] leading-none transition-colors group-hover:text-signal">
            p
          </span>
        </Link>

        <span className="my-1 h-6 w-px bg-line" aria-hidden="true" />

        <nav className="flex flex-col items-center gap-1.5">
          <RailLink to="/" label="trace" glyph="T" />
          <RailLink to="/catalog" label="catalog" glyph="C" />
          <RailLink to="/live" label="live" glyph="L" />
        </nav>
      </div>

      <StreamStatus />
    </aside>
  );
}

function RailLink({
  to,
  label,
  glyph,
}: {
  to: string;
  label: string;
  glyph: string;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      aria-label={label}
      className={({ isActive }) =>
        [
          'group relative flex h-9 w-9 items-center justify-center rounded-[2px] border transition-colors',
          isActive
            ? 'border-signal/60 bg-signal/10 text-signal'
            : 'border-transparent text-mute-2 hover:border-line-2 hover:text-fg',
        ].join(' ')
      }
    >
      <span
        className="font-display text-[16px] leading-none font-bold"
        style={{ fontVariationSettings: "'opsz' 24" }}
      >
        {glyph}
      </span>
      <span
        className="caps absolute top-1/2 left-12 -translate-y-1/2 rounded-sm border border-line-2 bg-ink-2 px-2 py-1 text-[9px] text-fg opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
        aria-hidden="true"
      >
        {label}
      </span>
    </NavLink>
  );
}

/* ---------- top instrument strip ---------- */

function TopStrip() {
  const location = useLocation();
  const segment = sectionFor(location.pathname);
  return (
    <header
      className="hairline-b sticky top-0 z-10 flex items-center gap-6 bg-ink-0/85 px-8 py-3 backdrop-blur-md"
      role="banner"
    >
      <div className="flex items-baseline gap-3">
        <span className="caps text-mute">Section</span>
        <span className="caps-tight text-fg-strong">{segment.title}</span>
      </div>

      <span className="text-line-3" aria-hidden="true">
        /
      </span>

      <div className="flex items-baseline gap-3">
        <span className="caps text-mute">Scope</span>
        <span className="font-mono text-[11px] text-fg">
          observer<span className="text-mute">@</span>local
        </span>
      </div>

      <div className="ml-auto flex items-center gap-5">
        <Clock />
        <span className="text-line-3" aria-hidden="true">
          /
        </span>
        <div className="flex items-center gap-2">
          <span className="dot dot-signal animate-pulse-signal" />
          <span className="caps text-signal">live</span>
        </div>
      </div>
    </header>
  );
}

function sectionFor(path: string): { title: string; key: string } {
  if (path.startsWith('/catalog')) return { title: 'Catalog', key: 'catalog' };
  if (path.startsWith('/live')) return { title: 'Live tail', key: 'live' };
  return { title: 'Execution trace', key: 'trace' };
}

function Clock() {
  const [t, setT] = useState<string>(() => fmtClock(new Date()));
  useEffect(() => {
    const id = setInterval(() => setT(fmtClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="num text-[11px] tracking-wider text-mute-2"
      aria-label="clock"
    >
      {t}
    </span>
  );
}

function fmtClock(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(
    d.getUTCSeconds()
  )} utc`;
}

/* ---------- stream pip in the rail ---------- */

function StreamStatus() {
  // Visual-only indicator; the actual SSE/WS connection lives in the Live view.
  return (
    <div
      className="flex flex-col items-center gap-2 pb-1"
      aria-hidden="true"
      title="stream"
    >
      <span className="dot dot-mint animate-pulse-signal" />
      <span className="caps text-[8px] text-mute">ok</span>
    </div>
  );
}

/* ---------- foot mark ---------- */

function FooterMark() {
  return (
    <footer className="pointer-events-none fixed right-6 bottom-4 z-10 hidden items-center gap-2 text-[10px] text-mute md:flex">
      <span className="caps">v0.0.1</span>
      <span className="text-line-3">·</span>
      <span className="font-display text-[12px] font-semibold tracking-tight text-fg/70">
        prose
      </span>
    </footer>
  );
}
