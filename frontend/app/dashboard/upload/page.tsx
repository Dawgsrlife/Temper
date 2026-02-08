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
  Plus,
  Trash2,
  Table2,
  FileSpreadsheet,
} from 'lucide-react';
import Link from 'next/link';
import {
  TRADER_PROFILES,
  TraderProfile,
  Trade,
  parseCSV,
  analyzeSession,
} from '@/lib/biasDetector';
import {
  createAndWaitForJob,
  fetchJobElo,
  fetchJobSummary,
  fetchTradesFromJob,
  getUserId,
  setLastJobId,
} from '@/lib/backend-bridge';

function generateSessionTitle(): string {
  const titleCounter = parseInt(localStorage.getItem('temper_session_counter') || '0', 10);
  const newTitle = `Session ${titleCounter + 1}`;
  localStorage.setItem('temper_session_counter', String(titleCounter + 1));
  localStorage.setItem('temper_session_title', newTitle);
  return newTitle;
}

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
  const [inputMode, setInputMode] = useState<'file' | 'manual'>('file');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const router = useRouter();

  const tradesToCsv = useCallback((trades: Trade[]): string => {
    const header = ['timestamp', 'asset', 'side', 'quantity', 'price', 'pnl'];
    const rows = trades.map((trade) => [
      trade.timestamp,
      trade.asset,
      trade.side,
      String(trade.quantity ?? 1),
      trade.price != null ? String(trade.price) : '',
      trade.pnl != null ? String(trade.pnl) : '',
    ]);
    return [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
  }, []);

  const resultFromBackend = useCallback(
    async (jobId: string, fallbackTrades: Trade[], fallbackProfile?: TraderProfile) => {
      try {
        const [summary, elo] = await Promise.all([
          fetchJobSummary(jobId),
          fetchJobElo(jobId),
        ]);

        const biasRates = summary.bias_rates || {};
        const rankedBiases = Object.entries(biasRates)
          .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
          .sort((a, b) => (Number(b[1]) - Number(a[1])));

        const biasNames = rankedBiases
          .filter(([, value]) => Number(value) > 0)
          .map(([key]) => key.replace(/_rate$/i, '').replace(/_/g, ' ').toUpperCase())
          .slice(0, 3);

        const topBiasKey = rankedBiases.length > 0 ? rankedBiases[0][0] : '';
        const inferredProfile: TraderProfile =
          topBiasKey.includes('revenge')
            ? 'revenge_trader'
            : topBiasKey.includes('overtrading')
              ? 'overtrader'
              : topBiasKey.includes('loss')
                ? 'loss_averse_trader'
                : (fallbackProfile || 'calm_trader');

        const projectedElo = Math.round(Number(elo?.elo?.projected ?? 1200));
        setAnalysisResult({
          score: projectedElo,
          biases: biasNames,
          profile: inferredProfile,
        });
      } catch {
        const fallback = analyzeSession(fallbackTrades);
        setAnalysisResult({
          score: fallback.disciplineScore,
          biases: fallback.biases.map((b) => b.type.replace('_', ' ')).slice(0, 3),
          profile: fallbackProfile || (fallback.biases.length > 0 ? 'loss_averse_trader' : 'calm_trader'),
        });
      }
    },
    [],
  );

  /* ── Manual trade entry state ── */
  interface ManualTrade {
    id: string;
    timestamp: string;
    asset: string;
    side: 'BUY' | 'SELL';
    quantity: string;
    entryPrice: string;
    exitPrice: string;
    pnl: string;
    balance: string;
  }
  const emptyTrade = (): ManualTrade => ({
    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString().slice(0, 16),
    asset: '',
    side: 'BUY',
    quantity: '',
    entryPrice: '',
    exitPrice: '',
    pnl: '',
    balance: '',
  });
  const [manualTrades, setManualTrades] = useState<ManualTrade[]>([emptyTrade()]);

  const addManualTrade = () => {
    setManualTrades((prev) => [...prev, emptyTrade()]);
  };

  const removeManualTrade = (id: string) => {
    setManualTrades((prev) => prev.filter((t) => t.id !== id));
  };

  const updateManualTrade = (id: string, field: keyof ManualTrade, value: string) => {
    setManualTrades((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const updated = { ...t, [field]: value };
        // Auto-calc P/L from entry/exit prices
        if ((field === 'entryPrice' || field === 'exitPrice' || field === 'quantity' || field === 'side') &&
            updated.entryPrice && updated.exitPrice && updated.quantity) {
          const entry = parseFloat(updated.entryPrice);
          const exit = parseFloat(updated.exitPrice);
          const qty = parseFloat(updated.quantity);
          if (!isNaN(entry) && !isNaN(exit) && !isNaN(qty)) {
            const sign = updated.side === 'BUY' ? 1 : -1;
            updated.pnl = ((exit - entry) * qty * sign).toFixed(2);
          }
        }
        return updated;
      }),
    );
  };

  const submitManualTrades = async () => {
    const validTrades: Trade[] = manualTrades
      .filter((t) => t.asset && t.quantity)
      .map((t) => ({
        timestamp: t.timestamp.replace('T', ' ') + ':00',
        asset: t.asset.toUpperCase(),
        side: t.side,
        quantity: parseFloat(t.quantity) || 1,
        price: parseFloat(t.entryPrice) || undefined,
        pnl: parseFloat(t.pnl) || 0,
      }));

    if (validTrades.length === 0) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const csv = tradesToCsv(validTrades);
      const file = new File([csv], 'manual_trades.csv', { type: 'text/csv' });
      const jobId = await createAndWaitForJob(file, getUserId());
      setLastJobId(jobId);

      // Prefer backend-normalized rows when available.
      const backendTrades = await fetchTradesFromJob(jobId);
      const effectiveTrades = backendTrades.length > 0 ? backendTrades : validTrades;
      generateSessionTitle();
      localStorage.setItem('temper_current_session', JSON.stringify(effectiveTrades));
      setIsUploading(false);
      setIsComplete(true);
      await resultFromBackend(jobId, effectiveTrades);
    } catch (error) {
      setIsUploading(false);
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    }
  };

  useEffect(() => { setMounted(true); }, []);

  useGSAP(
    () => {
      if (!mounted) return;
      gsap.set(['.page-header', '.upload-zone', '.sample-card', '.format-info', '.mode-tabs'], { clearProps: 'all' });
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.fromTo('.page-header', { y: 30, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6 })
        .fromTo('.mode-tabs', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4 }, '-=0.3')
        .fromTo('.upload-zone', { y: 40, autoAlpha: 0, scale: 0.98 }, { y: 0, autoAlpha: 1, scale: 1, duration: 0.7 }, '-=0.3')
        .fromTo('.sample-card', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, stagger: 0.1, duration: 0.4 }, '-=0.3')
        .fromTo('.format-info', { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5 }, '-=0.2');
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
    if (droppedFile && (droppedFile.name.endsWith('.csv') || droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
      setFile(droppedFile);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);

    let trades: Trade[];
    let backendFile: File = file;

    try {
      if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        // Excel handling via dynamic import
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const csvText = XLSX.utils.sheet_to_csv(ws);
        trades = parseCSV(csvText);
        backendFile = new File([csvText], file.name.replace(/\.(xlsx|xls)$/i, '.csv'), {
          type: 'text/csv',
        });
      } else {
        const text = await file.text();
        trades = parseCSV(text);
      }

      const jobId = await createAndWaitForJob(backendFile, getUserId());
      setLastJobId(jobId);
      const backendTrades = await fetchTradesFromJob(jobId);
      const effectiveTrades = backendTrades.length > 0 ? backendTrades : trades;

      generateSessionTitle();
      localStorage.setItem('temper_current_session', JSON.stringify(effectiveTrades));
      setIsUploading(false);
      setIsComplete(true);
      await resultFromBackend(jobId, effectiveTrades);
    } catch (error) {
      setIsUploading(false);
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    }
  };

  const loadSampleData = (profile: TraderProfile) => {
    // Generate real CSV data for each profile
    const sampleTrades: Record<TraderProfile, Trade[]> = {
      calm_trader: [
        { timestamp: '2025-03-01 10:00:00', asset: 'NVDA', side: 'BUY', quantity: 50, pnl: 85 },
        { timestamp: '2025-03-01 10:45:00', asset: 'NVDA', side: 'SELL', quantity: 50, pnl: 120 },
        { timestamp: '2025-03-01 11:30:00', asset: 'AAPL', side: 'BUY', quantity: 100, pnl: 95 },
        { timestamp: '2025-03-01 12:15:00', asset: 'AAPL', side: 'SELL', quantity: 100, pnl: 75 },
        { timestamp: '2025-03-01 14:00:00', asset: 'MSFT', side: 'BUY', quantity: 80, pnl: 110 },
        { timestamp: '2025-03-01 14:30:00', asset: 'MSFT', side: 'SELL', quantity: 80, pnl: 60 },
      ],
      revenge_trader: [
        { timestamp: '2025-03-01 09:30:00', asset: 'TSLA', side: 'BUY', quantity: 100, pnl: -180 },
        { timestamp: '2025-03-01 09:31:00', asset: 'TSLA', side: 'BUY', quantity: 200, pnl: -320 },
        { timestamp: '2025-03-01 09:32:00', asset: 'TSLA', side: 'BUY', quantity: 400, pnl: -520 },
        { timestamp: '2025-03-01 09:33:00', asset: 'TSLA', side: 'SELL', quantity: 700, pnl: -225 },
        { timestamp: '2025-03-01 10:00:00', asset: 'AAPL', side: 'BUY', quantity: 100, pnl: 45 },
        { timestamp: '2025-03-01 10:01:30', asset: 'AAPL', side: 'SELL', quantity: 100, pnl: -45 },
      ],
      overtrader: [
        { timestamp: '2025-03-01 09:30:00', asset: 'AAPL', side: 'BUY', quantity: 50, pnl: 15 },
        { timestamp: '2025-03-01 09:31:00', asset: 'MSFT', side: 'SELL', quantity: 60, pnl: -20 },
        { timestamp: '2025-03-01 09:32:00', asset: 'NVDA', side: 'BUY', quantity: 70, pnl: 30 },
        { timestamp: '2025-03-01 09:33:00', asset: 'TSLA', side: 'SELL', quantity: 80, pnl: -45 },
        { timestamp: '2025-03-01 09:34:00', asset: 'AAPL', side: 'BUY', quantity: 90, pnl: 25 },
        { timestamp: '2025-03-01 09:35:00', asset: 'MSFT', side: 'SELL', quantity: 100, pnl: -65 },
        { timestamp: '2025-03-01 09:36:00', asset: 'NVDA', side: 'BUY', quantity: 110, pnl: 40 },
        { timestamp: '2025-03-01 09:37:00', asset: 'TSLA', side: 'SELL', quantity: 120, pnl: -30 },
        { timestamp: '2025-03-01 09:38:00', asset: 'AAPL', side: 'BUY', quantity: 130, pnl: 50 },
        { timestamp: '2025-03-01 09:39:00', asset: 'MSFT', side: 'SELL', quantity: 140, pnl: -55 },
      ],
      loss_averse_trader: [
        { timestamp: '2025-03-01 09:30:00', asset: 'AAPL', side: 'BUY', quantity: 100, pnl: -10 },
        { timestamp: '2025-03-01 09:31:00', asset: 'AAPL', side: 'SELL', quantity: 100, pnl: -5 },
        { timestamp: '2025-03-01 10:00:00', asset: 'NVDA', side: 'BUY', quantity: 50, pnl: 180 },
        { timestamp: '2025-03-01 10:02:00', asset: 'NVDA', side: 'SELL', quantity: 25, pnl: 45 },
        { timestamp: '2025-03-01 11:00:00', asset: 'MSFT', side: 'BUY', quantity: 80, pnl: 120 },
        { timestamp: '2025-03-01 11:01:00', asset: 'MSFT', side: 'SELL', quantity: 40, pnl: 30 },
      ],
    };

    const trades = sampleTrades[profile];

    // Immediately analyze and store in localStorage so it reflects everywhere
    generateSessionTitle();
    localStorage.setItem('temper_current_session', JSON.stringify(trades));
    const csv = tradesToCsv(trades);
    const sampleFile = new File([csv], `${profile}.csv`, { type: 'text/csv' });
    setIsUploading(true);
    setUploadError(null);
    void createAndWaitForJob(sampleFile, getUserId(), { maxSeconds: 600 })
      .then(async (jobId) => {
        setLastJobId(jobId);
        const backendTrades = await fetchTradesFromJob(jobId);
        const effectiveTrades = backendTrades.length > 0 ? backendTrades : trades;
        localStorage.setItem('temper_current_session', JSON.stringify(effectiveTrades));
        setIsComplete(true);
        await resultFromBackend(jobId, effectiveTrades, profile);
      })
      .catch((error) => {
        const result = analyzeSession(trades);
        setIsComplete(true);
        setAnalysisResult({
          score: result.disciplineScore,
          biases: result.biases.map((b) => b.type.replace('_', ' ')).slice(0, 3),
          profile,
        });
        setUploadError(error instanceof Error ? error.message : 'Upload failed');
      })
      .finally(() => {
        setIsUploading(false);
      });
  };

  const removeFile = () => {
    setFile(null);
    setIsComplete(false);
    setAnalysisResult(null);
  };

  return (
    <div
      ref={container}
      className="h-full overflow-y-auto overflow-x-hidden bg-[#0a0a0a] px-6 py-8 text-white md:px-10 md:py-10 lg:px-12"
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

        {/* Input Mode Tabs */}
        <div className="mode-tabs flex gap-2">
          <button
            onClick={() => { setInputMode('file'); setIsComplete(false); setAnalysisResult(null); }}
            className={`cursor-pointer flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
              inputMode === 'file'
                ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-400/20'
                : 'bg-white/[0.07] text-gray-400 hover:text-white'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" />
            CSV / Excel
          </button>
          <button
            onClick={() => { setInputMode('manual'); setIsComplete(false); setAnalysisResult(null); }}
            className={`cursor-pointer flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
              inputMode === 'manual'
                ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-400/20'
                : 'bg-white/[0.07] text-gray-400 hover:text-white'
            }`}
          >
            <Table2 className="h-4 w-4" />
            Manual Entry
          </button>
        </div>

        {uploadError ? (
          <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">
            {uploadError}
          </div>
        ) : null}

        {/* Upload Zone */}
        {inputMode === 'file' ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`upload-zone relative overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center transition-all duration-300 ${
            isDragging
              ? 'scale-[1.02] border-emerald-400 bg-emerald-400/5'
              : file
                ? 'border-white/[0.12] bg-white/[0.06]'
                : 'border-white/[0.10] bg-white/[0.05] hover:border-white/[0.15] hover:bg-white/[0.07]'
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
                Drop your CSV or Excel file here
              </p>
              <p className="mb-5 text-sm text-gray-500">or click to browse</p>
              <label className="inline-block cursor-pointer rounded-xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-black transition-all hover:brightness-110">
                Choose File
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            <div className="relative z-10 space-y-5">
              <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-[#111]/80 p-4">
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
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.06] p-4 text-center">
                      <p className="text-2xl font-bold text-yellow-400">{analysisResult.score}</p>
                      <p className="text-[10px] text-gray-400">Projected ELO</p>
                    </div>
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.06] p-4 text-center">
                      <p className="text-2xl font-bold text-orange-400">{analysisResult.biases.length}</p>
                      <p className="text-[10px] text-gray-400">Biases Detected</p>
                    </div>
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.06] p-4 text-center">
                      <p className="text-sm font-bold text-white">{TRADER_PROFILES[analysisResult.profile].name}</p>
                      <p className="text-[10px] text-gray-400">Profile Match</p>
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
                  className="cursor-pointer inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-8 py-3.5 text-sm font-semibold text-black transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
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
        ) : (
          /* ═══ Manual Trade Entry Form ═══ */
          <div className="upload-zone space-y-4">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.06] p-5">
              {!isComplete ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                      Enter Trades
                    </p>
                    <button
                      onClick={addManualTrade}
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400 transition-all hover:bg-emerald-500/20"
                    >
                      <Plus className="h-3 w-3" />
                      Add Trade
                    </button>
                  </div>

                  {/* Column headers */}
                  <div className="hidden sm:grid sm:grid-cols-[1fr_80px_70px_80px_80px_80px_80px_32px] gap-2 text-[9px] font-semibold uppercase tracking-widest text-gray-600 px-1">
                    <span>Timestamp</span>
                    <span>Asset</span>
                    <span>Side</span>
                    <span>Qty</span>
                    <span>Entry $</span>
                    <span>Exit $</span>
                    <span>P/L</span>
                    <span />
                  </div>

                  {/* Trade rows */}
                  <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                    {manualTrades.map((trade, idx) => (
                      <div key={trade.id} className="grid gap-2 sm:grid-cols-[1fr_80px_70px_80px_80px_80px_80px_32px] items-center rounded-xl bg-white/[0.06] p-2.5 ring-1 ring-white/[0.08]">
                        <input
                          type="datetime-local"
                          value={trade.timestamp}
                          onChange={(e) => updateManualTrade(trade.id, 'timestamp', e.target.value)}
                          className="rounded-lg border border-white/[0.06] bg-[#0a0a0a] px-2.5 py-2 text-xs text-white outline-none focus:border-emerald-400/40"
                        />
                        <input
                          type="text"
                          value={trade.asset}
                          onChange={(e) => updateManualTrade(trade.id, 'asset', e.target.value.toUpperCase())}
                          placeholder="AAPL"
                          className="rounded-lg border border-white/[0.06] bg-[#0a0a0a] px-2.5 py-2 text-xs text-white outline-none placeholder:text-gray-700 focus:border-emerald-400/40"
                        />
                        <button
                          onClick={() => updateManualTrade(trade.id, 'side', trade.side === 'BUY' ? 'SELL' : 'BUY')}
                          className={`rounded-lg px-2.5 py-2 text-xs font-bold transition-all ${
                            trade.side === 'BUY'
                              ? 'bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/20'
                              : 'bg-red-400/10 text-red-400 ring-1 ring-red-400/20'
                          }`}
                        >
                          {trade.side}
                        </button>
                        <input
                          type="number"
                          value={trade.quantity}
                          onChange={(e) => updateManualTrade(trade.id, 'quantity', e.target.value)}
                          placeholder="100"
                          className="rounded-lg border border-white/[0.06] bg-[#0a0a0a] px-2.5 py-2 text-xs text-white outline-none placeholder:text-gray-700 focus:border-emerald-400/40"
                        />
                        <input
                          type="number"
                          value={trade.entryPrice}
                          onChange={(e) => updateManualTrade(trade.id, 'entryPrice', e.target.value)}
                          placeholder="150.00"
                          className="rounded-lg border border-white/[0.06] bg-[#0a0a0a] px-2.5 py-2 text-xs text-white outline-none placeholder:text-gray-700 focus:border-emerald-400/40"
                        />
                        <input
                          type="number"
                          value={trade.exitPrice}
                          onChange={(e) => updateManualTrade(trade.id, 'exitPrice', e.target.value)}
                          placeholder="155.00"
                          className="rounded-lg border border-white/[0.06] bg-[#0a0a0a] px-2.5 py-2 text-xs text-white outline-none placeholder:text-gray-700 focus:border-emerald-400/40"
                        />
                        <input
                          type="number"
                          value={trade.pnl}
                          onChange={(e) => updateManualTrade(trade.id, 'pnl', e.target.value)}
                          placeholder="auto"
                          className="rounded-lg border border-white/[0.06] bg-[#0a0a0a] px-2.5 py-2 text-xs text-white outline-none placeholder:text-gray-700 focus:border-emerald-400/40"
                        />
                        {manualTrades.length > 1 && (
                          <button
                            onClick={() => removeManualTrade(trade.id)}
                            className="flex items-center justify-center rounded-lg p-1.5 text-gray-600 transition-all hover:bg-red-400/10 hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={submitManualTrades}
                    disabled={isUploading || manualTrades.every((t) => !t.asset)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 text-sm font-bold text-black transition-all hover:brightness-110 disabled:opacity-40"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Brain className="h-4 w-4" />
                        Analyze {manualTrades.filter((t) => t.asset).length} Trade{manualTrades.filter((t) => t.asset).length !== 1 ? 's' : ''}
                      </>
                    )}
                  </button>
                </div>
              ) : analysisResult ? (
                <div className="result-section space-y-4 text-center">
                  <div className="flex items-center justify-center gap-2 text-emerald-400">
                    <Check className="h-5 w-5" />
                    <span className="text-sm font-semibold">Analysis Complete</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.06] p-4 text-center">
                      <p className="text-2xl font-bold text-yellow-400">{analysisResult.score}</p>
                      <p className="text-[10px] text-gray-400">Temper Score</p>
                    </div>
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.06] p-4 text-center">
                      <p className="text-2xl font-bold text-orange-400">{analysisResult.biases.length}</p>
                      <p className="text-[10px] text-gray-400">Biases Detected</p>
                    </div>
                    <div className="rounded-xl border border-white/[0.08] bg-white/[0.06] p-4 text-center">
                      <p className="text-sm font-bold text-white">{TRADER_PROFILES[analysisResult.profile].name}</p>
                      <p className="text-[10px] text-gray-400">Profile Match</p>
                    </div>
                  </div>
                  <Link
                    href="/dashboard/analyze"
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-8 py-3.5 text-sm font-semibold text-black transition-all hover:brightness-110"
                  >
                    View Full Analysis
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        )}

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
                  className="sample-card group flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.06] p-4 text-left transition-all hover:bg-white/[0.09] hover:border-white/[0.12]"
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
        <div className="format-info space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.06] p-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
            Supported Formats
          </p>
          <p className="text-sm text-gray-400">
            <strong className="text-white">CSV / Excel</strong> with columns:{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white">timestamp</code>,{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white">asset</code>,{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white">side</code>{' '}
            <span className="text-gray-500">(buy/sell)</span>,{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white">quantity</code>,{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white">entry_price</code>,{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white">exit_price</code>,{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-white">pnl</code>,{' '}
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-emerald-400/60">balance</code>{' '}
            <span className="text-gray-600">(optional)</span>
          </p>
          <p className="text-xs text-gray-500">
            Accepts .csv and .xlsx exports from TradingView, TD Ameritrade, Interactive Brokers, and most brokers. P/L is auto-calculated from entry/exit prices when provided.
          </p>
        </div>
      </div>
    </div>
  );
}
