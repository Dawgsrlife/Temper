'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

if (typeof window !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
}

export default function LandingPage() {
    const containerRef = useRef<HTMLDivElement>(null);
    const heroRef = useRef<HTMLDivElement>(null);

    useGSAP(() => {
        // Hero content fade on scroll
        if (heroRef.current) {
            gsap.to('.hero-content', {
                yPercent: -20,
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
                y: 40,
                opacity: 0,
                duration: 0.8,
                ease: 'power3.out',
                scrollTrigger: {
                    trigger: el,
                    start: 'top 90%',
                    toggleActions: 'play none none reverse',
                },
            });
        });

        // Stagger feature cards
        gsap.from('.feature-card', {
            y: 60,
            opacity: 0,
            duration: 0.8,
            stagger: 0.15,
            ease: 'power3.out',
            scrollTrigger: {
                trigger: '.features-grid',
                start: 'top 80%',
            },
        });
    }, { scope: containerRef });

    return (
        <div ref={containerRef} className="bg-temper-bg text-temper-text">
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
                    <source src="/assets/4990245-hd_1920_1080_30fps.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-b from-temper-bg/80 via-temper-bg/60 to-temper-bg" />
            </div>

            {/* Fixed Header */}
            <header className="fixed left-0 right-0 top-0 z-50 px-6 py-5 md:px-12">
                <div className="mx-auto flex max-w-7xl items-center justify-between">
                    <Link href="/" className="font-coach text-xl font-bold tracking-tight text-temper-text">
                        Temper
                    </Link>
                    <Link
                        href="/login"
                        className="rounded-lg bg-temper-teal px-6 py-2.5 text-xs font-semibold uppercase tracking-wider text-temper-bg transition-all duration-300 hover:bg-white"
                    >
                        Get Started
                    </Link>
                </div>
            </header>

            {/* Main content */}
            <main className="relative z-10">
                {/* Hero Section - Minimal */}
                <section ref={heroRef} className="relative flex min-h-screen items-center justify-center px-6 pt-20">
                    <div className="hero-content w-full max-w-4xl text-center">
                        <h1 className="mb-6 text-5xl font-medium leading-[1.1] tracking-tight md:text-7xl lg:text-8xl">
                            Review your trades.
                            <br />
                            <span className="text-temper-teal">Build discipline.</span>
                        </h1>
                        <p className="mx-auto mb-10 max-w-lg text-base leading-relaxed text-temper-muted md:text-lg">
                            Temper analyzes your trading sessions to identify emotional patterns
                            and help you make better decisions.
                        </p>
                        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                            <Link
                                href="/dashboard/sessions/demo"
                                className="group flex items-center gap-2 rounded-lg bg-temper-teal px-8 py-4 text-sm font-semibold text-temper-bg transition-all duration-300 hover:bg-white"
                            >
                                Try Demo
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                            </Link>
                            <Link
                                href="/login"
                                className="rounded-lg border border-temper-border px-8 py-4 text-sm font-semibold text-temper-text transition-all duration-300 hover:border-temper-muted hover:bg-temper-surface/50"
                            >
                                Sign In
                            </Link>
                        </div>
                    </div>
                </section>

                {/* Features Section */}
                <section className="relative bg-temper-bg px-6 py-32 md:px-12">
                    <div className="mx-auto max-w-6xl">
                        <div className="reveal mb-16 text-center">
                            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-temper-teal">
                                How it works
                            </p>
                            <h2 className="text-3xl font-medium tracking-tight md:text-4xl lg:text-5xl">
                                Simple. Effective. Honest.
                            </h2>
                        </div>

                        <div className="features-grid grid gap-6 md:grid-cols-3">
                            {[
                                {
                                    step: '01',
                                    title: 'Upload',
                                    description: 'Import your trade history from any broker. CSV format supported.',
                                },
                                {
                                    step: '02',
                                    title: 'Analyze',
                                    description: 'Our algorithm identifies revenge sequences, FOMO entries, and discipline breaks.',
                                },
                                {
                                    step: '03',
                                    title: 'Improve',
                                    description: 'Review each decision with annotations showing what went wrong and why.',
                                },
                            ].map((feature) => (
                                <div
                                    key={feature.step}
                                    className="feature-card group rounded-2xl bg-temper-surface/50 p-8 ring-1 ring-temper-border/30 transition-all duration-300 hover:bg-temper-surface hover:ring-temper-teal/30"
                                >
                                    <div className="mb-6 text-xs font-semibold uppercase tracking-widest text-temper-teal">
                                        {feature.step}
                                    </div>
                                    <h3 className="mb-3 text-xl font-medium">{feature.title}</h3>
                                    <p className="text-sm leading-relaxed text-temper-muted">
                                        {feature.description}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Product Preview Section */}
                <section className="relative bg-temper-surface px-6 py-32 md:px-12">
                    <div className="mx-auto max-w-6xl">
                        <div className="grid items-center gap-16 lg:grid-cols-2">
                            <div className="space-y-6">
                                <p className="reveal text-xs font-semibold uppercase tracking-widest text-temper-teal">
                                    Session Review
                                </p>
                                <h2 className="reveal text-3xl font-medium leading-tight tracking-tight md:text-4xl">
                                    Every trade.
                                    <br />
                                    Every decision.
                                    <br />
                                    Annotated.
                                </h2>
                                <p className="reveal max-w-md text-base leading-relaxed text-temper-muted">
                                    See exactly where discipline broke down. Each trade is labeled
                                    with its psychological context—was it planned, reactive, or revenge?
                                </p>
                                <Link
                                    href="/dashboard/sessions/demo"
                                    className="reveal inline-flex items-center gap-2 text-sm font-semibold text-temper-teal transition-colors hover:text-white"
                                >
                                    View demo session
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                            </div>
                            <div className="reveal relative overflow-hidden rounded-2xl bg-temper-bg ring-1 ring-temper-border/30">
                                <Image
                                    src="/assets/pexels-robert-clark-504241532-21036037.jpg"
                                    alt="Trading Analysis"
                                    width={800}
                                    height={600}
                                    className="h-auto w-full object-cover opacity-80"
                                />
                            </div>
                        </div>
                    </div>
                </section>

                {/* CTA Section */}
                <section className="relative bg-temper-teal px-6 py-24 md:px-12">
                    <div className="mx-auto max-w-4xl text-center">
                        <h2 className="reveal mb-6 text-3xl font-medium tracking-tight text-temper-bg md:text-4xl lg:text-5xl">
                            Stop losing to yourself.
                        </h2>
                        <p className="reveal mx-auto mb-10 max-w-lg text-base text-temper-bg/70">
                            Most traders fail not because of bad strategy, but because of bad psychology.
                            Fix the root cause.
                        </p>
                        <Link
                            href="/login"
                            className="reveal inline-block rounded-lg bg-temper-bg px-10 py-4 text-sm font-semibold text-temper-teal transition-all duration-300 hover:bg-white"
                        >
                            Start Free
                        </Link>
                    </div>
                </section>

                {/* Footer */}
                <footer className="border-t border-temper-border/20 bg-temper-bg px-6 py-8">
                    <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 sm:flex-row sm:justify-between">
                        <span className="font-coach text-lg font-bold text-temper-text">Temper</span>
                        <div className="flex flex-col items-center gap-1 sm:items-end">
                            <span className="text-xs text-temper-muted">
                                National Bank of Canada — Electronic Trading Technology
                            </span>
                            <span className="text-[10px] text-temper-muted/60">
                                © {new Date().getFullYear()} Bias Detector Challenge
                            </span>
                        </div>
                    </div>
                </footer>
            </main>
        </div>
    );
}
