'use client';

import { useRef, useEffect, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import {
  ArrowUpRight,
  Search,
  Calendar,
  TrendingUp,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import { TRADER_PROFILES, TraderProfile } from '@/lib/biasDetector';

interface Session {
  id: string;
  date: string;
  time: string;
  score: number;
  pnl: string;
  pnlValue: number;
  trades: number;
  bias: string | null;
  profile: TraderProfile;
  duration: string;
}

const mockSessions: Session[] = [
  { id: 'calm-1', date: 'Today', time: '2:30 PM', score: 92, pnl: '+$485', pnlValue: 485, trades: 8, bias: null, profile: 'calm_trader', duration: '4h 12m' },
  { id: 'revenge-1', date: 'Today', time: '9:15 AM', score: 38, pnl: '-$1,245', pnlValue: -1245, trades: 24, bias: 'Revenge Trading', profile: 'revenge_trader', duration: '2h 30m' },
  { id: 'over-1', date: 'Yesterday', time: '10:00 AM', score: 52, pnl: '-$320', pnlValue: -320, trades: 47, bias: 'Overtrading', profile: 'overtrader', duration: '6h 45m' },
  { id: 'loss-1', date: 'Yesterday', time: '9:30 AM', score: 65, pnl: '+$95', pnlValue: 95, trades: 12, bias: 'Loss Aversion', profile: 'loss_averse_trader', duration: '3h 20m' },
  { id: 'calm-2', date: 'May 15', time: '11:00 AM', score: 88, pnl: '+$720', pnlValue: 720, trades: 6, bias: null, profile: 'calm_trader', duration: '2h 15m' },
  { id: 'revenge-2', date: 'May 14', time: '2:00 PM', score: 45, pnl: '-$890', pnlValue: -890, trades: 18, bias: 'Revenge Trading', profile: 'revenge_trader', duration: '1h 45m' },
  { id: 'calm-3', date: 'May 13', time: '9:30 AM', score: 95, pnl: '+$1,120', pnlValue: 1120, trades: 4, bias: null, profile: 'calm_trader', duration: '4h 00m' },
  { id: 'over-2', date: 'May 12', time: '10:15 AM', score: 48, pnl: '-$445', pnlValue: -445, trades: 52, bias: 'Overtrading', profile: 'overtrader', duration: '7h 30m' },
];

export default function SessionsPage() {
  const container = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<'all' | 'winners' | 'losers' | 'biased'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useGSAP(
    () => {
      if (!mounted) return;
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('.page-header', { y: 30, opacity: 0, duration: 0.6 })
        .from('.filter-bar', { y: 20, opacity: 0, duration: 0.5 }, '-=0.3')
        .from('.stats-row', { y: 20, opacity: 0, duration: 0.5 }, '-=0.3')
        .from('.session-card', { y: 30, opacity: 0, stagger: 0.06, duration: 0.4 }, '-=0.2');
    },
    { scope: container, dependencies: [mounted] },
  );

  const filteredSessions = mockSessions.filter((session) => {
    if (filter === 'winners' && session.pnlValue <= 0) return false;
    if (filter === 'losers' && session.pnlValue >= 0) return false;
    if (filter === 'biased' && !session.bias) return false;
    if (
      searchQuery &&
      !session.date.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !session.bias?.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  const totalPnL = mockSessions.reduce((s, x) => s + x.pnlValue, 0);
  const avgScore = Math.round(mockSessions.reduce((s, x) => s + x.score, 0) / mockSessions.length);
  const biasedCount = mockSessions.filter((s) => s.bias).length;

  return (
    <div
      ref={container}
      className="min-h-screen bg-[#0a0a0a] px-6 py-8 text-white md:px-10 md:py-10 lg:px-12"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <header className="page-header space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            History
          </p>
          <h1 className="font-coach text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Trading Sessions
          </h1>
          <p className="text-sm text-gray-500">
            Review your past sessions and identify patterns.
          </p>
        </header>

        {/* Stats Row */}
        <div className="stats-row grid grid-cols-3 gap-4">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Total P/L</p>
            <p className={`mt-1 text-xl font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPnL >= 0 ? '+' : ''}
              {totalPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Avg Discipline</p>
            <p className="mt-1 text-xl font-bold text-white">{avgScore}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Bias Events</p>
            <p className="mt-1 text-xl font-bold text-orange-400">{biasedCount}</p>
          </div>
        </div>

        {/* Filter */}
        <div className="filter-bar flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-gray-600 focus:border-emerald-400/40 focus:ring-1 focus:ring-emerald-400/30 sm:w-64"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'winners', 'losers', 'biased'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-all ${
                  filter === f
                    ? 'bg-emerald-500 text-black'
                    : 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {f === 'all' ? 'All' : f === 'winners' ? 'Winners' : f === 'losers' ? 'Losers' : 'Biased'}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 rounded-2xl bg-white/[0.04] p-6">
              <Calendar className="h-10 w-10 text-gray-600" />
            </div>
            <p className="text-sm text-gray-500">No sessions match your filters</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredSessions.map((session) => {
              const scoreColor =
                session.score >= 80
                  ? 'text-emerald-400 bg-emerald-400/10 ring-emerald-400/20'
                  : session.score >= 60
                    ? 'text-yellow-400 bg-yellow-400/10 ring-yellow-400/20'
                    : 'text-red-400 bg-red-400/10 ring-red-400/20';
              const pnlColor = session.pnlValue >= 0 ? 'text-emerald-400' : 'text-red-400';
              const profileColor = TRADER_PROFILES[session.profile].color;

              return (
                <Link
                  key={session.id}
                  href={`/dashboard/sessions/${session.id}`}
                  className="session-card group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.04] p-5 transition-all hover:bg-white/[0.06] hover:border-white/[0.10]"
                >
                  {/* Profile indicator */}
                  <div
                    className="absolute left-0 top-0 h-full w-1 rounded-r"
                    style={{ backgroundColor: profileColor }}
                  />

                  <div className="mb-4 flex items-start justify-between">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold ring-1 ${scoreColor}`}
                    >
                      {session.score}
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-gray-600 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">
                      {session.date} · {session.time}
                    </p>
                    <p className="text-xs text-gray-500">
                      {session.trades} trades · {session.duration}
                    </p>
                  </div>

                  {session.bias && (
                    <div className="mt-3 flex items-center gap-1.5">
                      <AlertTriangle className="h-3 w-3 text-orange-400" />
                      <span className="text-xs font-medium text-orange-400">{session.bias}</span>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-4">
                    <span className={`font-mono text-lg font-bold ${pnlColor}`}>
                      {session.pnl}
                    </span>
                    <span className="text-[10px] text-gray-600">
                      {TRADER_PROFILES[session.profile].name}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {filteredSessions.length > 0 && (
          <div className="flex justify-center pt-4">
            <button className="rounded-xl border border-white/[0.06] bg-white/[0.04] px-6 py-3 text-sm font-medium text-gray-500 transition-all hover:bg-white/[0.06] hover:text-white">
              Load more sessions
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
