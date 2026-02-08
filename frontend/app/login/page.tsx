'use client';

import { useRef, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft } from 'lucide-react';

export default function LoginPage() {
    const container = useRef<HTMLDivElement>(null);
    const [mounted, setMounted] = useState(false);
    const router = useRouter();

    useEffect(() => {
        setMounted(true);
    }, []);

    useGSAP(() => {
        if (!mounted) return;

        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.from('.login-card', { y: 60, opacity: 0, scale: 0.95, duration: 0.8 })
            .from('.card-content > *', { y: 20, opacity: 0, stagger: 0.1, duration: 0.5 }, '-=0.4');
    }, { scope: container, dependencies: [mounted] });

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        router.push('/dashboard');
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
                    className="h-full w-full object-cover"
                >
                    <source src="/assets/4990245-hd_1920_1080_30fps.mp4" type="video/mp4" />
                </video>
                <div className="absolute inset-0 bg-gradient-to-b from-temper-bg/80 via-temper-bg/60 to-temper-bg" />
            </div>

            {/* Back Link */}
            <Link
                href="/"
                className="fixed left-6 top-6 z-20 flex items-center gap-2 text-sm text-temper-muted transition-colors hover:text-temper-text"
            >
                <ArrowLeft className="h-4 w-4" />
                Back to home
            </Link>

            {/* Login Card */}
            <div className="login-card relative z-10 w-full max-w-md px-6">
                <div className="glass-card rounded-3xl p-10">
                    <div className="card-content space-y-8">
                        {/* Logo */}
                        <div className="flex flex-col items-center gap-3">
                            <div className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl">
                                <Image src="/Temper_logo.png" alt="Temper" width={56} height={56} className="rounded-2xl" />
                            </div>
                            <h1 className="font-coach text-2xl font-bold text-temper-text">
                                Welcome back
                            </h1>
                            <p className="text-center text-sm text-temper-muted">
                                Sign in to continue to Temper
                            </p>
                        </div>

                        {/* OAuth Buttons */}
                        <div className="space-y-3">
                            <button
                                onClick={() => router.push('/dashboard')}
                                className="group flex w-full items-center justify-center gap-3 rounded-xl bg-white px-6 py-4 text-sm font-semibold text-gray-900 transition-all hover:bg-gray-100"
                            >
                                <svg className="h-5 w-5" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                </svg>
                                Continue with Google
                            </button>

                            <button
                                onClick={() => router.push('/dashboard')}
                                className="group flex w-full items-center justify-center gap-3 rounded-xl bg-[#24292f] px-6 py-4 text-sm font-semibold text-white transition-all hover:bg-[#3a3f45]"
                            >
                                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                                    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.607.069-.607 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                                </svg>
                                Continue with GitHub
                            </button>
                        </div>

                        {/* Divider */}
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-temper-border/20" />
                            </div>
                            <div className="relative flex justify-center">
                                <span className="bg-temper-surface px-3 text-xs text-temper-muted">
                                    or continue with email
                                </span>
                            </div>
                        </div>

                        {/* Email Form */}
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div>
                                <input
                                    type="email"
                                    placeholder="Email address"
                                    className="w-full rounded-xl bg-temper-subtle/50 px-4 py-3.5 text-sm text-temper-text placeholder:text-temper-muted ring-1 ring-temper-border/20 transition-all focus:outline-none focus:ring-2 focus:ring-temper-teal/50"
                                />
                            </div>
                            <button
                                type="submit"
                                className="w-full rounded-xl bg-temper-teal px-6 py-3.5 text-sm font-semibold text-temper-bg transition-all hover:bg-white"
                            >
                                Continue with Email
                            </button>
                        </form>

                        {/* Terms */}
                        <p className="text-center text-xs text-temper-muted">
                            By continuing, you agree to our{' '}
                            <Link href="#" className="text-temper-text underline-offset-4 hover:underline">
                                Terms
                            </Link>{' '}
                            and{' '}
                            <Link href="#" className="text-temper-text underline-offset-4 hover:underline">
                                Privacy Policy
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
