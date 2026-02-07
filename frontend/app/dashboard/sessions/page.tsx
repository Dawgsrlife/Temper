'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import { ArrowUpRight, Search } from 'lucide-react';

export default function SessionsPage() {
    const container = useRef<HTMLDivElement>(null);

    useGSAP(() => {
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.from('.page-header', { y: 20, opacity: 0, duration: 0.5 })
            .from('.session-card', { y: 30, opacity: 0, stagger: 0.08, duration: 0.4 }, '-=0.2');
    }, { scope: container });

    const sessions = [
        { id: 'demo', date: 'Today', time: '2:30 PM', score: 72, pnl: '+$195', trades: 6, label: 'Revenge Pattern' },
        { id: '124', date: 'Yesterday', time: '9:30 AM', score: 88, pnl: '+$450', trades: 12, label: 'Clean Session' },
        { id: '125', date: 'May 13', time: '10:00 AM', score: 45, pnl: '-$850', trades: 24, label: 'Tilt' },
        { id: '126', date: 'May 12', time: '9:30 AM', score: 92, pnl: '+$120', trades: 4, label: 'Textbook' },
        { id: '127', date: 'May 11', time: '11:00 AM', score: 67, pnl: '+$85', trades: 18, label: 'Overtrading' },
        { id: '128', date: 'May 10', time: '9:30 AM', score: 81, pnl: '+$320', trades: 8, label: 'Good Discipline' },
    ];

    return (
        <div ref={container} className="px-6 py-8 md:px-10 md:py-10 lg:px-12">
            <div className="mx-auto max-w-5xl space-y-8">
                {/* Header */}
                <header className="page-header space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wider text-temper-teal">
                        History
                    </p>
                    <h1 className="text-3xl font-medium tracking-tight text-temper-text">
                        Sessions
                    </h1>
                </header>

                {/* Search */}
                <div className="page-header relative">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-temper-muted" />
                    <input
                        type="text"
                        placeholder="Search sessions..."
                        className="w-full rounded-xl bg-temper-surface/60 py-3 pl-11 pr-4 text-sm text-temper-text placeholder:text-temper-muted ring-1 ring-temper-border/20 focus:outline-none focus:ring-temper-teal/40 sm:max-w-xs"
                    />
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
                                className="session-card group relative overflow-hidden rounded-2xl bg-temper-surface/50 p-5 ring-1 ring-temper-border/20 transition-all hover:bg-temper-surface hover:ring-temper-border/40"
                            >
                                <div className="mb-5 flex items-start justify-between">
                                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-semibold ${scoreColor}`}>
                                        {session.score}
                                    </div>
                                    <ArrowUpRight className="h-4 w-4 text-temper-muted opacity-0 transition-opacity group-hover:opacity-100" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-temper-text">
                                        {session.date} · {session.time}
                                    </p>
                                    <p className="text-xs text-temper-muted">
                                        {session.trades} trades · {session.label}
                                    </p>
                                </div>
                                <div className="mt-4 border-t border-temper-border/10 pt-4">
                                    <span className={`font-mono text-lg font-semibold ${pnlColor}`}>
                                        {session.pnl}
                                    </span>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
