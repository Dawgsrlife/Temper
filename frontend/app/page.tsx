'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

if (typeof window !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
}

export default function LandingPage() {
    const containerRef = useRef<HTMLDivElement>(null);
    const heroRef = useRef<HTMLDivElement>(null);

    useGSAP(() => {
        // Hero parallax - content fades as you scroll
        if (heroRef.current) {
            gsap.to('.hero-content', {
                yPercent: -30,
                opacity: 0,
                ease: 'none',
                scrollTrigger: {
                    trigger: heroRef.current,
                    start: 'top top',
                    end: 'bottom top',
                    scrub: true,
                },
            });
        }

        // Reveal animations
        gsap.utils.toArray<HTMLElement>('.reveal').forEach((el) => {
            gsap.from(el, {
                y: 60,
                opacity: 0,
                duration: 1,
                ease: 'power3.out',
                scrollTrigger: {
                    trigger: el,
                    start: 'top 85%',
                    toggleActions: 'play none none reverse',
                },
            });
        });
    }, { scope: containerRef });

    return (
        <div ref={containerRef} className="bg-temper-bg text-temper-text selection:bg-temper-teal/30 selection:text-white">
            {/* Fixed Video Background */}
            <div className="fixed inset-0 z-0">
                <video
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload="auto"
                    className="h-full w-full object-cover"
                >
                    <source src="/assets/12676876_1920_1080_30fps.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-b from-temper-bg/70 via-temper-bg/50 to-temper-bg" />
            </div>

            {/* Fixed Header */}
            <header className="fixed left-0 right-0 top-0 z-50 px-8 py-6 md:px-12">
                <div className="mx-auto flex max-w-7xl items-center justify-between">
                    <Link href="/" className="font-coach text-2xl font-bold text-temper-teal">
                        Temper
                    </Link>
                    <Link
                        href="/login"
                        className="bg-temper-teal px-8 py-3 text-xs font-black uppercase tracking-[0.2em] text-temper-bg transition-all duration-300 hover:bg-white hover:text-temper-bg"
                    >
                        Get Started
                    </Link>
                </div>
            </header>

            {/* Main content */}
            <main className="relative z-10">
                {/* Hero Section */}
                <section ref={heroRef} className="relative flex min-h-screen items-center justify-center px-8 pt-24">
                    <div className="hero-content w-full max-w-5xl text-center">
                        <h1 className="mb-8 font-coach text-[12vw] font-black uppercase leading-[0.85] tracking-tighter md:text-[10vw]">
                            Trade <br />
                            <span className="font-serif italic font-normal lowercase text-temper-teal">
                                Smarter
                            </span>{' '}
                            <br />
                            Not Harder
                        </h1>
                        <p className="mx-auto mb-12 max-w-xl text-sm font-bold uppercase tracking-[0.25em] leading-relaxed text-temper-muted md:text-base">
                            Review your trading day like a chess game. <br />
                            Spot tilt. Build discipline. Master psychology.
                        </p>
                        <div className="flex justify-center gap-4">
                            <Link
                                href="/dashboard/sessions/demo"
                                className="group flex items-center gap-3 bg-temper-teal px-10 py-5 text-xs font-black uppercase tracking-[0.15em] text-temper-bg shadow-[6px_6px_0px_0px_rgba(255,255,255,0.1)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[10px_10px_0px_0px_rgba(6,214,160,0.3)]"
                            >
                                Try Demo Review
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                            </Link>
                        </div>
                    </div>

                    {/* Scroll indicator */}
                    <div className="absolute bottom-12 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
                        <div className="h-8 w-px animate-bounce bg-temper-muted/30" />
                    </div>
                </section>

                {/* Feature Section */}
                <section className="relative min-h-screen bg-temper-bg/95 px-8 py-32 backdrop-blur-sm md:px-12">
                    <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 lg:grid-cols-2 lg:gap-24">
                        <div className="space-y-8">
                            <div className="reveal text-[10px] font-black uppercase tracking-[0.3em] text-temper-teal">
                                01 — Psychology Analysis
                            </div>
                            <h2 className="reveal font-coach text-5xl font-black uppercase leading-[0.9] tracking-tighter md:text-6xl lg:text-7xl">
                                Raw <br />
                                <span className="text-temper-teal">Trades</span> to <br />
                                Insight
                            </h2>
                            <p className="reveal max-w-md text-base font-medium leading-relaxed text-temper-muted md:text-lg">
                                Upload your trade log. Our algorithm detects revenge sequences,
                                emotional entries, and discipline breaks — labeling each decision
                                as BRILLIANT, MISTAKE, or BLUNDER.
                            </p>
                        </div>
                        <div className="reveal relative hidden lg:block">
                            <div className="aspect-[4/3] overflow-hidden border-2 border-temper-border bg-temper-surface/50">
                                <img
                                    src="/assets/pexels-alphatradezone-5833747.jpg"
                                    alt="Trading Analysis"
                                    className="h-full w-full object-cover opacity-80"
                                />
                            </div>
                            <div className="absolute -bottom-6 -left-6 flex h-24 w-24 items-center justify-center border-2 border-temper-border bg-temper-teal shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]">
                                <span className="text-4xl">🧠</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Second Feature */}
                <section className="relative min-h-screen bg-temper-surface px-8 py-32 md:px-12">
                    <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 lg:grid-cols-2 lg:gap-24">
                        <div className="reveal relative order-2 hidden lg:order-1 lg:block">
                            <div className="aspect-[4/3] overflow-hidden border-2 border-temper-border bg-temper-bg/50 grayscale">
                                <img
                                    src="/assets/pexels-markusspiske-11026521.jpg"
                                    alt="Trade Review"
                                    className="h-full w-full object-cover opacity-70"
                                />
                            </div>
                            <div className="absolute -right-6 -top-6 flex h-24 w-24 items-center justify-center border-2 border-temper-teal bg-temper-gold shadow-[4px_4px_0px_0px_rgba(6,214,160,0.5)]">
                                <span className="text-4xl">♟️</span>
                            </div>
                        </div>
                        <div className="order-1 space-y-8 lg:order-2">
                            <div className="reveal text-[10px] font-black uppercase tracking-[0.3em] text-temper-gold">
                                02 — Game Review
                            </div>
                            <h2 className="reveal font-coach text-5xl font-black uppercase leading-[0.9] tracking-tighter md:text-6xl lg:text-7xl">
                                Replay <br />
                                <span className="text-temper-gold">Every</span> <br />
                                Decision
                            </h2>
                            <p className="reveal max-w-md text-base font-medium leading-relaxed text-temper-muted md:text-lg">
                                Step through your session like a chess game. See what
                                your P&L would have been if you followed your rules.
                                The disciplined path, visualized.
                            </p>
                        </div>
                    </div>
                </section>

                {/* CTA Section */}
                <section className="relative flex min-h-screen flex-col bg-temper-teal">
                    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-8 py-24 text-center">
                        <div className="reveal z-10 max-w-4xl space-y-10">
                            <h2 className="font-coach text-6xl font-black uppercase leading-[0.8] tracking-tighter text-temper-bg md:text-7xl lg:text-[8vw]">
                                Master <br />
                                Your Mind
                            </h2>
                            <div className="mx-auto h-1 w-24 bg-temper-bg" />
                            <p className="mx-auto max-w-xl text-lg font-bold uppercase tracking-widest text-temper-bg/70 md:text-xl">
                                Stop losing to yourself. Start building trading discipline today.
                            </p>
                            <div className="flex justify-center pt-6">
                                <Link
                                    href="/login"
                                    className="bg-temper-bg px-12 py-6 text-sm font-black uppercase tracking-[0.2em] text-temper-teal shadow-[8px_8px_0px_0px_rgba(255,255,255,0.3)] transition-all duration-300 hover:bg-white hover:text-temper-bg"
                                >
                                    Start Free
                                </Link>
                            </div>
                        </div>
                        {/* Background text */}
                        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-[30vw] font-black uppercase leading-none text-temper-bg/5">
                            T
                        </div>
                    </div>

                    {/* Footer */}
                    <footer className="border-t border-temper-bg/10 px-8 py-8">
                        <div className="mx-auto flex max-w-6xl items-center justify-between">
                            <span className="font-coach text-lg font-bold text-temper-bg">Temper</span>
                            <span className="text-xs font-bold uppercase tracking-widest text-temper-bg/50">
                                © {new Date().getFullYear()} All rights reserved
                            </span>
                        </div>
                    </footer>
                </section>
            </main>
        </div>
    );
}
