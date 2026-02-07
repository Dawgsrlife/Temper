'use client';

import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { User, Bell, Shield, Moon, ChevronRight, LucideIcon } from 'lucide-react';

type SettingItem = {
    icon: LucideIcon;
    label: string;
    description: string;
    toggle?: boolean;
    value?: boolean;
    onChange?: (value: boolean) => void;
};

type SettingGroup = {
    title: string;
    items: SettingItem[];
};

export default function SettingsPage() {
    const container = useRef<HTMLDivElement>(null);
    const [notifications, setNotifications] = useState(true);
    const [darkMode, setDarkMode] = useState(true);

    useGSAP(() => {
        gsap.from('.reveal', {
            opacity: 0,
            y: 20,
            stagger: 0.08,
            duration: 0.7,
            ease: 'power3.out',
        });
    }, { scope: container });

    const settingGroups: SettingGroup[] = [
        {
            title: 'Account',
            items: [
                { icon: User, label: 'Profile', description: 'Manage your account details' },
                { icon: Shield, label: 'Privacy', description: 'Control your data and visibility' },
            ],
        },
        {
            title: 'Preferences',
            items: [
                { icon: Bell, label: 'Notifications', description: 'Session alerts and reminders', toggle: true, value: notifications, onChange: setNotifications },
                { icon: Moon, label: 'Dark Mode', description: 'Toggle dark theme', toggle: true, value: darkMode, onChange: setDarkMode },
            ],
        },
    ];

    return (
        <div ref={container} className="min-h-screen bg-gradient-to-br from-temper-bg via-temper-bg to-temper-surface/30 p-8 md:p-12">
            <div className="mx-auto max-w-3xl space-y-10">
                {/* Header */}
                <header className="reveal space-y-2 border-b border-temper-border/30 pb-8">
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-temper-teal">
                        Configuration
                    </p>
                    <h1 className="font-coach text-5xl font-bold italic tracking-tight text-temper-text">
                        Settings
                    </h1>
                </header>

                {/* Settings Groups */}
                <div className="space-y-10">
                    {settingGroups.map((group) => (
                        <section key={group.title} className="space-y-4">
                            <h2 className="reveal text-xs font-bold uppercase tracking-[0.2em] text-temper-muted">
                                {group.title}
                            </h2>
                            <div className="reveal overflow-hidden rounded-3xl bg-temper-surface/50 ring-1 ring-temper-border/30 backdrop-blur-xl">
                                {group.items.map((item, i) => (
                                    <div
                                        key={item.label}
                                        className={`flex items-center justify-between p-6 transition-colors hover:bg-temper-subtle/30 ${i !== group.items.length - 1 ? 'border-b border-temper-border/20' : ''
                                            }`}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-temper-subtle ring-1 ring-temper-border/30">
                                                <item.icon className="h-5 w-5 text-temper-muted" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-temper-text">{item.label}</p>
                                                <p className="text-xs text-temper-muted">{item.description}</p>
                                            </div>
                                        </div>
                                        {item.toggle ? (
                                            <button
                                                onClick={() => item.onChange?.(!item.value)}
                                                className={`relative h-7 w-12 rounded-full transition-colors ${item.value ? 'bg-temper-teal' : 'bg-temper-subtle'
                                                    }`}
                                            >
                                                <div
                                                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${item.value ? 'translate-x-6' : 'translate-x-1'
                                                        }`}
                                                />
                                            </button>
                                        ) : (
                                            <ChevronRight className="h-5 w-5 text-temper-muted" />
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>

                {/* Danger Zone */}
                <section className="space-y-4">
                    <h2 className="reveal text-xs font-bold uppercase tracking-[0.2em] text-temper-red">
                        Danger Zone
                    </h2>
                    <div className="reveal rounded-3xl bg-temper-red/5 p-6 ring-1 ring-temper-red/20">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium text-temper-text">Delete Account</p>
                                <p className="text-xs text-temper-muted">
                                    Permanently delete your account and all data
                                </p>
                            </div>
                            <button className="rounded-xl bg-temper-red/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-temper-red transition-colors hover:bg-temper-red hover:text-white">
                                Delete
                            </button>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
