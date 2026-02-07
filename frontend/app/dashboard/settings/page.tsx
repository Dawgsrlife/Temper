'use client';

import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { User, Bell, Shield, Moon, Eye, Trash2 } from 'lucide-react';

interface SettingItem {
    id: string;
    title: string;
    description: string;
    enabled: boolean;
}

interface SettingGroup {
    title: string;
    icon: typeof User;
    items: SettingItem[];
}

export default function SettingsPage() {
    const container = useRef<HTMLDivElement>(null);

    const [settings, setSettings] = useState<SettingGroup[]>([
        {
            title: 'Notifications',
            icon: Bell,
            items: [
                { id: 'email', title: 'Email Alerts', description: 'Daily discipline reports and tilt warnings', enabled: true },
                { id: 'browser', title: 'Browser Notifications', description: 'Real-time alerts when reviewing sessions', enabled: false },
            ],
        },
        {
            title: 'Privacy',
            icon: Shield,
            items: [
                { id: 'analytics', title: 'Usage Analytics', description: 'Help improve Temper with anonymous data', enabled: true },
                { id: 'share', title: 'Share Sessions', description: 'Allow sharing session reviews with others', enabled: false },
            ],
        },
        {
            title: 'Appearance',
            icon: Eye,
            items: [
                { id: 'dark', title: 'Dark Mode', description: 'Always use dark theme', enabled: true },
                { id: 'compact', title: 'Compact View', description: 'Reduce spacing for denser layouts', enabled: false },
            ],
        },
    ]);

    useGSAP(() => {
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        tl.from('.page-header', { y: 20, opacity: 0, duration: 0.5 })
            .from('.settings-group', { y: 30, opacity: 0, stagger: 0.1, duration: 0.4 }, '-=0.2');
    }, { scope: container });

    const toggleSetting = (groupIndex: number, itemId: string) => {
        setSettings(prev => {
            const newSettings = [...prev];
            const group = newSettings[groupIndex];
            const itemIndex = group.items.findIndex(i => i.id === itemId);
            if (itemIndex !== -1) {
                group.items[itemIndex].enabled = !group.items[itemIndex].enabled;
            }
            return newSettings;
        });
    };

    return (
        <div ref={container} className="px-6 py-8 md:px-10 md:py-10 lg:px-12">
            <div className="mx-auto max-w-2xl space-y-10">
                {/* Header */}
                <header className="page-header space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wider text-temper-teal">
                        Preferences
                    </p>
                    <h1 className="text-3xl font-medium tracking-tight text-temper-text">
                        Settings
                    </h1>
                </header>

                {/* Settings Groups */}
                {settings.map((group, groupIndex) => (
                    <section key={group.title} className="settings-group space-y-3">
                        <div className="flex items-center gap-2.5">
                            <group.icon className="h-4 w-4 text-temper-teal" />
                            <h2 className="text-sm font-medium uppercase tracking-wider text-temper-muted">
                                {group.title}
                            </h2>
                        </div>

                        <div className="divide-y divide-temper-border/10 overflow-hidden rounded-2xl bg-temper-surface/50 ring-1 ring-temper-border/20">
                            {group.items.map((item) => (
                                <div
                                    key={item.id}
                                    className="flex items-center justify-between p-5"
                                >
                                    <div className="space-y-0.5">
                                        <p className="text-sm font-medium text-temper-text">{item.title}</p>
                                        <p className="text-xs text-temper-muted">{item.description}</p>
                                    </div>
                                    <button
                                        onClick={() => toggleSetting(groupIndex, item.id)}
                                        className={`relative h-6 w-11 rounded-full transition-colors ${item.enabled ? 'bg-temper-teal' : 'bg-temper-subtle'
                                            }`}
                                    >
                                        <span
                                            className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${item.enabled ? 'left-6' : 'left-1'
                                                }`}
                                        />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}

                {/* Danger Zone */}
                <section className="settings-group space-y-3">
                    <div className="flex items-center gap-2.5">
                        <Trash2 className="h-4 w-4 text-temper-red" />
                        <h2 className="text-sm font-medium uppercase tracking-wider text-temper-muted">
                            Danger Zone
                        </h2>
                    </div>
                    <div className="rounded-2xl bg-temper-red/5 p-5 ring-1 ring-temper-red/20">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <p className="text-sm font-medium text-temper-text">Delete Account</p>
                                <p className="text-xs text-temper-muted">Permanently delete all sessions and data</p>
                            </div>
                            <button className="rounded-lg bg-temper-red/10 px-4 py-2 text-xs font-medium text-temper-red transition-colors hover:bg-temper-red/20">
                                Delete
                            </button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
