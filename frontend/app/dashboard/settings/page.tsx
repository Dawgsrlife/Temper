'use client';

import { useRef, useEffect, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRouter } from 'next/navigation';
import { Bell, Shield, LogOut, Trash2, User, Palette } from 'lucide-react';

function Toggle({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      onClick={() => setOn(!on)}
      className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
        on ? 'bg-emerald-500' : 'bg-white/[0.10]'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function SettingsPage() {
  const container = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  useGSAP(
    () => {
      if (!mounted) return;
      gsap.set('.settings-section', { clearProps: 'all' });
      gsap.fromTo('.settings-section',
        { y: 20, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, stagger: 0.1, duration: 0.5, ease: 'power3.out' }
      );
    },
    { scope: container, dependencies: [mounted] },
  );

  const handleClearData = () => {
    localStorage.removeItem('temper_current_session');
    localStorage.removeItem('temper_journal_entries');
    window.location.reload();
  };

  return (
    <div
      ref={container}
      className="h-full overflow-y-auto overflow-x-hidden bg-[#0a0a0a] px-6 py-8 text-white md:px-10 md:py-10 lg:px-12"
    >
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Configuration
          </p>
          <h1 className="font-coach text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Settings
          </h1>
          <p className="text-sm text-gray-400">
            Manage your account and preferences.
          </p>
        </header>

        <div className="space-y-6">
          {/* Profile */}
          <section className="settings-section rounded-2xl border border-white/[0.06] bg-white/[0.04] p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-400/10 p-2 text-emerald-400">
                <User className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-white">Profile</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Display Name</p>
                  <p className="text-xs text-gray-400">Shown on your dashboard.</p>
                </div>
                <input
                  type="text"
                  defaultValue="Trader"
                  className="w-40 rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-right text-sm text-white outline-none focus:border-emerald-400/40"
                />
              </div>
            </div>
          </section>

          {/* Notifications */}
          <section className="settings-section rounded-2xl border border-white/[0.06] bg-white/[0.04] p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-lg bg-blue-400/10 p-2 text-blue-400">
                <Bell className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-white">Notifications</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Email Alerts</p>
                  <p className="text-xs text-gray-400">
                    Receive weekly summaries of your trading psychology.
                  </p>
                </div>
                <Toggle />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Bias Warnings</p>
                  <p className="text-xs text-gray-400">
                    Get notified when a bias pattern is detected.
                  </p>
                </div>
                <Toggle defaultOn />
              </div>
            </div>
          </section>

          {/* Privacy */}
          <section className="settings-section rounded-2xl border border-white/[0.06] bg-white/[0.04] p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-lg bg-purple-400/10 p-2 text-purple-400">
                <Shield className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-white">Privacy</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Data Sharing</p>
                  <p className="text-xs text-gray-400">
                    Allow anonymized data usage for model improvements.
                  </p>
                </div>
                <Toggle defaultOn />
              </div>
            </div>
          </section>

          {/* Appearance */}
          <section className="settings-section rounded-2xl border border-white/[0.06] bg-white/[0.04] p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-lg bg-yellow-400/10 p-2 text-yellow-400">
                <Palette className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-white">Appearance</h2>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">Theme</p>
                <p className="text-xs text-gray-400">Select your preferred color scheme.</p>
              </div>
              <div className="flex gap-2">
                <button className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-400">
                  Dark
                </button>
                <button className="shrink-0 cursor-pointer rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-400">
                  Light
                </button>
              </div>
            </div>
          </section>

          {/* Danger Zone */}
          <section className="settings-section rounded-2xl border border-red-400/20 bg-red-400/5 p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-lg bg-red-400/10 p-2 text-red-400">
                <Trash2 className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-red-400">Danger Zone</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Clear Local Data</p>
                  <p className="text-xs text-gray-400">
                    Remove all saved sessions and journal entries from this browser.
                  </p>
                </div>
                <button
                  onClick={handleClearData}
                  className="shrink-0 cursor-pointer rounded-lg bg-red-400/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-400/20"
                >
                  Clear Data
                </button>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Sign Out</p>
                  <p className="text-xs text-gray-400">Log out of your account.</p>
                </div>
                <button
                  onClick={() => router.push('/login')}
                  className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg bg-white/[0.06] px-4 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-white/[0.10] hover:text-white"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
