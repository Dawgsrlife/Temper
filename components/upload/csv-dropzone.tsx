"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type UploadState =
  | "idle"
  | "uploading"
  | "pending"
  | "processing"
  | "completed"
  | "error";

const POLL_INTERVAL = 2_000; // 2 seconds

export function CsvDropzone() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollJob = useCallback(
    (jobId: string) => {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}`);
          if (!res.ok) throw new Error("Failed to fetch job status");
          const data = await res.json();

          if (data.status === "PROCESSING") {
            setState("processing");
            setProgress("Analyzing sessions...");
          }

          if (data.status === "COMPLETED") {
            stopPolling();
            setState("completed");
            const count = data.sessionIds?.length ?? 0;
            setProgress(
              `${count} session${count !== 1 ? "s" : ""} analyzed`,
            );
            setTimeout(() => router.push("/overview"), 1200);
          }

          if (data.status === "FAILED") {
            stopPolling();
            setState("error");
            setError(data.error ?? "Analysis failed");
          }
        } catch {
          stopPolling();
          setState("error");
          setError("Lost connection while polling");
        }
      }, POLL_INTERVAL);
    },
    [router, stopPolling],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".csv")) {
        setError("Please upload a .csv file");
        return;
      }

      setError(null);
      setState("uploading");
      setProgress("Uploading...");

      try {
        // ── Step 1: upload CSV → get jobId (PENDING) ─────────
        const formData = new FormData();
        formData.append("file", file);
        formData.append("userId", "demo-user");

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!uploadRes.ok) {
          const data = await uploadRes.json();
          throw new Error(data.error ?? "Upload failed");
        }

        const { jobId, validRows, parseErrors } = await uploadRes.json();
        setProgress(
          `${validRows} trades parsed${parseErrors?.length > 0 ? ` (${parseErrors.length} warnings)` : ""}. Queued for analysis...`,
        );
        setState("pending");

        // ── Step 2: kick off analysis ────────────────────────
        const analyzeRes = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });

        if (!analyzeRes.ok) {
          const data = await analyzeRes.json();
          throw new Error(data.error ?? "Analysis failed");
        }

        // If analyze returned synchronously with COMPLETED, we're done
        const analyzeData = await analyzeRes.json();
        if (analyzeData.status === "COMPLETED") {
          setState("completed");
          const count = analyzeData.sessionsAnalyzed ?? 0;
          setProgress(
            `${count} session${count !== 1 ? "s" : ""} analyzed. ELO: ${analyzeData.finalElo?.toFixed(0)}`,
          );
          setTimeout(() => router.push("/overview"), 1200);
          return;
        }

        // Otherwise, start polling
        setState("processing");
        setProgress("Analyzing sessions...");
        pollJob(jobId);
      } catch (err) {
        stopPolling();
        setState("error");
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    },
    [router, pollJob, stopPolling],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const busy =
    state === "uploading" ||
    state === "pending" ||
    state === "processing";

  return (
    <div>
      <label
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        className={cn(
          "flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed transition-colors",
          dragOver
            ? "border-accent bg-accent/5"
            : "border-border bg-surface-1 hover:border-muted-foreground hover:bg-surface-2",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={onFileInput}
          disabled={busy}
        />

        {state === "idle" && (
          <div className="text-center">
            <div className="text-sm font-medium text-foreground/80">
              Drop CSV here or click to browse
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              timestamp, symbol, side, qty, price, pnl
            </div>
          </div>
        )}

        {busy && (
          <div className="text-center">
            <div className="text-sm font-medium text-foreground/80">
              {progress}
            </div>
            <div className="mx-auto mt-3 h-1 w-40 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-accent transition-all duration-700"
                style={{
                  width:
                    state === "uploading"
                      ? "20%"
                      : state === "pending"
                        ? "40%"
                        : "70%",
                }}
              />
            </div>
          </div>
        )}

        {state === "completed" && (
          <div className="text-center">
            <div className="text-sm font-medium text-positive">{progress}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Redirecting...
            </div>
          </div>
        )}

        {state === "error" && (
          <div className="text-sm font-medium text-negative">
            Upload failed
          </div>
        )}
      </label>

      {error && (
        <div className="mt-3 rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">
          {error}
        </div>
      )}

      {/* Format reference */}
      <div className="mt-6 rounded-lg border border-border bg-surface-1 p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Expected CSV Format
        </h3>
        <pre className="overflow-x-auto text-[11px] leading-relaxed text-muted-foreground">
{`timestamp,symbol,side,qty,price,pnl,tags
2026-02-06T09:31:00Z,AAPL,LONG,100,188.50,150.00,"scalp"
2026-02-06T09:45:00Z,NVDA,SHORT,50,920.00,-75.00,"reversal"
2026-02-06T10:02:00Z,AAPL,LONG,200,189.00,320.00,""
2026-02-06T10:05:00Z,TSLA,LONG,150,245.00,-180.00,"revenge"
2026-02-06T10:08:00Z,TSLA,LONG,300,244.00,-420.00,""
2026-02-06T10:30:00Z,MSFT,LONG,100,405.00,95.00,"plan"`}
        </pre>
      </div>
    </div>
  );
}
