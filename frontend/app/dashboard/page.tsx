'use client';

import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import { ArrowUpRight, Shield, TrendingUp, AlertTriangle, Plus } from 'lucide-react';

export default function DashboardPage() {
    const container = useRef<HTMLDivElement>(null);

    useGSAP(() => {
        gsap.from('.reveal', {
            opacity: 0,
            y: 20,
            stagger: 0.08,
            duration: 0.8,
            ease: 'power3.out',
        });
    }, { scope: container });

    const stats = [
        { label: 'Temper Score', value: '78', icon: Shield, color: 'text-temper-teal', trend: '+4.2%' },
        { label: 'Decision ELO', value: '1265', icon: TrendingUp, color: 'text-temper-gold', trend: '+15' },
        { label: 'Tilt Frequency', value: '12%', icon: AlertTriangle, color: 'text-temper-red', trend: '-5%', good: true },
    ];

    const sessions = [
        { id: 'demo', date: 'Today, 2:30 PM', score: 72, pnl: '+$195.00', bias: 'Revenge Trading', trades: 6 },
        { id: 'session-124', date: 'Yesterday, 9:30 AM', score: 88, pnl: '+$450.00', bias: 'FOMO', trades: 12 },
        { id: 'session-125', date: 'May 13, 10:00 AM', score: 45, pnl: '-$850.00', bias: 'Tilt', trades: 24 },
        { id: 'session-126', date: 'May 12, 9:30 AM', score: 92, pnl: '+$120.00', bias: 'None', trades: 4 },
    ];

    return (
        <div ref={container} className="min-h-screen bg-gradient-to-br from-temper-bg via-temper-bg to-temper-surface/30 p-8 md:p-12">
            <div className="mx-auto max-w-6xl space-y-12">
                {/* Header */}
                <header className="reveal flex flex-col gap-6 border-b border-temper-border/30 pb-8 md:flex-row md:items-end md:justify-between">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 rounded-full bg-temper-teal/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-temper-teal ring-1 ring-temper-teal/20">
                            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-temper-teal" />
                            System Online
                        </div>
                        <h1 className="font-coach text-5xl font-bold italic tracking-tight text-temper-text md:text-6xl">
                            Dashboard
                        </h1>
                    </div>
                    <Link
                        href="/dashboard/upload"
                        className="group flex items-center gap-4 rounded-2xl bg-temper-surface px-6 py-4 ring-1 ring-temper-border/50 transition-all hover:ring-temper-teal/30"
                    >
                        <span className="text-sm font-bold uppercase tracking-widest text-temper-muted group-hover:text-temper-text">
                            Upload Session
                        </span>
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-temper-teal/10 transition-transform group-hover:rotate-90">
                            <Plus className="h-5 w-5 text-temper-teal" />
                        </div>
                    </Link>
                </header>

                {/* Stats */}
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                    {stats.map((stat) => (
                        <div
                            key={stat.label}
                            className="reveal group rounded-3xl bg-temper-surface/60 p-8 ring-1 ring-temper-border/30 backdrop-blur-xl transition-all hover:ring-temper-teal/20"
                        >
                            <div className="mb-6 flex items-start justify-between">
                                <div className={`rounded-2xl bg-temper-subtle p-3 ${stat.color} ring-1 ring-temper-border/30 transition-colors group-hover:bg-temper-teal/10`}>
                                    <stat.icon className="h-5 w-5" />
                                </div>
                                <div className="h-2 w-2 rounded-full bg-temper-teal/20 transition-colors group-hover:bg-temper-teal" />
                            </div>
                            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-temper-muted">
                                {stat.label}
                            </p>
                            <p className={`font-mono text-4xl font-bold tracking-tight ${stat.color}`}>
                                {stat.value}
                            </p>
                            <p className={`mt-2 text-xs font-semibold ${stat.good ? 'text-temper-teal' : 'text-temper-muted'}`}>
                                {stat.trend} vs last week
                            </p>
                        </div>
                    ))}
                </div>

                {/* Sessions */}
                <section className="space-y-6">
                    <div className="reveal flex items-center justify-between border-b border-temper-border/30 pb-4">
                        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-temper-muted">
                            Recent Sessions
                        </h2>
                        <Link
                            href="/dashboard/sessions"
                            className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-temper-muted transition-colors hover:text-temper-teal"
                        >
                            View All <ArrowUpRight className="h-3 w-3" />
                        </Link>
                    </div>

                    <div className="reveal overflow-hidden rounded-3xl bg-temper-surface/40 ring-1 ring-temper-border/30 backdrop-blur-xl">
                        {sessions.map((session, i) => {
                            const scoreColor =
                                session.score >= 80 ? 'text-temper-teal' : session.score >= 60 ? 'text-temper-gold' : 'text-temper-red';
                            const pnlColor = session.pnl.startsWith('+') ? 'text-temper-teal' : 'text-temper-red';

                            return (
                                <Link
                                    key={session.id}
                                    href={`/dashboard/sessions/${session.id}`}
                                    className={`group flex items-center justify-between p-6 transition-colors hover:bg-temper-subtle/50 ${i !== sessions.length - 1 ? 'border-b border-temper-border/20' : ''
                                        }`}
                                >
                                    <div className="flex items-center gap-4">
                                        <div
                                            className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-temper-subtle font-mono text-lg font-bold ring-1 ring-temper-border/30 ${scoreColor}`}
                                        >
                                            {session.score}
                                        </div>
                                        <div>
                                            <p className="flex items-center gap-2 font-medium text-temper-text transition-colors group-hover:text-temper-teal">
                                                {session.date}
                                                <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                                            </p>
                                            <p className="text-xs text-temper-muted">
                                                {session.trades} trades • {session.bias}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className={`font-mono font-semibold ${pnlColor}`}>{session.pnl}</p>
                                        <p className="text-xs text-temper-muted">P&L</p>
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
