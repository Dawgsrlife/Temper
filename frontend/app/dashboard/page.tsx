'use client';

import { useRef, useEffect, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import {
  ArrowUpRight,
  Shield,
  TrendingUp,
  AlertTriangle,
  Plus,
  Brain,
  Activity,
  Zap,
  Network,
} from 'lucide-react';
import { analyzeSession, Trade, SessionAnalysis } from '@/lib/biasDetector';

/* ------------------------------------------------------------------ */
/*  Score Ring                                                         */
/* ------------------------------------------------------------------ */
function ScoreRing({ score, size = 180 }: { score: number; size?: number }) {
  const ringRef = useRef<SVGCircleElement>(null);
  const numberRef = useRef<HTMLSpanElement>(null);
  const circumference = 2 * Math.PI * 45;

  const color =
    score >= 80 ? '#06D6A0' : score >= 60 ? '#F9C74F' : '#EF476F';

  useGSAP(() => {
    if (!ringRef.current || !numberRef.current) return;

    /* Animate the SVG ring stroke */
    gsap.fromTo(
      ringRef.current,
      { strokeDashoffset: circumference },
      {
        strokeDashoffset: circumference - (score / 100) * circumference,
        duration: 1.4,
        ease: 'power3.out',
        delay: 0.3,
      },
    );

    /* Animate the number counter */
    const tweenObj = { v: 0 };
    gsap.to(tweenObj, {
      v: score,
      duration: 1.4,
      ease: 'power3.out',
      delay: 0.3,
      onUpdate() {
        if (numberRef.current) {
          numberRef.current.textContent = String(Math.round(tweenObj.v));
        }
      },
    });
  }, [score]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        {/* Background ring */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Animated score ring */}
        <circle
          ref={ringRef}
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span ref={numberRef} className="text-5xl font-bold text-white">
          0
        </span>
        <span className="text-xs text-gray-500 uppercase tracking-widest mt-1">
          Discipline
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dashboard Page                                                     */
/* ------------------------------------------------------------------ */
export default function DashboardPage() {
  const container = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null);
  const [lastJournalDate, setLastJournalDate] = useState<string | null>(null);

  /* ---- Load data from localStorage ---- */
  useEffect(() => {
    setMounted(true);

    const savedSession = localStorage.getItem('temper_current_session');
    if (savedSession) {
      try {
        const trades: Trade[] = JSON.parse(savedSession);
        if (Array.isArray(trades) && trades.length > 0) {
          setAnalysis(analyzeSession(trades));
        }
      } catch (e) {
        console.error('Failed to parse session', e);
      }
    }

    const savedJournal = localStorage.getItem('temper_journal_entries');
    if (savedJournal) {
      try {
        const entries = JSON.parse(savedJournal);
        if (Array.isArray(entries) && entries.length > 0) {
          setLastJournalDate(entries[0].date);
        }
      } catch (e) {
        console.error('Failed to parse journal', e);
      }
    }
  }, []);

  /* ---- GSAP entrance animations ---- */
  useGSAP(
    () => {
      if (!mounted) return;

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.from('.page-header', { y: 30, opacity: 0, duration: 0.6 })
        .from(
          '.score-card',
          { y: 40, opacity: 0, scale: 0.95, duration: 0.7 },
          '-=0.4',
        )
        .from(
          '.stat-card',
          { y: 30, opacity: 0, stagger: 0.08, duration: 0.5 },
          '-=0.4',
        )
        .from(
          '.insight-card',
          { y: 20, opacity: 0, stagger: 0.1, duration: 0.4 },
          '-=0.3',
        )
        .from(
          '.session-item',
          { x: -20, opacity: 0, stagger: 0.06, duration: 0.4 },
          '-=0.2',
        )
        .from(
          '.explorer-cta',
          { y: 30, opacity: 0, duration: 0.5 },
          '-=0.2',
        );
    },
    { scope: container, dependencies: [mounted] },
  );

  /* ---- Derived data ---- */
  const hasData = !!analysis;
  const currentScore = analysis ? analysis.disciplineScore : 0;

  const stats = analysis
    ? [
        {
          label: 'Win Rate',
          value: `${analysis.summary.winRate.toFixed(0)}%`,
          icon: TrendingUp,
          positive: true,
          sub: 'Session',
        },
        {
          label: 'Avg Interval',
          value: `${Math.round(analysis.summary.avgTradeInterval)}s`,
          icon: Activity,
          positive: true,
          sub: 'Patience',
        },
        {
          label: 'Biases Detected',
          value: analysis.biases.length.toString(),
          icon: AlertTriangle,
          positive: analysis.biases.length === 0,
          sub: analysis.biases.length > 0 ? 'Found' : 'Clean',
        },
      ]
    : [
        { label: 'Win Rate', value: '--', icon: TrendingUp, positive: true, sub: '--' },
        { label: 'Avg Interval', value: '--', icon: Activity, positive: true, sub: '--' },
        { label: 'Biases Detected', value: '--', icon: AlertTriangle, positive: true, sub: '--' },
      ];

  const insights = analysis
    ? [
        ...(analysis.biases.length > 0
          ? [
              {
                title: 'Bias Detected',
                description: `We found ${analysis.biases.length} potential behavioral issue${analysis.biases.length > 1 ? 's' : ''} in your last session.`,
                type: 'warning' as const,
                action: 'Review',
                href: '/dashboard/analyze',
              },
            ]
          : [
              {
                title: 'Clean Session',
                description:
                  'Great job — no major biases detected in recent trades.',
                type: 'success' as const,
                action: 'Details',
                href: '/dashboard/analyze',
              },
            ]),
        ...(lastJournalDate
          ? [
              {
                title: 'Journal Active',
                description: `Last entry: ${new Date(lastJournalDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                type: 'success' as const,
                action: 'Open',
                href: '/dashboard/journal',
              },
            ]
          : [
              {
                title: 'Start Journaling',
                description:
                  'Tracking your mood can improve performance by 20%.',
                type: 'info' as const,
                action: 'Start',
                href: '/dashboard/journal',
              },
            ]),
      ]
    : [];

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div
      ref={container}
      className="min-h-screen bg-[#0a0a0a] px-6 py-8 text-white md:px-10 md:py-10 lg:px-12"
    >
      <div className="mx-auto max-w-6xl space-y-10">
        {/* ──────────────── Header ──────────────── */}
        <header className="page-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Bias Detector
            </p>
            <h1 className="font-coach text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Welcome back
            </h1>
            <p className="text-sm text-gray-500">
              Your trading psychology dashboard
            </p>
          </div>
          <Link
            href="/dashboard/upload"
            className="group inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black transition-all hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            New Session
          </Link>
        </header>

        {/* ──────────────── Main Grid ──────────────── */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Score Card — big discipline ring */}
          <div className="score-card flex flex-col items-center justify-center gap-4 rounded-2xl bg-white/[0.04] border border-white/[0.06] p-8 lg:row-span-2">
            <div className="flex items-center gap-2 text-gray-500">
              <Shield className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">
                Discipline Score
              </span>
            </div>

            {mounted && <ScoreRing score={currentScore} size={180} />}

            <p className="text-xs text-gray-500 text-center">
              {hasData
                ? 'Based on latest session'
                : 'Upload a session to begin'}
            </p>

            <Link
              href="/dashboard/analyze"
              className="mt-2 flex items-center gap-2 text-sm font-medium text-emerald-400 transition-colors hover:text-emerald-300"
            >
              View detailed analysis
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Stats Row */}
          <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-3">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="stat-card group rounded-2xl bg-white/[0.04] border border-white/[0.06] p-5 transition-all hover:bg-white/[0.06]"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="rounded-xl bg-white/[0.06] p-2.5">
                    <stat.icon
                      className={`h-4 w-4 ${
                        stat.positive ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    />
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      stat.positive ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {stat.sub}
                  </span>
                </div>
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="mt-1 text-xs text-gray-500">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* AI Insights */}
          <div className="space-y-3 lg:col-span-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <Brain className="h-4 w-4" />
              AI Insights
            </h3>

            {insights.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {insights.map((insight, i) => (
                  <Link
                    key={i}
                    href={insight.href}
                    className={`insight-card group rounded-2xl bg-white/[0.04] border p-5 transition-all hover:bg-white/[0.06] ${
                      insight.type === 'warning'
                        ? 'border-red-400/20'
                        : 'border-emerald-400/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p
                          className={`text-sm font-semibold ${
                            insight.type === 'warning'
                              ? 'text-red-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {insight.title}
                        </p>
                        <p className="text-xs text-gray-500 leading-relaxed">
                          {insight.description}
                        </p>
                      </div>
                      <ArrowUpRight className="h-4 w-4 flex-shrink-0 text-gray-500 opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <span
                      className={`mt-3 inline-block text-xs font-medium ${
                        insight.type === 'warning'
                          ? 'text-red-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {insight.action} →
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-6 text-center">
                <Brain className="mx-auto h-8 w-8 text-gray-500/50 mb-2" />
                <p className="text-sm text-gray-500">
                  Upload a session to unlock AI insights
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ──────────────── Recent Sessions ──────────────── */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <Activity className="h-4 w-4" />
              Recent Sessions
            </h2>
            <Link
              href="/dashboard/analyze"
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-emerald-400"
            >
              View Analysis <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white/[0.04] border border-white/[0.06] divide-y divide-white/[0.06]">
            {analysis ? (
              <Link
                href="/dashboard/analyze"
                className="session-item group flex items-center justify-between p-5 transition-colors hover:bg-white/[0.06]"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold ${
                      analysis.disciplineScore >= 80
                        ? 'text-emerald-400 bg-emerald-400/10'
                        : analysis.disciplineScore >= 60
                          ? 'text-yellow-400 bg-yellow-400/10'
                          : 'text-red-400 bg-red-400/10'
                    }`}
                  >
                    {analysis.disciplineScore}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">
                        Latest Session
                      </p>
                      {analysis.biases.length > 0 && (
                        <span className="rounded-full bg-red-400/10 px-2 py-0.5 text-[10px] font-medium text-red-400">
                          {analysis.biases.length} Bias
                          {analysis.biases.length > 1 ? 'es' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      {analysis.summary.totalTrades} trades &middot; Win rate{' '}
                      {analysis.summary.winRate.toFixed(0)}%
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span
                    className={`font-mono text-sm font-semibold ${
                      analysis.summary.netPnL >= 0
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {analysis.summary.netPnL >= 0 ? '+' : ''}$
                    {Math.abs(analysis.summary.netPnL).toFixed(0)}
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-gray-500 opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </Link>
            ) : (
              <div className="p-10 text-center">
                <Activity className="mx-auto h-8 w-8 text-gray-500/40 mb-3" />
                <p className="text-sm text-gray-500">
                  No sessions analyzed yet.
                </p>
                <Link
                  href="/dashboard/upload"
                  className="mt-2 inline-block text-xs font-medium text-emerald-400 hover:underline"
                >
                  Upload your first session →
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* ──────────────── 3D Explorer CTA ──────────────── */}
        <Link
          href="/dashboard/explorer"
          className="explorer-cta group relative flex items-center justify-between overflow-hidden rounded-2xl bg-white/[0.04] border border-white/[0.06] p-6 transition-all hover:bg-white/[0.06] hover:border-emerald-400/20"
        >
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-emerald-500/10 blur-3xl transition-all group-hover:bg-emerald-500/20" />

          <div className="relative flex items-center gap-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-400/20">
              <Network className="h-7 w-7 text-emerald-400" />
            </div>
            <div>
              <h3 className="font-coach text-lg font-semibold text-white">
                3D Explorer
              </h3>
              <p className="text-sm text-gray-500">
                Visualize your trading patterns in an interactive 3D graph
              </p>
            </div>
          </div>

          <div className="relative flex items-center gap-2 text-sm font-medium text-emerald-400">
            <Zap className="h-4 w-4" />
            <span className="hidden sm:inline">Launch</span>
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </div>
        </Link>
      </div>
    </div>
  );
}
