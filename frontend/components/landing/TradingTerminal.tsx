'use client';

import { useEffect, useRef, useMemo } from 'react';
import {
  createChart,
  ColorType,
  CandlestickData,
  Time,
  IChartApi,
  CandlestickSeries,
  HistogramSeries,
} from 'lightweight-charts';

/* ── deterministic PRNG (no Math.random) ── */
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* ── Generate realistic candle + volume data ── */
function generateData() {
  const rand = seededRandom(42);
  const candles: CandlestickData<Time>[] = [];
  const volumes: { time: Time; value: number; color: string }[] = [];

  let price = 186.5;
  const base = new Date('2025-06-02T09:30:00').getTime();

  for (let i = 0; i < 78; i++) {
    const t = Math.floor((base + i * 5 * 60_000) / 1000) as Time;
    const dir = rand() > 0.48 ? 1 : -1;
    const volatility = 0.15 + rand() * 0.6;
    const move = volatility * dir;

    const open = price;
    const close = +(price + move).toFixed(2);
    const high = +(Math.max(open, close) + rand() * 0.35).toFixed(2);
    const low = +(Math.min(open, close) - rand() * 0.35).toFixed(2);

    candles.push({ time: t, open, high, low, close });
    volumes.push({
      time: t,
      value: Math.floor(800 + rand() * 4200),
      color: close >= open ? 'rgba(6,214,160,0.25)' : 'rgba(239,71,111,0.25)',
    });
    price = close;
  }
  return { candles, volumes };
}

/* ── Fake order-book rows ── */
const BOOK_ASKS = [
  { price: '187.42', size: '1,240', total: '1,240' },
  { price: '187.38', size: '890', total: '2,130' },
  { price: '187.35', size: '2,100', total: '4,230' },
  { price: '187.31', size: '450', total: '4,680' },
  { price: '187.28', size: '3,320', total: '8,000' },
];
const BOOK_BIDS = [
  { price: '187.22', size: '2,670', total: '2,670' },
  { price: '187.18', size: '1,890', total: '4,560' },
  { price: '187.15', size: '940', total: '5,500' },
  { price: '187.11', size: '3,450', total: '8,950' },
  { price: '187.08', size: '1,120', total: '10,070' },
];

/* ── Fake positions ── */
const POSITIONS = [
  { sym: 'AAPL', side: 'LONG', qty: 200, entry: 186.42, current: 187.25, pnl: +166 },
  { sym: 'NVDA', side: 'SHORT', qty: 50, entry: 134.80, current: 135.12, pnl: -16 },
  { sym: 'MSFT', side: 'LONG', qty: 100, entry: 441.10, current: 442.35, pnl: +125 },
];

/* ── Fake recent trades feed ── */
const TAPE = [
  { time: '14:32:08', price: '187.25', size: '340', side: 'BUY' as const },
  { time: '14:32:05', price: '187.24', size: '120', side: 'SELL' as const },
  { time: '14:31:58', price: '187.26', size: '890', side: 'BUY' as const },
  { time: '14:31:52', price: '187.22', size: '200', side: 'SELL' as const },
  { time: '14:31:44', price: '187.24', size: '1,450', side: 'BUY' as const },
  { time: '14:31:37', price: '187.20', size: '560', side: 'SELL' as const },
];

export default function TradingTerminal() {
  const chartBox = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const data = useMemo(() => generateData(), []);

  useEffect(() => {
    if (!chartBox.current) return;
    const el = chartBox.current;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6b7280',
        fontFamily: 'Inter, ui-monospace, monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      width: el.clientWidth,
      height: el.clientHeight,
      crosshair: {
        vertLine: { color: 'rgba(6,214,160,0.35)', width: 1, style: 2 },
        horzLine: { color: 'rgba(6,214,160,0.35)', width: 1, style: 2 },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      handleScale: false,
      handleScroll: false,
    });
    chartApi.current = chart;

    const cs = chart.addSeries(CandlestickSeries, {
      upColor: '#06D6A0',
      downColor: '#EF476F',
      borderUpColor: '#06D6A0',
      borderDownColor: '#EF476F',
      wickUpColor: '#06D6A066',
      wickDownColor: '#EF476F66',
    });
    cs.setData(data.candles);

    const vs = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    vs.setData(data.volumes as never);

    chart.timeScale().fitContent();

    const onResize = () => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    return () => { ro.disconnect(); chart.remove(); };
  }, [data]);

  return (
    <div className="terminal-wrap relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a0f] font-mono text-[11px] text-gray-400 shadow-2xl shadow-black/60">
      {/* ── Title bar ── */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
          </div>
          <span className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">AAPL · 5m · NASDAQ</span>
        </div>
        <div className="flex items-center gap-4 text-[10px]">
          <span className="text-emerald-400 font-semibold">187.25</span>
          <span className="text-emerald-400/70">+0.44%</span>
          <span className="text-gray-600">Vol 2.4M</span>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">
        {/* Chart area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={chartBox} className="flex-1 min-h-0" />

          {/* Positions strip */}
          <div className="border-t border-white/[0.06] px-3 py-2">
            <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-gray-600">Open Positions</p>
            <div className="grid grid-cols-3 gap-2">
              {POSITIONS.map((p) => (
                <div key={p.sym} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                  <div>
                    <span className="font-semibold text-white text-[10px]">{p.sym}</span>
                    <span className={`ml-1.5 text-[9px] ${p.side === 'LONG' ? 'text-emerald-400/60' : 'text-red-400/60'}`}>{p.side}</span>
                  </div>
                  <span className={`font-semibold text-[10px] ${p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {p.pnl >= 0 ? '+' : ''}{p.pnl.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right sidebar — order book + tape */}
        <div className="hidden w-48 flex-shrink-0 flex-col border-l border-white/[0.06] lg:flex">
          {/* Order book */}
          <div className="flex-1 border-b border-white/[0.06] px-3 py-2 overflow-hidden">
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-gray-600">Order Book</p>
            <div className="space-y-px">
              {BOOK_ASKS.slice().reverse().map((r, i) => (
                <div key={`a${i}`} className="flex items-center justify-between">
                  <span className="text-red-400/80 text-[10px]">{r.price}</span>
                  <span className="text-[10px]">{r.size}</span>
                  <div className="h-[3px] rounded-full bg-red-400/20" style={{ width: `${(parseInt(r.total.replace(',', '')) / 10000) * 100}%`, minWidth: '4px', maxWidth: '52px' }} />
                </div>
              ))}
              {/* spread */}
              <div className="my-1 flex items-center justify-center gap-2">
                <div className="h-px flex-1 bg-white/[0.06]" />
                <span className="text-[9px] text-emerald-400/60 font-semibold">187.25</span>
                <div className="h-px flex-1 bg-white/[0.06]" />
              </div>
              {BOOK_BIDS.map((r, i) => (
                <div key={`b${i}`} className="flex items-center justify-between">
                  <span className="text-emerald-400/80 text-[10px]">{r.price}</span>
                  <span className="text-[10px]">{r.size}</span>
                  <div className="h-[3px] rounded-full bg-emerald-400/20" style={{ width: `${(parseInt(r.total.replace(',', '')) / 10070) * 100}%`, minWidth: '4px', maxWidth: '52px' }} />
                </div>
              ))}
            </div>
          </div>

          {/* Time & Sales */}
          <div className="px-3 py-2 overflow-hidden">
            <p className="mb-2 text-[9px] font-semibold uppercase tracking-widest text-gray-600">Time & Sales</p>
            <div className="space-y-0.5">
              {TAPE.map((t, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-gray-600 text-[10px]">{t.time}</span>
                  <span className={`text-[10px] ${t.side === 'BUY' ? 'text-emerald-400/70' : 'text-red-400/70'}`}>{t.price}</span>
                  <span className="text-[10px]">{t.size}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
