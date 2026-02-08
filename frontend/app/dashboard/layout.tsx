'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  LayoutDashboard,
  History,
  Upload,
  Settings,
  BookOpen,
  Activity,
  LogOut,
  Menu,
  X,
  Network,
  Trophy,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

const navigation = [
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Journal', href: '/dashboard/journal', icon: BookOpen },
  { name: 'Analyze', href: '/dashboard/analyze', icon: Activity },
  { name: 'Explorer', href: '/dashboard/explorer', icon: Network },
  { name: 'Leaderboard', href: '/dashboard/leaderboard', icon: Trophy },
  { name: 'Sessions', href: '/dashboard/sessions', icon: History },
  { name: 'Upload', href: '/dashboard/upload', icon: Upload },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useGSAP(() => {
    if (!mounted) return;
    gsap.set('.sidebar-nav-item', { clearProps: 'all' });
    gsap.fromTo('.sidebar-nav-item', 
      { x: -20, autoAlpha: 0 },
      { x: 0, autoAlpha: 1, stagger: 0.04, duration: 0.4, ease: 'power3.out' }
    );
  }, { scope: sidebarRef, dependencies: [mounted] });

  useGSAP(() => {
    if (isMobileMenuOpen) {
      gsap.to('.mobile-menu', { x: 0, duration: 0.3, ease: 'power3.out' });
    } else {
      gsap.to('.mobile-menu', { x: '-100%', duration: 0.3, ease: 'power3.in' });
    }
  }, [isMobileMenuOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0a] text-white selection:bg-emerald-500/30 selection:text-white">
      {/* Desktop Sidebar */}
      <aside ref={sidebarRef} className="hidden w-[260px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0a] lg:flex">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-white/[0.06] px-6">
          <Link href="/" className="flex items-center gap-2.5 group">
            <Image src="/Temper_logo.png" alt="Temper" width={32} height={32} className="rounded-lg transition-transform group-hover:scale-110" />
            <span className="font-coach text-lg font-bold tracking-tight text-white">Temper</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-3 py-5">
          {navigation.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`sidebar-nav-item group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${isActive
                    ? 'bg-emerald-500/[0.08] text-white shadow-sm shadow-emerald-500/5'
                    : 'text-gray-400 hover:bg-white/[0.06] hover:text-white'
                  }`}
              >
                <item.icon className={`h-[18px] w-[18px] transition-colors ${isActive ? 'text-emerald-400' : 'text-gray-500 group-hover:text-gray-300'}`} />
                {item.name}
                {isActive && <div className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />}
              </Link>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="border-t border-white/[0.06] p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] p-3">
            <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-emerald-500 to-cyan-400 flex items-center justify-center text-xs font-bold text-black">AT</div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium text-white">Alex Trader</p>
              <p className="truncate text-[11px] text-gray-400">Pro Plan</p>
            </div>
              <Link href="/login" className="cursor-pointer text-gray-600 hover:text-red-400 transition-colors">
              <LogOut className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile Header */}
        <header className="flex h-14 items-center justify-between border-b border-white/[0.06] bg-[#0a0a0a] px-4 lg:hidden">
          <div className="flex items-center gap-2.5">
            <Image src="/Temper_logo.png" alt="Temper" width={28} height={28} className="rounded-lg" />
            <span className="font-coach text-base font-bold">Temper</span>
          </div>
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-gray-500 hover:text-white">
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </header>

        {/* Mobile Menu */}
        <div className="mobile-menu fixed inset-0 z-50 flex flex-col bg-[#0a0a0a] lg:hidden" style={{ transform: 'translateX(-100%)' }}>
          <div className="flex h-14 items-center justify-between px-4 border-b border-white/[0.06]">
            <span className="font-coach text-base font-bold">Menu</span>
            <button onClick={() => setIsMobileMenuOpen(false)}>
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
          <nav className="flex-1 space-y-1 p-4">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link key={item.name} href={item.href} onClick={() => setIsMobileMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium ${isActive ? 'bg-white/[0.08] text-white' : 'text-gray-400'}`}>
                  <item.icon className={isActive ? 'text-emerald-400' : 'text-gray-600'} />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto bg-[#0a0a0a]">
          {children}
        </main>
      </div>
    </div>
  );
}
