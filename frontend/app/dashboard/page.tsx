'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import { ArrowUpRight, Shield, TrendingUp, AlertTriangle, Plus } from 'lucide-react';

export default function DashboardPage() {
    const container = useRef<HTMLDivElement>(null);

    useGSAP(() => {
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

        tl.from('.header-content', { y: 20, opacity: 0, duration: 0.6 })
            .from('.stat-card', { y: 30, opacity: 0, stagger: 0.1, duration: 0.5 }, '-=0.3')
            .from('.session-item', { y: 20, opacity: 0, stagger: 0.08, duration: 0.4 }, '-=0.2');
    }, { scope: container });

    const stats = [
        { label: 'Discipline Score', value: '78', icon: Shield, color: 'temper-teal', trend: '+4 pts' },
        { label: 'Win Rate', value: '62%', icon: TrendingUp, color: 'temper-gold', trend: '+8%' },
        { label: 'Tilt Events', value: '3', icon: AlertTriangle, color: 'temper-red', trend: '-2 this week' },
    ];

    const sessions = [
        { id: 'demo', date: 'Today', time: '2:30 PM', score: 72, pnl: '+$195', trades: 6, label: 'Revenge Pattern' },
        { id: '124', date: 'Yesterday', time: '9:30 AM', score: 88, pnl: '+$450', trades: 12, label: 'Clean Session' },
        { id: '125', date: 'May 13', time: '10:00 AM', score: 45, pnl: '-$850', trades: 24, label: 'Tilt' },
        { id: '126', date: 'May 12', time: '9:30 AM', score: 92, pnl: '+$120', trades: 4, label: 'Textbook' },
    ];

    return (
        <div ref={container} className="px-6 py-8 md:px-10 md:py-10 lg:px-12">
            <div className="mx-auto max-w-5xl space-y-10">
                {/* Header */}
                <header className="header-content flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
                    <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wider text-temper-teal">
                            Dashboard
                        </p>
                        <h1 className="text-3xl font-medium tracking-tight text-temper-text md:text-4xl">
                            Overview
                        </h1>
                    </div>
                    <Link
                        href="/dashboard/upload"
                        className="group flex items-center gap-3 rounded-xl bg-temper-surface px-5 py-3 ring-1 ring-temper-border/30 transition-all hover:ring-temper-teal/40"
                    >
                        <span className="text-sm font-medium text-temper-muted group-hover:text-temper-text">
                            New Session
                        </span>
                        <Plus className="h-4 w-4 text-temper-teal" />
                    </Link>
                </header>

                {/* Stats Grid */}
                <div className="grid gap-4 sm:grid-cols-3">
                    {stats.map((stat) => (
                        <div
                            key={stat.label}
                            className="stat-card group rounded-2xl bg-temper-surface/60 p-6 ring-1 ring-temper-border/20 transition-all hover:ring-temper-border/40"
                        >
                            <div className="mb-4 flex items-center justify-between">
                                <div className={`rounded-xl bg-${stat.color}/10 p-2.5`}>
                                    <stat.icon className={`h-4 w-4 text-${stat.color}`} />
                                </div>
                            </div>
                            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-temper-muted">
                                {stat.label}
                            </p>
                            <p className="text-3xl font-semibold tracking-tight text-temper-text">
                                {stat.value}
                            </p>
                            <p className="mt-2 text-xs text-temper-muted">{stat.trend}</p>
                        </div>
                    ))}
                </div>

                {/* Sessions List */}
                <section className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-medium uppercase tracking-wider text-temper-muted">
                            Recent Sessions
                        </h2>
                        <Link
                            href="/dashboard/sessions"
                            className="flex items-center gap-1.5 text-xs font-medium text-temper-muted transition-colors hover:text-temper-teal"
                        >
                            View all <ArrowUpRight className="h-3 w-3" />
                        </Link>
                    </div>

                    <div className="divide-y divide-temper-border/10 overflow-hidden rounded-2xl bg-temper-surface/40 ring-1 ring-temper-border/20">
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
                                    className="session-item group flex items-center justify-between p-5 transition-colors hover:bg-temper-subtle/40"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold ${scoreColor}`}>
                                            {session.score}
                                        </div>
                                        <div>
                                            <p className="flex items-center gap-2 text-sm font-medium text-temper-text">
                                                {session.date} <span className="text-temper-muted">·</span> <span className="text-temper-muted">{session.time}</span>
                                            </p>
                                            <p className="text-xs text-temper-muted">
                                                {session.trades} trades · {session.label}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className={`font-mono text-sm font-medium ${pnlColor}`}>
                                            {session.pnl}
                                        </span>
                                        <ArrowUpRight className="h-4 w-4 text-temper-muted opacity-0 transition-opacity group-hover:opacity-100" />
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </section>
            </div>
        </div>
    );
}
