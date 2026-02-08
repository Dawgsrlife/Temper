'use client';

import { CsvDropzone } from '@/components/upload/csv-dropzone';

export default function UploadPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] px-6 py-8 text-white md:px-10 md:py-10 lg:px-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Import</p>
          <h1 className="font-coach text-3xl font-semibold tracking-tight text-white md:text-4xl">
            Upload Trading Data
          </h1>
          <p className="pt-1 text-sm text-gray-500">
            Real backend pipeline: upload CSV, run deterministic analysis, then open game review.
          </p>
        </header>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
          <CsvDropzone />
        </div>
      </div>
    </div>
  );
}
