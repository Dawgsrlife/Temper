'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  LayoutDashboard,
  History,
  Upload,
  Settings,
  LogOut,
  LineChart,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const sidebarRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    gsap.from(sidebarRef.current, {
      x: -20,
      opacity: 0,
      duration: 0.5,
      ease: 'power3.out',
    });
  }, { scope: sidebarRef });

  const navItems = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Overview' },
    { href: '/dashboard/sessions', icon: History, label: 'Sessions' },
    { href: '/dashboard/upload', icon: Upload, label: 'Upload' },
    { href: '/dashboard/demo', icon: LineChart, label: 'Demo' },
  ];

  const bottomItems = [
    { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="flex min-h-screen bg-temper-bg">
      {/* Subtle gradient background */}
      <div className="fixed inset-0 z-0 bg-gradient-to-br from-temper-bg via-temper-bg to-temper-surface/20" />

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-temper-border/10 bg-temper-bg/95 backdrop-blur-xl transition-all duration-300 md:relative md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'
          } ${collapsed ? 'w-20' : 'w-64'}`}
      >
        {/* Header */}
        <div
          className={`flex h-16 items-center border-b border-temper-border/10 ${collapsed ? 'justify-center px-4' : 'justify-between px-5'
            }`}
        >
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-temper-teal font-coach text-sm font-bold text-temper-bg">
              T
            </div>
            {!collapsed && (
              <span className="font-coach text-lg font-bold text-temper-text">
                Temper
              </span>
            )}
          </Link>

          {/* Collapse toggle (desktop) */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`hidden rounded-lg p-1.5 text-temper-muted transition-colors hover:bg-temper-surface hover:text-temper-text md:block ${collapsed ? 'absolute -right-3 top-5 bg-temper-surface ring-1 ring-temper-border/20' : ''
              }`}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>

          {/* Mobile close */}
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-lg p-1.5 text-temper-muted hover:bg-temper-surface hover:text-temper-text md:hidden"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${isActive
                    ? 'bg-temper-teal/10 text-temper-teal'
                    : 'text-temper-muted hover:bg-temper-surface/60 hover:text-temper-text'
                  } ${collapsed ? 'justify-center' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={18} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="border-t border-temper-border/10 p-3">
          {bottomItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${isActive
                    ? 'bg-temper-teal/10 text-temper-teal'
                    : 'text-temper-muted hover:bg-temper-surface/60 hover:text-temper-text'
                  } ${collapsed ? 'justify-center' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={18} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}

          <button
            className={`mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-temper-red/70 transition-all hover:bg-temper-red/10 hover:text-temper-red ${collapsed ? 'justify-center' : ''
              }`}
            title={collapsed ? 'Sign Out' : undefined}
          >
            <LogOut size={18} />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="relative z-10 flex-1">
        {/* Mobile header */}
        <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-temper-border/10 bg-temper-bg/90 px-4 backdrop-blur-xl md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-1.5 text-temper-muted hover:bg-temper-surface hover:text-temper-text"
          >
            <Menu size={18} />
          </button>
          <span className="font-coach text-lg font-bold text-temper-text">Temper</span>
        </div>

        <div className="min-h-screen">{children}</div>
      </main>
    </div>
  );
}
