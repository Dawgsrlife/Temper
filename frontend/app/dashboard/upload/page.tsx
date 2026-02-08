'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  Upload,
  FileText,
  X,
  Check,
  ArrowRight,
  AlertTriangle,
  Brain,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import {
  TRADER_PROFILES,
  TraderProfile,
  parseCSV,
  analyzeSession,
} from '@/lib/biasDetector';

export default function UploadPage() {
  const container = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{
    score: number;
    biases: string[];
    profile: TraderProfile;
  } | null>(null);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => { setMounted(true); }, []);

  useGSAP(
    () => {
      if (!mounted) return;
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('.page-header', { y: 30, opacity: 0, duration: 0.6 })
        .from('.upload-zone', { y: 40, opacity: 0, scale: 0.98, duration: 0.7 }, '-=0.3')
        .from('.sample-card', { y: 20, opacity: 0, stagger: 0.1, duration: 0.4 }, '-=0.3')
        .from('.format-info', { y: 20, opacity: 0, duration: 0.5 }, '-=0.2');
    },
    { scope: container, dependencies: [mounted] },
  );

  useGSAP(
    () => {
      if (isComplete && analysisResult) {
        gsap.from('.result-section', { y: 20, opacity: 0, duration: 0.5, ease: 'power3.out' });
      }
    },
    { dependencies: [isComplete, analysisResult] },
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith('.csv')) setFile(droppedFile);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);

    const text = await file.text();
    const trades = parseCSV(text);

    setTimeout(() => {
      localStorage.setItem('temper_current_session', JSON.stringify(trades));
      const result = analyzeSession(trades);
      setIsUploading(false);
      setIsComplete(true);
      setAnalysisResult({
        score: result.disciplineScore,
        biases: result.biases.map((b) => b.type.replace('_', ' ')).slice(0, 3),
        profile: result.biases.length > 0 ? 'loss_averse_trader' : 'calm_trader',
      });
    }, 1500);
  };

  const loadSampleData = (profile: TraderProfile) => {
    const mockFile = new File(['mock data'], `${profile}.csv`, { type: 'text/csv' });
    setFile(mockFile);
  };

  const removeFile = () => {
    setFile(null);
    setIsComplete(false);
    setAnalysisResult(null);
  };

  return (
    <div
      ref={container}
      className="min-h-screen bg-[#0a0a0a] px-6 py-8 text-white md:px-10 md:py-10 lg:px-12"
    >
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Header */}
        <header className="page-header space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Import
          </p>
          <h1 className="font-coach text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Upload Trading Data
          </h1>
          <p className="pt-1 text-sm text-gray-500">
            Import your trade history and let our AI detect behavioral biases.
          </p>
        </header>

        {/* Upload Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`upload-zone relative overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300 ${
            isDragging
              ? 'scale-[1.02] border-emerald-400 bg-emerald-400/5'
              : file
                ? 'border-white/[0.10] bg-white/[0.04]'
                : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.05]'
          }`}
        >
          {isDragging && (
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-emerald-400/10 to-transparent" />
          )}

          {!file ? (
            <div className="relative z-10">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400/20 to-emerald-400/5 ring-1 ring-emerald-400/20">
                <Upload className="h-7 w-7 text-emerald-400" />
              </div>
              <p className="mb-2 text-base font-medium text-white">
                Drop your CSV file here
              </p>
              <p className="mb-5 text-sm text-gray-500">or click to browse</p>
              <label className="inline-block cursor-pointer rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-black transition-all hover:brightness-110">
                Choose File
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            <div className="relative z-10 space-y-5">
              <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-[#0a0a0a]/60 p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-emerald-400/10 p-2.5">
                    <FileText className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-white">{file.name}</p>
                    <p className="text-xs text-gray-500">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                {!isComplete && !isUploading && (
                  <button
                    onClick={removeFile}
                    className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {isComplete && analysisResult ? (
                <div className="result-section space-y-4">
                  <div className="flex items-center justify-center gap-2 text-emerald-400">
                    <Check className="h-5 w-5" />
                    <span className="text-sm font-semibold">Analysis Complete</span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-4 text-center">
                      <p className="text-2xl font-bold text-yellow-400">{analysisResult.score}</p>
                      <p className="text-[10px] text-gray-500">Discipline Score</p>
                    </div>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-4 text-center">
                      <p className="text-2xl font-bold text-orange-400">{analysisResult.biases.length}</p>
                      <p className="text-[10px] text-gray-500">Biases Detected</p>
                    </div>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-4 text-center">
                      <p className="text-sm font-bold text-white">{TRADER_PROFILES[analysisResult.profile].name}</p>
                      <p className="text-[10px] text-gray-500">Profile Match</p>
                    </div>
                  </div>

                  {analysisResult.biases.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-2">
                      {analysisResult.biases.map((bias) => (
                        <span
                          key={bias}
                          className="flex items-center gap-1.5 rounded-full bg-red-400/10 px-3 py-1.5 text-xs font-medium text-red-400"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {bias}
                        </span>
                      ))}
                    </div>
                  )}

                  <Link
                    href="/dashboard/analyze"
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-8 py-3.5 text-sm font-semibold text-black transition-all hover:brightness-110"
                  >
                    View Full Analysis
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <button
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-8 py-3.5 text-sm font-semibold text-black transition-all hover:brightness-110 disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Analyzing Trades...
                    </>
                  ) : (
                    <>
                      <Brain className="h-4 w-4" />
                      Detect Biases
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Sample Data */}
        {!file && (
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
              Or try sample data
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(TRADER_PROFILES) as TraderProfile[]).map((profile) => (
                <button
                  key={profile}
                  onClick={() => loadSampleData(profile)}
                  className="sample-card group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.04] p-4 text-left transition-all hover:bg-white/[0.06] hover:border-white/[0.10]"
                >
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: TRADER_PROFILES[profile].color }}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{TRADER_PROFILES[profile].name}</p>
                    <p className="text-xs text-gray-500">{TRADER_PROFILES[profile].description}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-600 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Format Info */}
        <div className="format-info space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Supported Format
          </p>
          <p className="text-sm text-gray-400">
            CSV with columns:{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white">timestamp</code>,{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white">asset</code>,{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white">side</code>,{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white">quantity</code>
          </p>
          <p className="text-xs text-gray-500">
            Works with exports from TradingView, TD Ameritrade, Interactive Brokers, and more.
          </p>
        </div>
      </div>
    </div>
  );
}
