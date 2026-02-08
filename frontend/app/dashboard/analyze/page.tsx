"use client";

import { DemoConsole } from "@/components/upload/demo-console";

export default function AnalyzePage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] px-6 py-8 text-white md:px-10 md:py-10 lg:px-12">
      <div className="mx-auto max-w-6xl space-y-4">
        <header>
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Game Review
          </p>
          <h1 className="font-coach text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Chess-Style Trade Review
          </h1>
          <p className="pt-1 text-sm text-gray-500">
            Deterministic facts from engine artifacts. Coach is post-hoc and cannot change facts.
          </p>
        </header>
        <DemoConsole />
      </div>
    </div>
  );
}
