import Link from "next/link";

const LABELS = [
  { symbol: "!!", name: "Brilliant", cls: "text-brilliant" },
  { symbol: "!", name: "Excellent", cls: "text-excellent" },
  { symbol: "!?", name: "Good", cls: "text-good" },
  { symbol: "?!", name: "Inaccuracy", cls: "text-inaccuracy" },
  { symbol: "?", name: "Mistake", cls: "text-mistake" },
  { symbol: "??", name: "Blunder", cls: "text-blunder" },
];

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-24">
      <div className="mx-auto max-w-xl text-center">
        {/* Logo */}
        <h1 className="animate-in mb-2 text-5xl font-bold tracking-tight text-foreground">
          Temper
        </h1>

        <p className="animate-slide-up delay-1 mb-10 text-base leading-relaxed text-muted-foreground">
          Game Review for your trading decisions. Upload a CSV, see
          every trade classified like a chess move, and track your
          discipline ELO over time.
        </p>

        {/* Decision label spectrum */}
        <div className="animate-slide-up delay-2 mb-12 flex items-center justify-center gap-5">
          {LABELS.map(({ symbol, name, cls }) => (
            <div key={cls} className="flex flex-col items-center gap-1">
              <span className={`font-mono text-sm font-semibold ${cls}`}>
                {symbol}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {name}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="animate-slide-up delay-3">
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-7 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Upload Trades
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>

        <p className="animate-slide-up delay-4 mt-6 text-xs text-muted-foreground">
          Accepts CSV &mdash; timestamp, symbol, side, qty, price, pnl
        </p>
      </div>

      {/* Minimal footer features */}
      <div className="animate-slide-up delay-5 mx-auto mt-24 grid max-w-lg grid-cols-3 gap-8 text-center">
        <Feature label="Temper Score" detail="0 – 100 per session" />
        <Feature label="Decision ELO" detail="Persistent skill rating" />
        <Feature label="Bias Detection" detail="Revenge, FOMO, tilt" />
      </div>
    </main>
  );
}

function Feature({ label, detail }: { label: string; detail: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
        {label}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}
