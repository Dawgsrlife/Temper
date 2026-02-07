'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import { ArrowUpRight, Filter, Search } from 'lucide-react';

export default function SessionsPage() {
    const container = useRef<HTMLDivElement>(null);

    useGSAP(() => {
        gsap.from('.reveal', {
            opacity: 0,
            y: 20,
            stagger: 0.05,
            duration: 0.7,
            ease: 'power3.out',
        });
    }, { scope: container });

    const sessions = [
        { id: 'demo', date: 'Today, 2:30 PM', score: 72, pnl: '+$195.00', bias: 'Revenge Trading', trades: 6 },
        { id: 'session-124', date: 'Yesterday, 9:30 AM', score: 88, pnl: '+$450.00', bias: 'FOMO', trades: 12 },
        { id: 'session-125', date: 'May 13, 10:00 AM', score: 45, pnl: '-$850.00', bias: 'Tilt', trades: 24 },
        { id: 'session-126', date: 'May 12, 9:30 AM', score: 92, pnl: '+$120.00', bias: 'None', trades: 4 },
        { id: 'session-127', date: 'May 11, 11:00 AM', score: 67, pnl: '+$85.00', bias: 'Overtrading', trades: 18 },
        { id: 'session-128', date: 'May 10, 9:30 AM', score: 81, pnl: '+$320.00', bias: 'None', trades: 8 },
    ];

    return (
        <div ref={container} className="min-h-screen bg-gradient-to-br from-temper-bg via-temper-bg to-temper-surface/30 p-8 md:p-12">
            <div className="mx-auto max-w-6xl space-y-10">
                {/* Header */}
                <header className="reveal space-y-2 border-b border-temper-border/30 pb-8">
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-temper-teal">
                        Review History
                    </p>
                    <h1 className="font-coach text-5xl font-bold italic tracking-tight text-temper-text">
                        Sessions
                    </h1>
                </header>

                {/* Filters */}
                <div className="reveal flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-temper-muted" />
                        <input
                            type="text"
                            placeholder="Search sessions..."
                            className="w-full rounded-2xl bg-temper-surface/60 py-3 pl-12 pr-4 text-sm text-temper-text placeholder:text-temper-muted ring-1 ring-temper-border/30 focus:outline-none focus:ring-temper-teal/50 sm:w-72"
                        />
                    </div>
                    <button className="flex items-center gap-2 rounded-xl bg-temper-surface/60 px-4 py-3 text-xs font-bold uppercase tracking-widest text-temper-muted ring-1 ring-temper-border/30 transition-colors hover:text-temper-text">
                        <Filter className="h-4 w-4" />
                        Filter
                    </button>
                </div>

                {/* Sessions Grid */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {sessions.map((session) => {
                        const scoreColor =
                            session.score >= 80 ? 'text-temper-teal bg-temper-teal/10' :
                                session.score >= 60 ? 'text-temper-gold bg-temper-gold/10' :
                                    'text-temper-red bg-temper-red/10';
                        const pnlColor = session.pnl.startsWith('+') ? 'text-temper-teal' : 'text-temper-red';

                        return (
                            <Link
                                key={session.id}
                                href={`/dashboard/sessions/${session.id}`}
                                className="reveal group relative overflow-hidden rounded-3xl bg-temper-surface/50 p-6 ring-1 ring-temper-border/30 backdrop-blur-xl transition-all hover:ring-temper-teal/30"
                            >
                                <div className="mb-6 flex items-start justify-between">
                                    <div className={`flex h-14 w-14 items-center justify-center rounded-2xl font-mono text-xl font-bold ${scoreColor}`}>
                                        {session.score}
                                    </div>
                                    <ArrowUpRight className="h-4 w-4 text-temper-muted opacity-0 transition-all group-hover:opacity-100" />
                                </div>
                                <div className="space-y-1">
                                    <p className="font-medium text-temper-text transition-colors group-hover:text-temper-teal">
                                        {session.date}
                                    </p>
                                    <p className="text-xs text-temper-muted">
                                        {session.trades} trades • {session.bias}
                                    </p>
                                </div>
                                <div className="mt-4 pt-4 border-t border-temper-border/20">
                                    <p className={`font-mono text-lg font-semibold ${pnlColor}`}>{session.pnl}</p>
                                </div>
                                {/* Hover bar */}
                                <div className="absolute bottom-0 left-0 right-0 h-1 origin-left scale-x-0 bg-temper-teal transition-transform duration-500 group-hover:scale-x-100" />
                            </Link>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
