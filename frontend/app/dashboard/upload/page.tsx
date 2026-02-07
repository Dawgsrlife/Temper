'use client';

import { useRef, useState, useCallback } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { Upload, FileText, X, Check, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function UploadPage() {
  const container = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  useGSAP(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.from('.page-header', { y: 20, opacity: 0, duration: 0.5 })
      .from('.upload-zone', { y: 30, opacity: 0, duration: 0.5 }, '-=0.3');
  }, { scope: container });

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
    if (droppedFile?.name.endsWith('.csv')) {
      setFile(droppedFile);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleUpload = () => {
    if (!file) return;
    setIsUploading(true);

    // Simulate upload
    setTimeout(() => {
      setIsUploading(false);
      setIsComplete(true);
    }, 2000);
  };

  const removeFile = () => {
    setFile(null);
    setIsComplete(false);
  };

  return (
    <div ref={container} className="px-6 py-8 md:px-10 md:py-10 lg:px-12">
      <div className="mx-auto max-w-xl space-y-8">
        {/* Header */}
        <header className="page-header space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-temper-teal">
            Import
          </p>
          <h1 className="text-3xl font-medium tracking-tight text-temper-text">
            Upload Session
          </h1>
          <p className="pt-2 text-sm text-temper-muted">
            Import your trade history as a CSV file. We support exports from most brokers.
          </p>
        </header>

        {/* Upload Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`upload-zone relative overflow-hidden rounded-2xl border-2 border-dashed p-12 text-center transition-all ${isDragging
              ? 'border-temper-teal bg-temper-teal/5'
              : file
                ? 'border-temper-border/30 bg-temper-surface/50'
                : 'border-temper-border/30 bg-temper-surface/30 hover:bg-temper-surface/50'
            }`}
        >
          {!file ? (
            <>
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-temper-teal/10">
                <Upload className="h-6 w-6 text-temper-teal" />
              </div>
              <p className="mb-2 text-sm font-medium text-temper-text">
                Drop your CSV file here
              </p>
              <p className="mb-5 text-xs text-temper-muted">or</p>
              <label className="inline-block cursor-pointer rounded-lg bg-temper-surface px-6 py-2.5 text-sm font-medium text-temper-text ring-1 ring-temper-border/30 transition-all hover:ring-temper-border/50">
                Browse Files
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </label>
            </>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between rounded-xl bg-temper-bg/50 p-4 ring-1 ring-temper-border/20">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-temper-teal/10 p-2">
                    <FileText className="h-4 w-4 text-temper-teal" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-temper-text">{file.name}</p>
                    <p className="text-xs text-temper-muted">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                {!isComplete && (
                  <button
                    onClick={removeFile}
                    className="rounded-lg p-2 text-temper-muted transition-colors hover:bg-temper-surface hover:text-temper-text"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {isComplete ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-2 text-temper-teal">
                    <Check className="h-5 w-5" />
                    <span className="text-sm font-medium">Processing complete</span>
                  </div>
                  <Link
                    href="/dashboard/sessions/demo"
                    className="inline-flex items-center gap-2 rounded-xl bg-temper-teal px-6 py-3 text-sm font-semibold text-temper-bg transition-all hover:bg-white"
                  >
                    View Session
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <button
                  onClick={handleUpload}
                  disabled={isUploading}
                  className="inline-flex items-center gap-2 rounded-xl bg-temper-teal px-8 py-3 text-sm font-semibold text-temper-bg transition-all hover:bg-white disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-temper-bg border-t-transparent" />
                      Analyzing...
                    </>
                  ) : (
                    'Analyze Trades'
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="space-y-3 rounded-2xl bg-temper-surface/30 p-5 ring-1 ring-temper-border/10">
          <p className="text-xs font-medium uppercase tracking-wider text-temper-muted">
            Supported Format
          </p>
          <p className="text-sm text-temper-muted">
            CSV with columns: <code className="text-temper-text">timestamp, asset, side, quantity</code>
          </p>
          <p className="text-xs text-temper-muted">
            Works with TradingView, TD Ameritrade, Interactive Brokers, and more.
          </p>
        </div>
      </div>
    </div>
  );
}
