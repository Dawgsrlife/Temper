'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, Shield, BarChart3, Lightbulb, Target } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  AnalysisLabelsStrip,
  InsightPanel,
  TemperGauge,
} from '@/components/landing/TerminalAnnotations';

const TradingTerminal = dynamic(
  () => import('@/components/landing/TradingTerminal'),
  { ssr: false },
);

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

export default function LandingPage() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      /* ─ Hero entrance ─ */
      const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      heroTl
        .fromTo('.hero-tag', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, delay: 0.15 })
        .fromTo('.hero-h1', { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8 }, '-=0.35')
        .fromTo('.hero-sub', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6 }, '-=0.4')
        .fromTo('.hero-cta', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3');

      /* ─ Hero fades out ─ */
      gsap.to('.hero-content', {
        yPercent: -12,
        autoAlpha: 0,
        ease: 'none',
        scrollTrigger: { trigger: '.hero-section', start: 'top top', end: '55% top', scrub: true },
      });

      /* ─ Analysis showcase fades in ─ */
      gsap.fromTo('.showcase-section', { autoAlpha: 0 }, {
        autoAlpha: 1,
        scrollTrigger: { trigger: '.showcase-section', start: 'top 90%', end: 'top 50%', scrub: true },
      });

      /* ─ Pin the showcase: chart → labels → insights → gauge ─ */
      const pinTl = gsap.timeline({
        scrollTrigger: {
          trigger: '.showcase-pin',
          start: 'top 8%',
          end: '+=120%',
          scrub: 0.8,
          pin: true,
          pinSpacing: true,
        },
      });

      pinTl
        // 1. Labels strip slides in
        .fromTo('.analysis-labels', { y: 15, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.25 })
        // 2. Insight panel appears
        .fromTo('.insight-panel', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.25 }, '+=0.08')
        // 3. Chart dims, gauge rises
        .to('.terminal-wrap', { filter: 'brightness(0.3)', duration: 0.2 }, '+=0.08')
        .fromTo('.gauge-overlay', { scale: 0.85, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.25 }, '-=0.1')
        // brief hold
        .to({}, { duration: 0.3 });

      /* ─ Section reveals ─ */
      gsap.utils.toArray<HTMLElement>('.story-reveal').forEach((el) => {
        gsap.fromTo(el, { y: 40, autoAlpha: 0 }, {
          y: 0, autoAlpha: 1, duration: 0.7, ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none reverse' },
        });
      });

      /* ─ Pillar cards stagger ─ */
      gsap.fromTo('.pillar-card', { y: 50, autoAlpha: 0 }, {
        y: 0, autoAlpha: 1, stagger: 0.1, duration: 0.6, ease: 'power3.out',
        scrollTrigger: { trigger: '.pillars-grid', start: 'top 82%' },
      });

      /* ─ Stat count-up ─ */
      gsap.utils.toArray<HTMLElement>('.stat-number').forEach((el) => {
        const end = parseInt(el.dataset.val ?? '0', 10);
        gsap.fromTo(el, { textContent: '0' }, {
          textContent: end, duration: 1.4, ease: 'power2.out', snap: { textContent: 1 },
          scrollTrigger: { trigger: el, start: 'top 90%' },
        });
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="bg-[#050505] text-white">
      {/* ── Video bg ── */}
      <div className="fixed inset-0 z-0">
        <video autoPlay muted loop playsInline preload="auto" className="h-full w-full object-cover opacity-50">
          <source src="/assets/4990245-hd_1920_1080_30fps.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-[#050505]/85 via-[#050505]/65 to-[#050505]" />
      </div>

      {/* ── Header ── */}
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/[0.04] bg-[#050505]/60 px-6 py-4 backdrop-blur-md md:px-12">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-coach text-xl font-bold tracking-tight">
            <img src="/Temper_logo.png" alt="Temper" className="h-7 w-auto" />
            <span>Temper</span>
          </Link>
          <Link href="/login" className="rounded-lg bg-emerald-500 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-black transition-all hover:bg-white">
            Get Started
          </Link>
        </div>
      </header>

      <main className="relative z-10">
        {/* ━━ HERO ━━ */}
        <section className="hero-section relative flex min-h-screen items-center justify-center px-6 pt-20">
          <div className="hero-content w-full max-w-4xl text-center">
            <p className="hero-tag mb-5 text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-400">
              Trading Psychology Coach
            </p>
            <h1 className="hero-h1 mb-6 text-5xl font-medium leading-[1.08] tracking-tight md:text-7xl lg:text-[5.5rem]">
              See what your
              <br />
              <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                emotions cost you.
              </span>
            </h1>
            <p className="hero-sub mx-auto mb-10 max-w-lg text-base leading-relaxed text-gray-400 md:text-lg">
              Temper analyzes your trading sessions to identify emotional
              patterns and help you make better decisions.
            </p>
            <div className="hero-cta flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/dashboard"
                className="group flex items-center gap-2 rounded-lg bg-emerald-500 px-8 py-4 text-sm font-semibold text-black transition-all hover:bg-white"
              >
                Try the Demo
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/login"
                className="rounded-lg border border-white/10 px-8 py-4 text-sm font-semibold transition-all hover:border-white/25 hover:bg-white/[0.04]"
              >
                Sign In
              </Link>
            </div>
          </div>
        </section>

        {/* ━━ ANALYSIS SHOWCASE ━━ */}
        <section className="showcase-section relative px-4 md:px-8">
          <div className="showcase-pin mx-auto max-w-6xl">
            <div className="story-reveal mb-6 text-center">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-400/70">
                Behavioral Analysis
              </p>
              <h2 className="text-2xl font-medium tracking-tight md:text-3xl">
                Every trade scored. Every pattern caught.
              </h2>
            </div>

            {/* Chart */}
            <div className="relative mx-auto" style={{ height: 'clamp(360px, 50vh, 520px)' }}>
              <TradingTerminal />
              {/* Gauge overlay — centered on chart */}
              <div className="gauge-overlay pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <div className="rounded-2xl border border-white/[0.06] bg-black/60 px-10 py-8 backdrop-blur-xl">
                  <TemperGauge score={38} />
                </div>
              </div>
            </div>

            {/* Labels strip */}
            <div className="mt-4">
              <AnalysisLabelsStrip />
            </div>

            {/* Insight panel */}
            <div className="mt-3">
              <InsightPanel />
            </div>
          </div>
        </section>

        {/* ━━ HOW IT WORKS ━━ */}
        <section className="relative bg-[#050505] px-6 py-28 md:px-12">
          <div className="mx-auto max-w-5xl">
            <div className="story-reveal mb-16 text-center">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-400/70">
                How It Works
              </p>
              <h2 className="text-3xl font-medium tracking-tight md:text-4xl lg:text-5xl">
                Three steps to<br />
                <span className="text-emerald-400">better decisions.</span>
              </h2>
            </div>

            <div className="space-y-20">
              {[
                { num: '01', title: 'Upload your trades', desc: 'Import a CSV from any broker — or try our sample datasets. Temper auto-detects columns, timestamps, and position sizing.', accent: 'emerald' },
                { num: '02', title: 'We find the patterns', desc: 'Each trade is labeled like a chess move — Brilliant, Good, Inaccuracy, Mistake, Blunder. Revenge sequences and tilt streaks are flagged automatically.', accent: 'orange' },
                { num: '03', title: 'You build discipline', desc: 'Review annotated equity curves, journal your emotions, and track your ELO discipline rating over time.', accent: 'purple' },
              ].map((step, i) => (
                <div
                  key={step.num}
                  className={`story-reveal flex flex-col items-center gap-8 md:flex-row ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}
                >
                  <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur-sm">
                    <span className={`text-2xl font-bold ${
                      step.accent === 'emerald' ? 'text-emerald-400' :
                      step.accent === 'orange' ? 'text-orange-400' : 'text-purple-400'
                    }`}>{step.num}</span>
                  </div>
                  <div className="max-w-lg text-center md:text-left">
                    <h3 className="mb-2 text-lg font-medium">{step.title}</h3>
                    <p className="text-sm leading-relaxed text-gray-400">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ━━ FEATURE PILLARS ━━ */}
        <section className="relative overflow-hidden px-6 py-28 md:px-12">
          {/* Background image */}
          <div className="absolute inset-0 z-0">
            <img
              src="/assets/pexels-themob000-28428587.jpg"
              alt="Trading background"
              className="h-full w-full object-cover opacity-40"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/60" />
          </div>

          <div className="relative z-10 mx-auto max-w-6xl">
            <div className="story-reveal mb-14 text-center">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-400/70">
                Built For Traders
              </p>
              <h2 className="text-3xl font-medium tracking-tight md:text-4xl">
                Everything you need. Nothing you don&apos;t.
              </h2>
            </div>

            <div className="pillars-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Shield, title: 'Bias Detection', desc: 'Revenge, FOMO, overtrading, loss aversion — caught automatically.', color: 'text-red-400', glow: 'hover:shadow-red-500/5' },
                { icon: BarChart3, title: 'Equity Replay', desc: 'See your "what-if" disciplined equity curve vs actual performance.', color: 'text-emerald-400', glow: 'hover:shadow-emerald-500/5' },
                { icon: Lightbulb, title: 'AI Coach', desc: 'Personalized prompts and journaling that target your specific patterns.', color: 'text-purple-400', glow: 'hover:shadow-purple-500/5' },
                { icon: Target, title: 'ELO Rating', desc: 'Chess-style discipline scoring. Track progress session over session.', color: 'text-orange-400', glow: 'hover:shadow-orange-500/5' },
              ].map(({ icon: Icon, title, desc, color, glow }) => (
                <div
                  key={title}
                  className={`pillar-card group rounded-2xl border border-white/[0.15] bg-white/[0.05] p-6 backdrop-blur-xl transition-all duration-300 hover:border-white/[0.25] hover:bg-white/[0.08] hover:shadow-lg ${glow}`}
                >
                  <Icon className={`mb-4 h-5 w-5 ${color} opacity-80`} />
                  <h3 className="mb-2 text-sm font-semibold">{title}</h3>
                  <p className="text-[12px] leading-relaxed text-gray-500">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="relative border-y border-white/[0.06] bg-[#050505] px-6 py-14 md:px-12">
          <div className="mx-auto grid max-w-3xl grid-cols-3 gap-8 text-center">
            {[
              { val: 8, suffix: '', label: 'Decision Labels' },
              { val: 5, suffix: '', label: 'Bias Detectors' },
              { val: 100, suffix: '%', label: 'Deterministic' },
            ].map(({ val, suffix, label }) => (
              <div key={label} className="story-reveal">
                <p className="text-3xl font-bold text-white md:text-4xl">
                  <span className="stat-number" data-val={val}>0</span>{suffix}
                </p>
                <p className="mt-1 text-[11px] text-gray-500">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ━━ CTA ━━ */}
        <section className="relative px-6 py-24 md:px-12">
          <div className="story-reveal mx-auto max-w-3xl space-y-7 text-center">
            <h2 className="text-3xl font-medium tracking-tight md:text-5xl">
              Stop losing to <span className="text-emerald-400">yourself.</span>
            </h2>
            <p className="mx-auto max-w-md text-base text-gray-400">
              Most traders fail not because of bad strategy, but because of bad
              psychology. Fix the root cause.
            </p>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/dashboard"
                className="group flex items-center gap-2 rounded-lg bg-emerald-500 px-10 py-4 text-sm font-semibold text-black transition-all hover:bg-white"
              >
                Launch Dashboard
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/login"
                className="rounded-lg border border-white/10 px-10 py-4 text-sm font-semibold transition-all hover:border-white/25 hover:bg-white/[0.04]"
              >
                Sign In
              </Link>
            </div>
          </div>
        </section>

        {/* ━━ FOOTER ━━ */}
        <footer className="border-t border-white/[0.06] bg-[#050505] px-6 py-8">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 sm:flex-row sm:justify-between">
            <span className="font-coach text-lg font-bold">Temper</span>
            <div className="flex flex-col items-center gap-1 sm:items-end">
              <span className="text-xs text-gray-500">
                Built by Alexander He Meng &amp; Vishnu Sai
              </span>
              <span className="text-[10px] text-gray-600">
                © {new Date().getFullYear()} Temper
              </span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
