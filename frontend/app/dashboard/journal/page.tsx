'use client';

import { useState, useRef, useEffect } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  Smile,
  Frown,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Calendar,
  Save,
  BookOpen,
  Trash2,
  Activity,
  Mic,
} from 'lucide-react';
import { Trade, analyzeSession, SessionAnalysis } from '@/lib/biasDetector';
import { BackendApiError, getLastJobId, transcribeJournalAudio } from '@/lib/backend-bridge';
import { loadCachedSessionTrades } from '@/lib/session-cache';

type Mood = 'Calm' | 'Anxious' | 'Greedy' | 'Revenge';

interface JournalEntry {
  id: string;
  date: string;
  mood: Mood;
  asset: string;
  followedPlan: boolean;
  notes: string;
}

const MOODS: { type: Mood; icon: typeof Smile; color: string; bg: string }[] = [
  { type: 'Calm', icon: Smile, color: 'text-emerald-400', bg: 'bg-emerald-400/10 ring-emerald-400/20' },
  { type: 'Anxious', icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-400/10 ring-yellow-400/20' },
  { type: 'Greedy', icon: Zap, color: 'text-orange-400', bg: 'bg-orange-400/10 ring-orange-400/20' },
  { type: 'Revenge', icon: Frown, color: 'text-red-400', bg: 'bg-red-400/10 ring-red-400/20' },
];

/* ── cumulative heatmap: blend followed + deviated per day ── */
const NEGATIVE_MOODS: Mood[] = ['Anxious', 'Greedy', 'Revenge'];

function buildHeatmap(entries: JournalEntry[]) {
  const cells: { followed: number; deviated: number }[] = Array.from({ length: 30 }, () => ({ followed: 0, deviated: 0 }));
  entries.forEach((e) => {
    const dayAgo = Math.floor(
      (Date.now() - new Date(e.date).getTime()) / 86_400_000,
    );
    if (dayAgo >= 0 && dayAgo < 30) {
      // Deviated if they said so, OR if the mood itself is negative
      const isDeviated = !e.followedPlan || NEGATIVE_MOODS.includes(e.mood);
      if (isDeviated) cells[29 - dayAgo].deviated++;
      else cells[29 - dayAgo].followed++;
    }
  });
  return cells;
}

function heatmapColor(cell: { followed: number; deviated: number }): string {
  const total = cell.followed + cell.deviated;
  if (total === 0) return 'bg-white/[0.04]';
  const ratio = cell.followed / total; // 1.0 = all followed, 0.0 = all deviated
  if (ratio >= 0.8) return 'bg-emerald-400/70';
  if (ratio >= 0.5) return 'bg-amber-400/60';
  return 'bg-red-400/70';
}

export default function JournalPage() {
  const container = useRef<HTMLDivElement>(null);
  const [selectedMood, setSelectedMood] = useState<Mood | null>(null);
  const [followedPlan, setFollowedPlan] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [asset, setAsset] = useState('');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [mounted, setMounted] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<SessionAnalysis | null>(null);
  const [journalAudioFile, setJournalAudioFile] = useState<File | null>(null);
  const [journalTranscript, setJournalTranscript] = useState<string | null>(null);
  const [journalTranscribeLoading, setJournalTranscribeLoading] = useState(false);
  const [journalTranscribeError, setJournalTranscribeError] = useState<string | null>(null);

  /* Load entries + today's session data */
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('temper_journal_entries');
    if (saved) {
      try { setEntries(JSON.parse(saved)); } catch { /* ignore */ }
    }

    // Load uploaded session to show today's context
    const trades = loadCachedSessionTrades();
    if (trades && trades.length > 0) {
      setSessionSummary(analyzeSession(trades));
    }
  }, []);

  /* Persist */
  useEffect(() => {
    if (entries.length > 0) {
      localStorage.setItem('temper_journal_entries', JSON.stringify(entries));
    }
  }, [entries]);

  /* Entrance animations */
  useGSAP(
    () => {
      if (!mounted) return;
      gsap.set(['.journal-header', '.mood-section', '.log-section', '.heatmap-section', '.entries-section'], { clearProps: 'all' });
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.journal-header', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 })
        .fromTo('.mood-section', { y: 25, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3')
        .fromTo('.log-section', { y: 25, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3')
        .fromTo('.heatmap-section', { y: 25, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3')
        .fromTo('.entries-section', { y: 25, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, '-=0.3');
    },
    { scope: container, dependencies: [mounted] },
  );

  const handleSave = () => {
    if (!selectedMood || followedPlan === null) return;

    const newEntry: JournalEntry = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      mood: selectedMood,
      asset,
      followedPlan,
      notes: note,
    };

    setEntries([newEntry, ...entries]);
    setSelectedMood(null);
    setFollowedPlan(null);
    setNote('');
    setAsset('');

    gsap.fromTo(
      '.success-toast',
      { y: 20, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.3,
        onComplete: () => {
          setTimeout(() => gsap.to('.success-toast', { y: -20, opacity: 0 }), 2000);
        },
      },
    );
  };

  const deleteEntry = (id: string) => {
    setEntries((prev) => {
      const filtered = prev.filter((e) => e.id !== id);
      localStorage.setItem('temper_journal_entries', JSON.stringify(filtered));
      return filtered;
    });
  };

  const handleTranscribe = async () => {
    if (!journalAudioFile) return;
    const jobId = getLastJobId();
    if (!jobId) {
      setJournalTranscribeError('Upload and analyze a session before voice journaling.');
      return;
    }
    setJournalTranscribeLoading(true);
    setJournalTranscribeError(null);
    try {
      const payload = await transcribeJournalAudio(jobId, journalAudioFile);
      setJournalTranscript(typeof payload.transcript === 'string' ? payload.transcript : null);
    } catch (error) {
      setJournalTranscript(null);
      if (error instanceof BackendApiError) {
        setJournalTranscribeError(error.code ? `${error.message} (${error.code})` : error.message);
      } else {
        setJournalTranscribeError(error instanceof Error ? error.message : 'Transcription failed.');
      }
    } finally {
      setJournalTranscribeLoading(false);
    }
  };

  const heatmap = buildHeatmap(entries);

  return (
    <div
      ref={container}
      className="h-full overflow-y-auto overflow-x-hidden bg-[#0a0a0a] px-6 py-8 text-white md:px-10 md:py-10 lg:px-12"
    >
      <div className="mx-auto max-w-6xl space-y-10">
        {/* ── Header ── */}
        <header className="journal-header space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Reflection
          </p>
          <h1 className="font-coach text-3xl font-semibold tracking-tight md:text-4xl">
            <span className="text-white">Smart </span>
            <span className="text-emerald-400">Journal</span>
          </h1>
          <p className="text-sm text-gray-400">
            Track your psychology before and after every trade.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* ═══ Left: Input ═══ */}
          <div className="space-y-8">
            {/* Mood */}
            <section className="mood-section space-y-4">
              <h2 className="flex items-center gap-2 border-b border-white/[0.08] pb-2 text-sm font-semibold text-gray-400">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-[10px] font-bold text-amber-400">
                  1
                </span>
                Pre-Trade Mood
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {MOODS.map((m) => (
                  <button
                    key={m.type}
                    onClick={() => setSelectedMood(m.type)}
                    className={`flex flex-col items-center justify-center gap-2 rounded-2xl border p-4 transition-all cursor-pointer ${
                      selectedMood === m.type
                        ? `${m.bg} border-transparent ring-1`
                        : 'border-white/[0.08] bg-white/[0.05] hover:bg-white/[0.08]'
                    }`}
                  >
                    <m.icon
                      className={`h-6 w-6 ${
                        selectedMood === m.type ? m.color : 'text-gray-400'
                      }`}
                    />
                    <span
                      className={`text-xs font-semibold ${
                        selectedMood === m.type ? 'text-white' : 'text-gray-400'
                      }`}
                    >
                      {m.type}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* Quick Log */}
            <section className="log-section space-y-4">
              <h2 className="flex items-center gap-2 border-b border-white/[0.08] pb-2 text-sm font-semibold text-gray-400">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-[10px] font-bold text-amber-400">
                  2
                </span>
                Quick Log
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    Asset Ticker
                  </label>
                  <input
                    type="text"
                    value={asset}
                    onChange={(e) => setAsset(e.target.value.toUpperCase())}
                    placeholder="e.g. AAPL"
                    className="w-full rounded-xl border border-white/[0.08] bg-white/[0.06] px-4 py-3 text-sm text-white outline-none transition-all placeholder:text-gray-500 focus:border-emerald-400/40 focus:ring-1 focus:ring-emerald-400/30"
                  />
                </div>

                <div>
                  <span className="mb-2 block text-xs font-medium text-gray-400">
                    Did you follow your plan?
                  </span>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setFollowedPlan(true)}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer ${
                        followedPlan === true
                          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
                          : 'border-white/[0.08] bg-white/[0.05] text-gray-400 hover:bg-white/[0.08]'
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Yes, strictly
                    </button>
                    <button
                      onClick={() => setFollowedPlan(false)}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer ${
                        followedPlan === false
                          ? 'border-red-400/30 bg-red-400/10 text-red-400'
                          : 'border-white/[0.08] bg-white/[0.05] text-gray-400 hover:bg-white/[0.08]'
                      }`}
                    >
                      <XCircle className="h-4 w-4" />
                      No, I deviated
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-400">
                    Notes (Optional)
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What triggered your decision?"
                    rows={3}
                    className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.06] px-4 py-3 text-sm text-white outline-none transition-all placeholder:text-gray-500 focus:border-emerald-400/40 focus:ring-1 focus:ring-emerald-400/30"
                  />
                </div>

                <button
                  onClick={handleSave}
                  disabled={!selectedMood || followedPlan === null}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 text-sm font-bold text-black transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                >
                  <Save className="h-4 w-4" />
                  Log Entry
                </button>

                <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-3">
                  <p className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-400">
                    <Mic className="h-3.5 w-3.5 text-purple-400" />
                    Voice Journal (Gradium STT)
                  </p>
                  <div className="flex flex-col gap-2">
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => setJournalAudioFile(e.target.files?.[0] || null)}
                      className="text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-white/[0.08] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
                    />
                    <button
                      onClick={handleTranscribe}
                      disabled={!journalAudioFile || journalTranscribeLoading}
                      className="rounded-lg bg-purple-500 px-3 py-2 text-xs font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {journalTranscribeLoading ? 'Transcribing...' : 'Transcribe Note'}
                    </button>
                    {journalTranscribeError && (
                      <p className="text-xs text-red-400">{journalTranscribeError}</p>
                    )}
                    {journalTranscript && (
                      <p className="rounded-lg bg-white/[0.06] p-2 text-xs text-gray-300">
                        {journalTranscript}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* ═══ Right: Session Context + Heatmap & Entries ═══ */}
          <div className="space-y-8">
            {/* Today's Session Context — simplified */}
            {sessionSummary && (
              <section className="rounded-2xl border border-emerald-400/10 bg-emerald-400/[0.03] p-5 space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
                  <Activity className="h-4 w-4" />
                  Today&apos;s Session
                </h2>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-white font-medium">{sessionSummary.summary.totalTrades} trades</span>
                  <span className="text-gray-600">&middot;</span>
                  <span className={sessionSummary.summary.netPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {sessionSummary.summary.netPnL >= 0 ? '+' : ''}${sessionSummary.summary.netPnL.toFixed(0)}
                  </span>
                  <span className="text-gray-600">&middot;</span>
                  <span className="text-gray-400">Score {sessionSummary.disciplineScore}</span>
                </div>
                {sessionSummary.biases.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {sessionSummary.biases.map((b, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full bg-red-400/10 px-2.5 py-1 text-[10px] font-medium text-red-400">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {b.type.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Coach Prompts — condensed to top 3 */}
            {sessionSummary?.coachResponse && sessionSummary.coachResponse.journalPrompts.length > 0 && (
              <section className="rounded-2xl border border-purple-400/10 bg-purple-400/[0.03] p-5 space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-purple-400">
                  <BookOpen className="h-4 w-4" />
                  Reflection Prompts
                </h2>
                <div className="space-y-2">
                  {sessionSummary.coachResponse.journalPrompts.slice(0, 3).map((prompt, i) => (
                    <p key={i} className="text-xs leading-relaxed text-gray-400 flex gap-2">
                      <span className="text-purple-400/60 font-mono">{i + 1}.</span>
                      {prompt}
                    </p>
                  ))}
                </div>
              </section>
            )}
            {/* Heatmap */}
            <section className="heatmap-section rounded-2xl border border-white/[0.08] bg-white/[0.05] p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Calendar className="h-4 w-4 text-emerald-400" />
                  Discipline Heatmap
                </h2>
                <div className="flex items-center gap-3 text-[10px] text-gray-400">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-emerald-400" /> Followed
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-amber-400" /> Mixed
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-sm bg-red-400" /> Deviated
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {heatmap.map((cell, i) => (
                  <div
                    key={i}
                    className={`aspect-square rounded-md transition-all hover:scale-110 ${heatmapColor(cell)}`}
                    title={`Day ${i + 1}${cell.followed + cell.deviated > 0 ? ` · ${cell.followed} followed, ${cell.deviated} deviated` : ''}`}
                  />
                ))}
              </div>

              <p className="mt-3 text-center text-[10px] text-gray-500">
                Last 30 days
              </p>
            </section>

            {/* Recent logs */}
            <section className="entries-section space-y-4">
              <h2 className="flex items-center gap-2 border-b border-white/[0.08] pb-2 text-sm font-semibold text-gray-400">
                <BookOpen className="h-4 w-4" />
                Recent Logs
              </h2>

              {entries.length === 0 ? (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-8 text-center">
                  <BookOpen className="mx-auto mb-2 h-8 w-8 text-gray-500" />
                  <p className="text-sm text-gray-400">
                    No entries yet — log your first mood above.
                  </p>
                </div>
              ) : (
                <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                  {entries.slice(0, 8).map((entry) => {
                    const moodMeta = MOODS.find((m) => m.type === entry.mood);
                    return (
                      <div
                        key={entry.id}
                        className="group flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.05] p-4 transition-all hover:bg-white/[0.08]"
                      >
                        <div
                          className={`mt-0.5 rounded-full p-1.5 ${
                            entry.followedPlan
                              ? 'bg-emerald-400/10 text-emerald-400'
                              : 'bg-red-400/10 text-red-400'
                          }`}
                        >
                          {entry.followedPlan ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">
                              {entry.asset || 'General'}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {new Date(entry.date).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="mt-1">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium ${moodMeta?.color ?? 'text-gray-400'}`}
                            >
                              {entry.mood}
                            </span>
                          </div>
                          {entry.notes && (
                            <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
                              {entry.notes}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => deleteEntry(entry.id)}
                          className="cursor-pointer rounded-lg p-1.5 text-gray-500 opacity-0 transition-all hover:bg-red-400/10 hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Success Toast */}
      <div className="success-toast pointer-events-none fixed bottom-8 right-8 z-50 flex items-center gap-3 rounded-xl bg-emerald-500 px-4 py-3 text-black opacity-0 shadow-lg">
        <CheckCircle2 className="h-5 w-5" />
        <span className="text-sm font-semibold">Entry Logged</span>
      </div>
    </div>
  );
}
