'use client';

import { useRef, useEffect, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import {
  ArrowUpRight,
  Search,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import { TRADER_PROFILES, TraderProfile, Trade, analyzeSession } from '@/lib/biasDetector';
import { fetchUserJobs, getUserId } from '@/lib/backend-bridge';
import { loadCachedSessionTrades } from '@/lib/session-cache';

interface Session {
  id: string;
  title: string;
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

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours}h ${mins}m`;
}

function formatDateTime(timestamp: string): { date: string; time: string } {
  try {
    const dt = new Date(timestamp.replace(' ', 'T'));
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tradeDate = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());

    let dateStr: string;
    if (tradeDate.getTime() === today.getTime()) {
      dateStr = 'Today';
    } else if (tradeDate.getTime() === yesterday.getTime()) {
      dateStr = 'Yesterday';
    } else {
      dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    const timeStr = dt.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    return { date: dateStr, time: timeStr };
  } catch {
    return { date: 'Unknown', time: '' };
  }
}

export default function SessionsPage() {
  const container = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<'all' | 'winners' | 'losers' | 'biased'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [mounted, setMounted] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    let cancelled = false;
    setMounted(true);

    const load = async () => {
      try {
        const rows = await fetchUserJobs(getUserId());
        if (cancelled) return;
        if (rows.length > 0) {
          const mapped: Session[] = rows.map((row, idx) => {
            const jobId = String(row.job_id || row.id || `session-${idx + 1}`);
            const createdAt = String(row.created_at || '');
            const { date, time } = formatDateTime(createdAt || new Date().toISOString());
            const biasRates = (row.bias_rates && typeof row.bias_rates === 'object') ? (row.bias_rates as Record<string, number>) : {};
            const anyBiasRate = Number(biasRates.any_bias_rate || 0);
            const score = Math.max(0, Math.min(100, Math.round((1 - anyBiasRate) * 100)));
            const deltaPnl = Number(row.delta_pnl || 0);
            const badgeCounts = (row.badge_counts && typeof row.badge_counts === 'object') ? (row.badge_counts as Record<string, number>) : {};
            const totalTrades = Object.values(badgeCounts).reduce((sum, value) => sum + (Number(value) || 0), 0);

            const revenge = Number(biasRates.revenge_rate || 0);
            const overtrading = Number(biasRates.overtrading_rate || 0);
            const lossAversion = Number(biasRates.loss_aversion_rate || 0);
            const dominant = Math.max(revenge, overtrading, lossAversion);

            let bias: string | null = null;
            let profile: TraderProfile = 'calm_trader';
            if (dominant > 0) {
              if (dominant === revenge) {
                bias = 'Revenge Trading';
                profile = 'revenge_trader';
              } else if (dominant === overtrading) {
                bias = 'Overtrading';
                profile = 'overtrader';
              } else {
                bias = 'Loss Aversion';
                profile = 'loss_averse_trader';
              }
            }

            return {
              id: jobId,
              title: `Session ${rows.length - idx}`,
              date,
              time,
              score,
              pnl: `${deltaPnl >= 0 ? '+' : '-'}$${Math.abs(deltaPnl).toFixed(0)}`,
              pnlValue: deltaPnl,
              trades: totalTrades,
              bias,
              profile,
              duration: 'n/a',
            };
          });
          setSessions(mapped);
          return;
        }
      } catch (err) {
        console.error('Failed to load backend sessions:', err);
      }

      // Fallback: local session
      const trades = loadCachedSessionTrades();
      if (!trades || cancelled) return;
      if (trades.length > 0) {
        const analysis = analyzeSession(trades);
        const firstTrade = trades[0];
        const { date, time } = formatDateTime(firstTrade.timestamp);
        const title = localStorage.getItem('temper_session_title') || 'Session 1';

        let profile: TraderProfile = 'calm_trader';
        if (analysis.biases.length > 0) {
          const primaryBias = analysis.biases[0].type;
          if (primaryBias === 'REVENGE_TRADING') profile = 'revenge_trader';
          else if (primaryBias === 'OVERTRADING') profile = 'overtrader';
          else if (primaryBias === 'LOSS_AVERSION') profile = 'loss_averse_trader';
        }

        const session: Session = {
          id: 'session-1',
          title,
          date,
          time,
          score: Math.round(analysis.disciplineScore),
          pnl: analysis.summary.totalPnL >= 0
            ? `+$${Math.abs(analysis.summary.totalPnL).toFixed(0)}`
            : `-$${Math.abs(analysis.summary.totalPnL).toFixed(0)}`,
          pnlValue: analysis.summary.totalPnL,
          trades: analysis.summary.totalTrades,
          bias: analysis.biases.length > 0
            ? analysis.biases[0].type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
            : null,
          profile,
          duration: formatDuration(analysis.summary.tradingDuration),
        };
        setSessions([session]);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useGSAP(
    () => {
      if (!mounted) return;
      gsap.set(['.page-header', '.filter-bar', '.stats-row', '.session-card'], { clearProps: 'all' });
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.page-header', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6 })
        .fromTo('.filter-bar', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3')
        .fromTo('.stats-row', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3')
        .fromTo('.session-card', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, stagger: 0.06, duration: 0.4 }, '-=0.2');
    },
    { scope: container, dependencies: [mounted] },
  );

  const filteredSessions = sessions.filter((session) => {
    if (filter === 'winners' && session.pnlValue <= 0) return false;
    if (filter === 'losers' && session.pnlValue >= 0) return false;
    if (filter === 'biased' && !session.bias) return false;
    if (
      searchQuery &&
      !session.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !session.date.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !session.bias?.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  const totalPnL = sessions.reduce((s, x) => s + x.pnlValue, 0);
  const avgScore = sessions.length > 0 
    ? Math.round(sessions.reduce((s, x) => s + x.score, 0) / sessions.length)
    : 0;
  const biasedCount = sessions.filter((s) => s.bias).length;

  return (
    <div
      ref={container}
      className="h-full overflow-y-auto overflow-x-hidden bg-[#0a0a0a] px-6 py-8 text-white md:px-10 md:py-10 lg:px-12"
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
          <p className="text-sm text-gray-400">
            Review your past sessions and identify patterns.
          </p>
        </header>

        {/* Stats Row */}
        <div className="stats-row grid grid-cols-3 gap-4">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.06] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Total P/L</p>
            <p className={`mt-1 text-xl font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPnL >= 0 ? '+' : ''}
              {totalPnL.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.06] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Avg Discipline</p>
            <p className="mt-1 text-xl font-bold text-white">{avgScore}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.06] p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Bias Events</p>
            <p className="mt-1 text-xl font-bold text-orange-400">{biasedCount}</p>
          </div>
        </div>

        {/* Filter */}
        <div className="filter-bar flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.06] py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-gray-500 focus:border-emerald-400/40 focus:ring-1 focus:ring-emerald-400/30 sm:w-64"
            />
          </div>
          <div className="flex gap-2">
            {(['all', 'winners', 'losers', 'biased'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`cursor-pointer rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-all ${
                  filter === f
                    ? 'bg-emerald-500 text-black'
                    : 'bg-white/[0.06] text-gray-400 hover:bg-white/[0.08] hover:text-white'
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
            <div className="mb-4 rounded-2xl bg-white/[0.06] p-6">
              <Calendar className="h-10 w-10 text-gray-500" />
            </div>
            <p className="text-sm text-gray-400">No sessions match your filters</p>
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
                  className="session-card group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] p-5 transition-all hover:bg-white/[0.08] hover:border-white/[0.12] cursor-pointer"
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
                    <ArrowUpRight className="h-4 w-4 text-gray-500 opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">
                      {session.title}
                    </p>
                    <p className="text-xs text-gray-400">
                      {session.date} · {session.time}
                    </p>
                    <p className="text-xs text-gray-400">
                      {session.trades} trades · {session.duration}
                    </p>
                  </div>

                  {session.bias && (
                    <div className="mt-3 flex items-center gap-1.5">
                      <AlertTriangle className="h-3 w-3 text-orange-400" />
                      <span className="text-xs font-medium text-orange-400">{session.bias}</span>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between border-t border-white/[0.08] pt-4">
                    <span className={`font-mono text-lg font-bold ${pnlColor}`}>
                      {session.pnl}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {TRADER_PROFILES[session.profile].name}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
