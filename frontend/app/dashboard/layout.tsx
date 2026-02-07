'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
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

  const navItems = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/dashboard/sessions', icon: History, label: 'Sessions' },
    { href: '/dashboard/upload', icon: Upload, label: 'Upload' },
    { href: '/dashboard/demo', icon: LineChart, label: 'Demo' },
  ];

  const bottomItems = [
    { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-temper-bg via-temper-bg to-temper-surface/20">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-temper-bg/80 backdrop-blur-2xl transition-all duration-300 md:relative md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'
          } ${collapsed ? 'w-20' : 'w-72'}`}
      >
        {/* Sidebar gradient border */}
        <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-temper-border/30 to-transparent" />

        {/* Header */}
        <div
          className={`flex h-20 items-center border-b border-temper-border/10 ${collapsed ? 'justify-center px-4' : 'justify-between px-6'
            }`}
        >
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-temper-teal font-coach text-xl font-bold text-temper-bg shadow-lg shadow-temper-teal/20">
              T
            </div>
            {!collapsed && (
              <span className="font-coach text-xl font-bold text-temper-teal">
                Temper
              </span>
            )}
          </Link>

          {/* Collapse toggle (desktop) */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`hidden rounded-xl p-2 text-temper-muted transition-all hover:bg-temper-surface hover:text-temper-text md:block ${collapsed ? 'absolute -right-3 top-7 bg-temper-surface ring-1 ring-temper-border/30' : ''
              }`}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>

          {/* Mobile close */}
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-xl p-2 text-temper-muted transition-colors hover:bg-temper-surface hover:text-temper-text md:hidden"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-6">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-all ${isActive
                    ? 'bg-temper-teal/10 text-temper-teal'
                    : 'text-temper-muted hover:bg-temper-surface/50 hover:text-temper-text'
                  } ${collapsed ? 'justify-center' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon
                  size={20}
                  className={isActive ? 'text-temper-teal' : 'text-temper-muted group-hover:text-temper-text'}
                />
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
                className={`group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-all ${isActive
                    ? 'bg-temper-teal/10 text-temper-teal'
                    : 'text-temper-muted hover:bg-temper-surface/50 hover:text-temper-text'
                  } ${collapsed ? 'justify-center' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon
                  size={20}
                  className={isActive ? 'text-temper-teal' : 'text-temper-muted group-hover:text-temper-text'}
                />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}

          <button
            className={`mt-1 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-temper-red/70 transition-all hover:bg-temper-red/10 hover:text-temper-red ${collapsed ? 'justify-center' : ''
              }`}
            title={collapsed ? 'Sign Out' : undefined}
          >
            <LogOut size={20} />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="relative flex-1 overflow-auto">
        {/* Mobile header */}
        <div className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-temper-border/10 bg-temper-bg/80 px-6 backdrop-blur-xl md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-xl p-2 text-temper-muted transition-colors hover:bg-temper-surface hover:text-temper-text"
          >
            <Menu size={20} />
          </button>
          <span className="font-coach text-xl font-bold text-temper-teal">Temper</span>
        </div>

        {children}
      </main>
    </div>
  );
}
