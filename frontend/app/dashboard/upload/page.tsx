'use client';

import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { UploadCloud, FileText, X, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function UploadPage() {
  const container = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const router = useRouter();

  useGSAP(() => {
    gsap.from('.reveal', {
      opacity: 0,
      y: 30,
      stagger: 0.1,
      duration: 0.8,
      ease: 'power3.out',
    });
  }, { scope: container });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === 'text/csv' || droppedFile?.name.endsWith('.csv')) {
      setFile(droppedFile);
    }
  };

  const handleUpload = () => {
    if (!file) return;
    setUploading(true);
    // Simulate upload
    setTimeout(() => {
      router.push('/dashboard/sessions/demo');
    }, 1500);
  };

  return (
    <div ref={container} className="flex min-h-screen items-center justify-center bg-gradient-to-br from-temper-bg via-temper-bg to-temper-surface/30 p-8">
      <div className="mx-auto w-full max-w-xl space-y-8">
        {/* Header */}
        <header className="reveal space-y-2 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-temper-teal">
            Import Session
          </p>
          <h1 className="font-coach text-4xl font-bold italic tracking-tight text-temper-text md:text-5xl">
            Upload Trades
          </h1>
          <p className="mx-auto max-w-md text-sm text-temper-muted">
            Drop your trade CSV from DAS, TOS, IBKR, or any broker export
          </p>
        </header>

        {/* Drop Zone */}
        <div
          className={`reveal relative overflow-hidden rounded-3xl border-2 border-dashed p-12 text-center transition-all ${isDragging
              ? 'border-temper-teal bg-temper-teal/5'
              : file
                ? 'border-temper-teal/50 bg-temper-surface/50'
                : 'border-temper-border/50 bg-temper-surface/30 hover:border-temper-border'
            }`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {file ? (
            <div className="space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-temper-teal/10">
                <FileText className="h-8 w-8 text-temper-teal" />
              </div>
              <div>
                <p className="font-medium text-temper-text">{file.name}</p>
                <p className="text-xs text-temper-muted">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <button
                onClick={() => setFile(null)}
                className="mx-auto flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-temper-muted transition-colors hover:text-temper-red"
              >
                <X className="h-3 w-3" />
                Remove
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-temper-subtle ring-1 ring-temper-border/30">
                <UploadCloud className="h-10 w-10 text-temper-muted" />
              </div>
              <div>
                <p className="font-medium text-temper-text">
                  Drag and drop your CSV here
                </p>
                <p className="text-sm text-temper-muted">or click to browse</p>
              </div>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </div>
          )}
        </div>

        {/* Upload Button */}
        {file && (
          <button
            onClick={handleUpload}
            disabled={uploading}
            className="reveal flex w-full items-center justify-center gap-3 rounded-2xl bg-temper-teal py-5 text-sm font-bold uppercase tracking-[0.2em] text-temper-bg shadow-lg shadow-temper-teal/20 transition-all hover:shadow-temper-teal/40 disabled:opacity-70"
          >
            {uploading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-temper-bg border-t-transparent" />
                Analyzing...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Analyze Session
              </>
            )}
          </button>
        )}

        {/* Supported Formats */}
        <div className="reveal text-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-temper-muted">
            Supported: DAS Trader • ThinkorSwim • Interactive Brokers • TradeStation
          </p>
        </div>
      </div>
    </div>
  );
}
