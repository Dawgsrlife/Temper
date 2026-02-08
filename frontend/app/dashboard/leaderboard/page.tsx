'use client';

import { useRef, useEffect, useState, useMemo } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  Trophy,
  Crown,
  Medal,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronUp,
  Flame,
  Shield,
  Star,
  Swords,
  Target,
  Zap,
} from 'lucide-react';
import { getRatingBracket, DEFAULT_ELO_STATE, type RatingBracket } from '@/lib/ratings/elo';
import type { DecisionEloState } from '@/lib/types';

// ── Bracket styling ──────────────────────────────────────────

const BRACKET_CONFIG: Record<RatingBracket, { color: string; bg: string; border: string; glow: string; icon: typeof Star }> = {
  Beginner:     { color: 'text-gray-400',    bg: 'bg-gray-500/10',    border: 'border-gray-500/20',    glow: 'shadow-gray-500/10',    icon: Shield },
  Novice:       { color: 'text-zinc-300',     bg: 'bg-zinc-400/10',    border: 'border-zinc-400/20',    glow: 'shadow-zinc-400/10',    icon: Shield },
  Developing:   { color: 'text-amber-400',    bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   glow: 'shadow-amber-500/10',   icon: Target },
  Intermediate: { color: 'text-yellow-400',   bg: 'bg-yellow-500/10',  border: 'border-yellow-500/20',  glow: 'shadow-yellow-500/10',  icon: Swords },
  Proficient:   { color: 'text-emerald-400',  bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', glow: 'shadow-emerald-500/10', icon: Zap },
  Advanced:     { color: 'text-cyan-400',     bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    glow: 'shadow-cyan-500/10',    icon: Flame },
  Expert:       { color: 'text-blue-400',     bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    glow: 'shadow-blue-500/10',    icon: Star },
  Master:       { color: 'text-purple-400',   bg: 'bg-purple-500/10',  border: 'border-purple-500/20',  glow: 'shadow-purple-500/10',  icon: Crown },
  Grandmaster:  { color: 'text-amber-300',    bg: 'bg-amber-400/10',   border: 'border-amber-400/20',   glow: 'shadow-amber-400/20',   icon: Crown },
};

// ── Mock leaderboard ─────────────────────────────────────────

interface LeaderboardEntry {
  rank: number;
  name: string;
  rating: number;
  bracket: RatingBracket;
  delta: number;
  sessions: number;
  winRate: number;
  streak: number;
  isUser?: boolean;
  avatar: string;
}

const MOCK_TRADERS: Omit<LeaderboardEntry, 'rank' | 'bracket'>[] = [
  { name: 'IcyVein',          rating: 2280, delta: +18.4, sessions: 127, winRate: 78, streak: 12, avatar: 'IV' },
  { name: 'ZenTrader',        rating: 2145, delta: +12.1, sessions: 98,  winRate: 74, streak: 8,  avatar: 'ZT' },
  { name: 'SteadyEddie',      rating: 2032, delta: -4.2,  sessions: 156, winRate: 71, streak: 3,  avatar: 'SE' },
  { name: 'PatienceKing',     rating: 1964, delta: +22.7, sessions: 89,  winRate: 69, streak: 6,  avatar: 'PK' },
  { name: 'CalmCapital',      rating: 1891, delta: +8.3,  sessions: 112, winRate: 67, streak: 4,  avatar: 'CC' },
  { name: 'DisciplinedDan',   rating: 1847, delta: -11.5, sessions: 73,  winRate: 65, streak: 0,  avatar: 'DD' },
  { name: 'MindfulMike',      rating: 1756, delta: +5.8,  sessions: 64,  winRate: 63, streak: 5,  avatar: 'MM' },
  { name: 'StratSam',         rating: 1688, delta: +14.2, sessions: 45,  winRate: 61, streak: 7,  avatar: 'SS' },
  { name: 'CoolCurator',      rating: 1623, delta: -2.9,  sessions: 88,  winRate: 60, streak: 2,  avatar: 'CU' },
  { name: 'RiskBalancer',     rating: 1534, delta: +9.6,  sessions: 51,  winRate: 58, streak: 3,  avatar: 'RB' },
  { name: 'ComposedTrader',   rating: 1467, delta: -7.1,  sessions: 94,  winRate: 56, streak: 0,  avatar: 'CT' },
  { name: 'FocusFlow',        rating: 1389, delta: +3.4,  sessions: 37,  winRate: 55, streak: 2,  avatar: 'FF' },
  { name: 'QuietMoves',       rating: 1312, delta: +16.8, sessions: 28,  winRate: 53, streak: 4,  avatar: 'QM' },
  { name: 'LevelHead',        rating: 1245, delta: -1.3,  sessions: 19,  winRate: 52, streak: 1,  avatar: 'LH' },
  { name: 'GreenField',       rating: 1134, delta: +6.2,  sessions: 12,  winRate: 50, streak: 2,  avatar: 'GF' },
  { name: 'NewNerves',        rating: 1023, delta: -15.4, sessions: 8,   winRate: 44, streak: 0,  avatar: 'NN' },
  { name: 'FreshStart',       rating: 914,  delta: +2.1,  sessions: 3,   winRate: 42, streak: 1,  avatar: 'FS' },
  { name: 'DayOneTrader',     rating: 843,  delta: -8.7,  sessions: 5,   winRate: 38, streak: 0,  avatar: 'DO' },
];

// ── Helpers ──────────────────────────────────────────────────

function getAvatarGradient(rank: number, isUser: boolean): string {
  if (isUser) return 'from-emerald-500 to-cyan-400';
  if (rank === 1) return 'from-amber-300 to-yellow-500';
  if (rank === 2) return 'from-gray-300 to-gray-400';
  if (rank === 3) return 'from-amber-600 to-amber-700';
  return 'from-gray-600 to-gray-700';
}

function getRankIcon(rank: number) {
  if (rank === 1) return <Crown className="h-4 w-4 text-amber-300" />;
  if (rank === 2) return <Medal className="h-4 w-4 text-gray-300" />;
  if (rank === 3) return <Medal className="h-4 w-4 text-amber-600" />;
  return null;
}

// ── Component ────────────────────────────────────────────────

export default function LeaderboardPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [userElo, setUserElo] = useState<DecisionEloState>(DEFAULT_ELO_STATE);

  // Load user ELO from localStorage
  useEffect(() => {
    setMounted(true);
    try {
      const raw = localStorage.getItem('temper_elo_state');
      if (raw) {
        const parsed = JSON.parse(raw) as DecisionEloState;
        setUserElo(parsed);
      }
    } catch {
      // use default
    }
  }, []);

  // Build sorted leaderboard with user inserted
  const leaderboard = useMemo<LeaderboardEntry[]>(() => {
    const userEntry: Omit<LeaderboardEntry, 'rank' | 'bracket'> = {
      name: 'You',
      rating: userElo.rating,
      delta: userElo.lastSessionDelta,
      sessions: userElo.sessionsPlayed,
      winRate: userElo.sessionsPlayed > 0
        ? Math.round((userElo.lastSessionPerformance) * 100)
        : 50,
      streak: userElo.history.filter((h, i, arr) => {
        if (i === 0) return h.delta > 0;
        return h.delta > 0 && arr.slice(Math.max(0, i - 3), i).every(e => e.delta > 0);
      }).length,
      isUser: true,
      avatar: 'AT',
    };

    const all = [...MOCK_TRADERS, userEntry]
      .sort((a, b) => b.rating - a.rating)
      .map((entry, i) => ({
        ...entry,
        rank: i + 1,
        bracket: getRatingBracket(entry.rating),
      }));

    return all;
  }, [userElo]);

  const userRow = leaderboard.find(e => e.isUser);
  const userBracket = userRow ? BRACKET_CONFIG[userRow.bracket] : BRACKET_CONFIG.Developing;
  const userRank = userRow?.rank ?? leaderboard.length;

  // ── GSAP Animations ────────────────────────────────────────

  useGSAP(() => {
    if (!mounted) return;
    const ctx = gsap.context(() => {
      // Hero card
      gsap.fromTo('.hero-card',
        { y: 40, autoAlpha: 0, scale: 0.95 },
        { y: 0, autoAlpha: 1, scale: 1, duration: 0.7, ease: 'power3.out' }
      );

      // Stats boxes stagger
      gsap.fromTo('.stat-box',
        { y: 30, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, stagger: 0.08, duration: 0.5, delay: 0.3, ease: 'power3.out' }
      );

      // Table header
      gsap.fromTo('.table-header',
        { y: 20, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.4, delay: 0.5, ease: 'power3.out' }
      );

      // Table rows stagger
      gsap.fromTo('.lb-row',
        { x: -30, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, stagger: 0.035, duration: 0.4, delay: 0.6, ease: 'power3.out' }
      );

      // Rating number counter
      const ratingEl = document.querySelector('.rating-counter');
      if (ratingEl && userRow) {
        gsap.fromTo(ratingEl,
          { textContent: '0' },
          {
            textContent: userRow.rating,
            duration: 1.5,
            delay: 0.4,
            ease: 'power2.out',
            snap: { textContent: 1 },
            onUpdate() {
              const val = Math.round(parseFloat(ratingEl.textContent || '0'));
              ratingEl.textContent = val.toString();
            },
          }
        );
      }
    }, containerRef);

    return () => ctx.revert();
  }, { scope: containerRef, dependencies: [mounted, leaderboard] });

  if (!mounted) return <div className="h-screen bg-[#0a0a0a]" />;

  const BracketIcon = userBracket.icon;

  return (
    <div ref={containerRef} className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="mx-auto max-w-5xl px-6 py-10">

        {/* ── Page header ── */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight">
            <Trophy className="mr-2 inline-block h-7 w-7 text-amber-400" />
            Leaderboard
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Decision-quality rankings — not P/L, pure psychological discipline
          </p>
        </div>

        {/* ── Hero: User ELO card ── */}
        <div className="hero-card mb-8 rounded-3xl border border-white/[0.08] bg-white/[0.03] p-8 backdrop-blur-xl relative overflow-hidden">
          {/* Subtle gradient glow */}
          <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-48 w-96 rounded-full bg-emerald-500/[0.07] blur-3xl" />

          <div className="relative flex flex-col items-center gap-4 sm:flex-row sm:gap-8">
            {/* Avatar */}
            <div className="relative">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-500 to-cyan-400 text-2xl font-bold text-black shadow-lg shadow-emerald-500/20">
                AT
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#0a0a0a] border-2 border-emerald-400">
                <span className="text-[10px] font-bold text-emerald-400">#{userRank}</span>
              </div>
            </div>

            {/* Rating area */}
            <div className="flex-1 text-center sm:text-left">
              <div className="flex items-center gap-2 justify-center sm:justify-start">
                <BracketIcon className={`h-5 w-5 ${userBracket.color}`} />
                <span className={`text-sm font-semibold ${userBracket.color}`}>
                  {userRow?.bracket ?? 'Developing'}
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-3 justify-center sm:justify-start">
                <span className="rating-counter text-5xl font-extrabold tracking-tight text-white">
                  {userRow?.rating ?? 1200}
                </span>
                <span className="text-sm text-gray-500">ELO</span>
                {userElo.lastSessionDelta !== 0 && (
                  <span className={`flex items-center gap-0.5 text-sm font-medium ${userElo.lastSessionDelta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {userElo.lastSessionDelta > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                    {userElo.lastSessionDelta > 0 ? '+' : ''}{userElo.lastSessionDelta.toFixed(1)}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Peak: {userElo.peakRating.toFixed(0)} &middot; K-Factor: {userElo.kFactor.toFixed(1)}
              </p>
            </div>

            {/* Mini stats */}
            <div className="flex gap-3">
              <div className="stat-box flex flex-col items-center rounded-2xl border border-white/[0.06] bg-white/[0.04] px-5 py-3">
                <span className="text-lg font-bold text-white">{userElo.sessionsPlayed}</span>
                <span className="text-[10px] uppercase tracking-wider text-gray-500">Sessions</span>
              </div>
              <div className="stat-box flex flex-col items-center rounded-2xl border border-white/[0.06] bg-white/[0.04] px-5 py-3">
                <span className="text-lg font-bold text-white">
                  {userElo.sessionsPlayed > 0
                    ? `${Math.round(userElo.lastSessionPerformance * 100)}%`
                    : '—'}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-gray-500">Perf</span>
              </div>
              <div className="stat-box flex flex-col items-center rounded-2xl border border-white/[0.06] bg-white/[0.04] px-5 py-3">
                <span className="text-lg font-bold text-white">
                  {userElo.history.length > 0
                    ? userElo.history.filter(h => h.delta > 0).length
                    : '—'}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-gray-500">Wins</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Bracket Tier Strip ── */}
        <div className="mb-8 flex flex-wrap items-center gap-2">
          {(Object.keys(BRACKET_CONFIG) as RatingBracket[]).map((b) => {
            const c = BRACKET_CONFIG[b];
            const Icon = c.icon;
            const isActive = b === userRow?.bracket;
            return (
              <div
                key={b}
                className={`stat-box flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-all duration-300 ${
                  isActive
                    ? `${c.bg} ${c.color} ${c.border} ring-1 ${c.border} shadow-md ${c.glow}`
                    : 'border-white/[0.06] bg-white/[0.02] text-gray-600'
                }`}
              >
                <Icon className="h-3 w-3" />
                {b}
              </div>
            );
          })}
        </div>

        {/* ── Leaderboard Table ── */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          {/* Header */}
          <div className="table-header grid grid-cols-[3rem_1fr_6rem_5rem_5rem_5rem_4rem] items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            <span>#</span>
            <span>Trader</span>
            <span className="text-right">Rating</span>
            <span className="text-right">Delta</span>
            <span className="text-right">Sessions</span>
            <span className="text-right">Win %</span>
            <span className="text-right">
              <Flame className="ml-auto h-3 w-3 text-orange-400" />
            </span>
          </div>

          {/* Rows */}
          {leaderboard.map((entry) => {
            const bracket = BRACKET_CONFIG[entry.bracket];
            const Icon = bracket.icon;
            return (
              <div
                key={entry.name}
                className={`lb-row grid grid-cols-[3rem_1fr_6rem_5rem_5rem_5rem_4rem] items-center gap-2 px-4 py-3 text-sm transition-colors duration-200 ${
                  entry.isUser
                    ? 'bg-emerald-500/[0.06] border-l-2 border-l-emerald-400'
                    : 'border-l-2 border-l-transparent hover:bg-white/[0.03]'
                } ${entry.rank > 1 ? 'border-t border-t-white/[0.04]' : ''}`}
              >
                {/* Rank */}
                <div className="flex items-center gap-1">
                  {getRankIcon(entry.rank) || (
                    <span className="text-gray-500 font-mono text-xs">{entry.rank}</span>
                  )}
                </div>

                {/* Trader */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr ${getAvatarGradient(entry.rank, !!entry.isUser)} text-[10px] font-bold ${entry.isUser ? 'text-black' : 'text-white'}`}>
                    {entry.avatar}
                  </div>
                  <div className="min-w-0">
                    <span className={`block truncate font-medium ${entry.isUser ? 'text-emerald-400' : 'text-white'}`}>
                      {entry.name}
                      {entry.isUser && <span className="ml-1.5 text-[10px] text-emerald-400/60">(you)</span>}
                    </span>
                    <span className={`flex items-center gap-1 text-[10px] ${bracket.color}`}>
                      <Icon className="h-2.5 w-2.5" />
                      {entry.bracket}
                    </span>
                  </div>
                </div>

                {/* Rating */}
                <span className="text-right font-mono font-semibold text-white">
                  {entry.rating.toFixed(0)}
                </span>

                {/* Delta */}
                <span className={`flex items-center justify-end gap-0.5 font-mono text-xs ${
                  entry.delta > 0 ? 'text-emerald-400' : entry.delta < 0 ? 'text-red-400' : 'text-gray-500'
                }`}>
                  {entry.delta > 0 ? <ChevronUp className="h-3 w-3" /> : entry.delta < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                  {entry.delta > 0 ? '+' : ''}{entry.delta.toFixed(1)}
                </span>

                {/* Sessions */}
                <span className="text-right text-gray-400 font-mono text-xs">{entry.sessions}</span>

                {/* Win % */}
                <span className="text-right text-gray-400 font-mono text-xs">{entry.winRate}%</span>

                {/* Streak */}
                <div className="flex items-center justify-end gap-0.5">
                  {entry.streak > 0 ? (
                    <>
                      <Flame className={`h-3 w-3 ${entry.streak >= 5 ? 'text-orange-400' : 'text-orange-400/50'}`} />
                      <span className={`text-xs font-mono ${entry.streak >= 5 ? 'text-orange-400' : 'text-gray-500'}`}>
                        {entry.streak}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer note ── */}
        <div className="mt-6 text-center text-xs text-gray-600">
          Rankings update after each analyzed session &middot; Based on decision quality, not profit
        </div>
      </div>
    </div>
  );
}
