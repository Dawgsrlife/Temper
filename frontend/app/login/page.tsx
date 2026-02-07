'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { Loader2, ArrowLeft } from 'lucide-react';

export default function LoginPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const container = useRef<HTMLDivElement>(null);

    useGSAP(() => {
        gsap.from('.reveal', {
            opacity: 0,
            y: 30,
            stagger: 0.08,
            duration: 0.7,
            ease: 'power3.out',
        });
    }, { scope: container });

    const handleLogin = (provider: string) => {
        setLoading(true);
        setTimeout(() => {
            router.push('/dashboard');
        }, 1200);
    };

    return (
        <div ref={container} className="relative flex min-h-screen items-center justify-center bg-temper-bg">
            {/* Video Background */}
            <div className="fixed inset-0 z-0">
                <video
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="h-full w-full object-cover opacity-40"
                >
                    <source src="/assets/4990245-hd_1920_1080_30fps.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-br from-temper-bg via-temper-bg/95 to-temper-surface/60" />
            </div>

            {/* Content */}
            <div className="relative z-10 w-full max-w-sm px-6">
                {/* Back link */}
                <Link
                    href="/"
                    className="reveal mb-10 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-temper-muted transition-colors hover:text-temper-text"
                >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                </Link>

                {/* Header */}
                <div className="reveal mb-10 space-y-3">
                    <h1 className="text-3xl font-medium tracking-tight text-temper-text">
                        Welcome back
                    </h1>
                    <p className="text-sm text-temper-muted">
                        Sign in to continue to Temper
                    </p>
                </div>

                {/* OAuth Buttons */}
                <div className="reveal space-y-3">
                    <button
                        onClick={() => handleLogin('google')}
                        disabled={loading}
                        className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-6 py-3.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-50"
                    >
                        {loading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <svg className="h-4 w-4" viewBox="0 0 24 24">
                                <path
                                    fill="#4285F4"
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                />
                                <path
                                    fill="#34A853"
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                />
                                <path
                                    fill="#FBBC05"
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                />
                                <path
                                    fill="#EA4335"
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                />
                            </svg>
                        )}
                        Continue with Google
                    </button>

                    <button
                        onClick={() => handleLogin('github')}
                        disabled={loading}
                        className="flex w-full items-center justify-center gap-3 rounded-xl bg-temper-surface px-6 py-3.5 text-sm font-medium text-temper-text ring-1 ring-temper-border/40 transition-all hover:bg-temper-subtle disabled:opacity-50"
                    >
                        {loading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                                <path
                                    fillRule="evenodd"
                                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.532 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                                    clipRule="evenodd"
                                />
                            </svg>
                        )}
                        Continue with GitHub
                    </button>
                </div>

                {/* Terms */}
                <p className="reveal mt-8 text-center text-xs text-temper-muted">
                    By signing in, you agree to our{' '}
                    <span className="text-temper-text/80">Terms</span> and{' '}
                    <span className="text-temper-text/80">Privacy Policy</span>
                </p>
            </div>
        </div>
    );
}
