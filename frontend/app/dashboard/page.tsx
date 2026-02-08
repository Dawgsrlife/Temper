'use client';

import { useRef, useEffect, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import {
  ArrowUpRight,
  Shield,
  Plus,
  Brain,
  Activity,
  Zap,
  Network,
} from 'lucide-react';
import { analyzeSession, Trade, SessionAnalysis, getRatingBracket } from '@/lib/biasDetector';
import TemperMascot from '@/components/mascot/TemperMascot';
import { fetchTradesFromJob, getLastJobId } from '@/lib/backend-bridge';
import { loadCachedSessionTrades, saveCachedSessionTrades } from '@/lib/session-cache';

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
        <span className="text-xs text-gray-400 uppercase tracking-widest mt-1">
          Temper Score
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
    let cancelled = false;
    setMounted(true);

    const cachedTrades = loadCachedSessionTrades();
    if (cachedTrades && cachedTrades.length > 0) {
      setAnalysis(analyzeSession(cachedTrades));
    } else {
      const lastJobId = getLastJobId();
      if (lastJobId) {
        void fetchTradesFromJob(lastJobId)
          .then((rows) => {
            if (cancelled || rows.length === 0) return;
            saveCachedSessionTrades(rows);
            setAnalysis(analyzeSession(rows));
          })
          .catch((error) => {
            console.error('Failed to hydrate session from backend job', error);
          });
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

    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- GSAP entrance animations ---- */
  useGSAP(
    () => {
      if (!mounted) return;

      gsap.set(['.page-header', '.score-card', '.stat-card', '.insight-card', '.session-item', '.explorer-cta'], { clearProps: 'all' });
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.fromTo('.page-header', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6 })
        .fromTo(
          '.score-card',
          { y: 40, autoAlpha: 0, scale: 0.95 },
          { y: 0, autoAlpha: 1, scale: 1, duration: 0.7 },
          '-=0.4',
        )
        .fromTo(
          '.stat-card',
          { y: 30, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, stagger: 0.08, duration: 0.5 },
          '-=0.4',
        )
        .fromTo(
          '.insight-card',
          { y: 20, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, stagger: 0.1, duration: 0.4 },
          '-=0.3',
        )
        .fromTo(
          '.session-item',
          { x: -20, autoAlpha: 0 },
          { x: 0, autoAlpha: 1, stagger: 0.06, duration: 0.4 },
          '-=0.2',
        )
        .fromTo(
          '.explorer-cta',
          { y: 30, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.5 },
          '-=0.2',
        );
    },
    { scope: container, dependencies: [mounted] },
  );

  /* ---- Derived data ---- */
  const hasData = !!analysis;
  const currentScore = analysis ? analysis.disciplineScore : 0;

  /* ELO rating data */
  const eloRating = analysis ? Math.round(analysis.eloState.rating) : 1200;
  const eloBracket = getRatingBracket(eloRating);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div
      ref={container}
      className="h-full overflow-y-auto overflow-x-hidden bg-[#0a0a0a] px-6 py-8 text-white md:px-10 md:py-10 lg:px-12"
    >
      <div className="mx-auto max-w-6xl space-y-10">
        {/* ──────────────── Header ──────────────── */}
        <header className="page-header flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Bias Detector
            </p>
            <h1 className="font-coach text-3xl font-semibold tracking-tight md:text-4xl">
              <span className="text-white">Welcome </span>
              <span className="text-emerald-400">back</span>
            </h1>
            <p className="text-sm text-gray-400">
              Your trading psychology dashboard
            </p>
          </div>
          <Link
            href="/dashboard/upload"
            className="group inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black transition-all hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            {hasData ? 'New Session' : 'Upload Data'}
          </Link>
        </header>

        {/* ──────────────── Empty State: Upload First ──────────────── */}
        {!hasData && (
          <div className="score-card flex flex-col items-center gap-6 rounded-3xl border border-dashed border-emerald-400/20 bg-emerald-400/[0.02] px-8 py-16 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-400/20">
              <Activity className="h-10 w-10 text-emerald-400" />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-xl font-semibold text-white">
                No trading data yet
              </h2>
              <p className="text-sm leading-relaxed text-gray-400">
                Upload a CSV of your trades or try our sample datasets to see
                Temper&apos;s bias detection, discipline scoring, and AI coaching in
                action.
              </p>
            </div>
            <Link
              href="/dashboard/upload"
              className="group inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-sm font-bold text-black transition-all hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              Get Started
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>
        )}

        {/* ──────────────── Main Grid (data present) ──────────────── */}
        {hasData && analysis && (
          <>
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Score Card — ring + mascot */}
              <div className="score-card flex flex-col items-center justify-center gap-4 rounded-2xl bg-white/[0.06] border border-white/[0.08] p-8 lg:row-span-2">
                <div className="flex items-center gap-2 text-gray-400">
                  <Shield className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    Discipline Score
                  </span>
                </div>

                {mounted && (
                  <div className="relative flex items-center justify-center">
                    <ScoreRing score={currentScore} size={180} />
                    <div className="absolute -bottom-2 -right-4">
                      <TemperMascot
                        label={
                          currentScore >= 80
                            ? 'BRILLIANT'
                            : currentScore >= 70
                              ? 'EXCELLENT'
                              : currentScore >= 60
                                ? 'GOOD'
                                : currentScore >= 50
                                  ? 'BOOK'
                                  : currentScore >= 40
                                    ? 'INACCURACY'
                                    : currentScore >= 25
                                      ? 'MISTAKE'
                                      : 'BLUNDER'
                        }
                        size={52}
                        animate
                      />
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-400 text-center">
                  Based on latest session
                </p>

                <Link
                  href="/dashboard/analyze"
                  className="mt-2 flex items-center gap-2 text-sm font-medium text-emerald-400 transition-colors hover:text-emerald-300"
                >
                  View detailed analysis
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {/* Key Stats — simplified to 3 clean cards */}
              <div className="stat-card rounded-2xl bg-white/[0.06] border border-white/[0.08] p-5">
                <p className="text-xs text-gray-500 mb-1">Session P/L</p>
                <p className={`text-2xl font-bold ${analysis.summary.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {analysis.summary.netPnL >= 0 ? '+' : ''}${analysis.summary.netPnL.toFixed(0)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {analysis.summary.totalTrades} trades &middot; {analysis.summary.winRate.toFixed(0)}% win rate
                </p>
              </div>

              <div className="stat-card rounded-2xl bg-white/[0.06] border border-white/[0.08] p-5">
                <p className="text-xs text-gray-500 mb-1">ELO Rating</p>
                <p className="text-2xl font-bold text-white">{eloRating}</p>
                <p className={`mt-1 text-xs ${analysis.eloState.lastSessionDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {eloBracket} &middot; {analysis.eloState.lastSessionDelta >= 0 ? '+' : ''}{analysis.eloState.lastSessionDelta.toFixed(1)}
                </p>
              </div>

              {/* Bias Status — single clean card */}
              <div className="stat-card rounded-2xl border p-5 lg:col-span-2 transition-all hover:bg-white/[0.08]"
                   style={{ borderColor: analysis.biases.length > 0 ? 'rgba(239,71,111,0.15)' : 'rgba(6,214,160,0.15)', backgroundColor: analysis.biases.length > 0 ? 'rgba(239,71,111,0.03)' : 'rgba(6,214,160,0.03)' }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-sm font-semibold ${analysis.biases.length > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {analysis.biases.length > 0
                        ? `${analysis.biases.length} Bias${analysis.biases.length > 1 ? 'es' : ''} Detected`
                        : 'Clean Session'}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {analysis.biases.length > 0
                        ? analysis.biases.map(b => b.type.replace(/_/g, ' ')).join(', ')
                        : 'No behavioral biases found — great discipline!'}
                    </p>
                  </div>
                  <Link href="/dashboard/analyze" className="text-xs font-medium text-gray-400 hover:text-emerald-400 transition-colors flex items-center gap-1">
                    Review <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </div>

            {/* ──────────────── Quick Links ──────────────── */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Link
                href="/dashboard/analyze"
                className="insight-card group flex items-center gap-4 rounded-2xl bg-white/[0.06] border border-white/[0.08] p-5 transition-all hover:bg-white/[0.08] cursor-pointer"
              >
                <div className="rounded-xl bg-purple-400/10 p-3">
                  <Brain className="h-5 w-5 text-purple-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">Analyze</p>
                  <p className="text-xs text-gray-500">Trade-by-trade replay</p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-gray-500 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>

              <Link
                href="/dashboard/explorer"
                className="insight-card group flex items-center gap-4 rounded-2xl bg-white/[0.06] border border-white/[0.08] p-5 transition-all hover:bg-white/[0.08] cursor-pointer"
              >
                <div className="rounded-xl bg-emerald-400/10 p-3">
                  <Network className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">3D Explorer</p>
                  <p className="text-xs text-gray-500">Visualize patterns</p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-gray-500 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>

              <Link
                href="/dashboard/journal"
                className="insight-card group flex items-center gap-4 rounded-2xl bg-white/[0.06] border border-white/[0.08] p-5 transition-all hover:bg-white/[0.08] cursor-pointer"
              >
                <div className="rounded-xl bg-amber-400/10 p-3">
                  <Zap className="h-5 w-5 text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">Journal</p>
                  <p className="text-xs text-gray-500">
                    {lastJournalDate
                      ? `Last: ${new Date(lastJournalDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      : 'Log your mindset'}
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-gray-500 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </div>

            {/* ──────────────── Latest Session Row ──────────────── */}
            <section className="space-y-4">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                <Activity className="h-4 w-4" />
                Latest Session
              </h2>
              <Link
                href="/dashboard/analyze"
                className="session-item group flex items-center justify-between rounded-2xl bg-white/[0.06] border border-white/[0.08] p-5 transition-colors hover:bg-white/[0.08] cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="relative">
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
                    <div className="absolute -bottom-1 -right-1">
                      <TemperMascot
                        label={
                          analysis.disciplineScore >= 80
                            ? 'BRILLIANT'
                            : analysis.disciplineScore >= 60
                              ? 'GOOD'
                              : analysis.disciplineScore >= 40
                                ? 'MISTAKE'
                                : 'BLUNDER'
                        }
                        size={22}
                        animate={false}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {analysis.summary.totalTrades} trades &middot; {analysis.summary.winRate.toFixed(0)}% win rate
                    </p>
                    {analysis.biases.length > 0 && (
                      <p className="text-xs text-red-400/80">
                        {analysis.biases.map(b => b.type.replace(/_/g, ' ')).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
                <span
                  className={`font-mono text-sm font-semibold ${
                    analysis.summary.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {analysis.summary.netPnL >= 0 ? '+' : ''}${Math.abs(analysis.summary.netPnL).toFixed(0)}
                </span>
              </Link>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
