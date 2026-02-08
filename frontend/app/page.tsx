'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, Shield, BarChart3, Lightbulb, Target } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  RevengeAnnotation,
  OvertradingAnnotation,
  DrawdownAnnotation,
  ScoreAnnotation,
} from '@/components/landing/TerminalAnnotations';

const TradingTerminal = dynamic(
  () => import('@/components/landing/TradingTerminal'),
  { ssr: false },
);

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

/* ── LANDING PAGE ── */
export default function LandingPage() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      /* ─ Hero text entrance ─ */
      const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      heroTl
        .fromTo('.hero-tag', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6, delay: 0.2 })
        .fromTo('.hero-h1', { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8 }, '-=0.3')
        .fromTo('.hero-sub', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6 }, '-=0.4')
        .fromTo('.hero-cta', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3');

      /* ─ Hero fades out on scroll ─ */
      gsap.to('.hero-content', {
        yPercent: -15,
        autoAlpha: 0,
        ease: 'none',
        scrollTrigger: { trigger: '.hero-section', start: 'top top', end: '60% top', scrub: true },
      });

      /* ─ Terminal materialises ─ */
      const termTl = gsap.timeline({
        scrollTrigger: {
          trigger: '.terminal-section',
          start: 'top 85%',
          end: 'top 25%',
          scrub: 1,
        },
      });
      termTl
        .fromTo('.terminal-frame', { y: 100, scale: 0.92, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 1 });

      /* ─ Pin terminal & reveal annotations ─ */
      const pinTl = gsap.timeline({
        scrollTrigger: {
          trigger: '.terminal-pin',
          start: 'top 10%',
          end: '+=200%',
          scrub: 1,
          pin: true,
          pinSpacing: true,
        },
      });

      // Sequentially reveal each annotation
      pinTl
        .fromTo('.annotation-revenge', { x: 60, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.3 })
        .fromTo('.annotation-overtrade', { x: -60, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.3 }, '+=0.15')
        .fromTo('.annotation-drawdown', { x: 60, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.3 }, '+=0.15')
        // Fade chart slightly and bring in score
        .to('.terminal-wrap', { filter: 'brightness(0.35)', duration: 0.3 }, '+=0.1')
        .fromTo('.annotation-score', { scale: 0.7, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.35 }, '-=0.15')
        // Hold
        .to({}, { duration: 0.6 });

      /* ─ Story sections reveal ─ */
      gsap.utils.toArray<HTMLElement>('.story-reveal').forEach((el) => {
        gsap.fromTo(el, { y: 50, autoAlpha: 0 }, {
          y: 0,
          autoAlpha: 1,
          duration: 0.8,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none reverse' },
        });
      });

      /* ─ Feature cards stagger ─ */
      gsap.fromTo('.pillar-card', { y: 70, autoAlpha: 0 }, {
        y: 0,
        autoAlpha: 1,
        stagger: 0.12,
        duration: 0.7,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.pillars-grid', start: 'top 80%' },
      });

      /* ─ Stats count-up ─ */
      gsap.utils.toArray<HTMLElement>('.stat-number').forEach((el) => {
        const end = parseInt(el.dataset.val ?? '0', 10);
        gsap.fromTo(el, { textContent: '0' }, {
          textContent: end,
          duration: 1.5,
          ease: 'power2.out',
          snap: { textContent: 1 },
          scrollTrigger: { trigger: el, start: 'top 90%' },
        });
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="bg-[#050505] text-white">
      {/* ── Fixed video background ── */}
      <div className="fixed inset-0 z-0">
        <video autoPlay muted loop playsInline preload="auto" className="h-full w-full object-cover opacity-60">
          <source src="/assets/4990245-hd_1920_1080_30fps.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-[#050505]/80 via-[#050505]/60 to-[#050505]" />
      </div>

      {/* ── Sticky Header ── */}
      <header className="fixed left-0 right-0 top-0 z-50 px-6 py-4 md:px-12 backdrop-blur-md bg-[#050505]/60 border-b border-white/[0.04]">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-coach text-xl font-bold tracking-tight">
            <img src="/Temper_logo.png" alt="Temper" className="h-7 w-auto" />
            <span>Temper</span>
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-emerald-500 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-black transition-all hover:bg-white"
          >
            Get Started
          </Link>
        </div>
      </header>

      {/* ── Main content ── */}
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
              Temper watches your trades, detects tilt and revenge patterns in
              real time, and coaches you toward discipline.
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

          {/* scroll hint */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
            <div className="flex flex-col items-center gap-2 text-gray-600">
              <span className="text-[10px] uppercase tracking-widest">Scroll</span>
              <div className="h-8 w-px bg-gradient-to-b from-gray-600 to-transparent" />
            </div>
          </div>
        </section>

        {/* ━━ TERMINAL SECTION ━━ */}
        <section className="terminal-section relative px-4 md:px-8">
          <div className="terminal-pin mx-auto max-w-6xl">
            {/* Section title */}
            <div className="story-reveal mb-8 text-center">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-400/70">
                Live Analysis
              </p>
              <h2 className="text-2xl font-medium tracking-tight text-white md:text-3xl">
                Your trading terminal. Our psychology layer.
              </h2>
            </div>

            {/* Terminal with annotations */}
            <div className="terminal-frame relative mx-auto" style={{ height: 'clamp(420px, 60vh, 620px)' }}>
              <TradingTerminal />
              <RevengeAnnotation />
              <OvertradingAnnotation />
              <DrawdownAnnotation />
              <ScoreAnnotation />
            </div>
          </div>
        </section>

        {/* ━━ STORY: HOW IT WORKS ━━ */}
        <section className="relative bg-[#050505] px-6 py-32 md:px-12">
          <div className="mx-auto max-w-5xl">
            <div className="story-reveal mb-20 text-center">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-400/70">
                How It Works
              </p>
              <h2 className="text-3xl font-medium tracking-tight md:text-4xl lg:text-5xl">
                Three steps to<br />
                <span className="text-emerald-400">better decisions.</span>
              </h2>
            </div>

            {/* Steps — alternating layout */}
            <div className="space-y-24">
              {[
                {
                  num: '01',
                  title: 'Upload your trades',
                  desc: 'Import a CSV from any broker — or try our sample datasets. Temper auto-detects columns, timestamps, and position sizing.',
                  accent: 'emerald',
                },
                {
                  num: '02',
                  title: 'We find the patterns',
                  desc: 'Our engine scores every trade decision, flags revenge sequences, tilt streaks, and overtrading bursts. No guesswork — pure behavioral data.',
                  accent: 'orange',
                },
                {
                  num: '03',
                  title: 'You build discipline',
                  desc: 'Review annotated equity curves, journal your emotions, track your ELO discipline rating over time. Improve trade by trade.',
                  accent: 'purple',
                },
              ].map((step, i) => (
                <div
                  key={step.num}
                  className={`story-reveal flex flex-col items-center gap-8 md:flex-row ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}
                >
                  <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.03]">
                    <span className={`text-3xl font-bold ${
                      step.accent === 'emerald' ? 'text-emerald-400' :
                      step.accent === 'orange' ? 'text-orange-400' : 'text-purple-400'
                    }`}>{step.num}</span>
                  </div>
                  <div className="max-w-lg text-center md:text-left">
                    <h3 className="mb-3 text-xl font-medium">{step.title}</h3>
                    <p className="text-sm leading-relaxed text-gray-400">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ━━ PILLARS ━━ */}
        <section className="relative bg-[#0a0a0f] px-6 py-32 md:px-12">
          <div className="mx-auto max-w-6xl">
            <div className="story-reveal mb-16 text-center">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-emerald-400/70">
                Built For Traders
              </p>
              <h2 className="text-3xl font-medium tracking-tight md:text-4xl">
                Everything you need. Nothing you don&apos;t.
              </h2>
            </div>

            <div className="pillars-grid grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Shield, title: 'Bias Detection', desc: 'Revenge, FOMO, overtrading, loss aversion — caught automatically.', color: 'text-red-400' },
                { icon: BarChart3, title: 'Equity Replay', desc: 'See your "what-if" disciplined equity curve vs actual performance.', color: 'text-emerald-400' },
                { icon: Lightbulb, title: 'AI Coach', desc: 'Personalized prompts and journaling that target your specific patterns.', color: 'text-purple-400' },
                { icon: Target, title: 'ELO Rating', desc: 'Chess-style discipline scoring. Track progress session over session.', color: 'text-orange-400' },
              ].map(({ icon: Icon, title, desc, color }) => (
                <div
                  key={title}
                  className="pillar-card group rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 transition-all duration-300 hover:border-emerald-500/20 hover:bg-white/[0.05]"
                >
                  <Icon className={`mb-4 h-6 w-6 ${color}`} />
                  <h3 className="mb-2 text-sm font-semibold">{title}</h3>
                  <p className="text-[12px] leading-relaxed text-gray-500">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ━━ STATS BAR ━━ */}
        <section className="relative border-y border-white/[0.06] bg-[#050505] px-6 py-16 md:px-12">
          <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 text-center md:grid-cols-4">
            {[
              { val: 8, suffix: '', label: 'Decision Labels' },
              { val: 5, suffix: '', label: 'Bias Detectors' },
              { val: 100, suffix: '%', label: 'Deterministic' },
              { val: 0, suffix: '', label: 'API Keys Needed', special: true },
            ].map(({ val, suffix, label, special }) => (
              <div key={label} className="story-reveal">
                <p className="text-3xl font-bold text-white md:text-4xl">
                  {special ? (
                    <span>0</span>
                  ) : (
                    <><span className="stat-number" data-val={val}>0</span>{suffix}</>
                  )}
                </p>
                <p className="mt-1 text-[11px] text-gray-500">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ━━ CTA ━━ */}
        <section className="relative px-6 py-28 md:px-12">
          <div className="story-reveal mx-auto max-w-3xl space-y-8 text-center">
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
