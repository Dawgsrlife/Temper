"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type UploadState = "idle" | "uploading" | "analyzing" | "done" | "error";

export function CsvDropzone() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

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

        const { tradeSetId, validRows, errors } = await uploadRes.json();
        setProgress(
          `${validRows} trades parsed${errors?.length > 0 ? ` (${errors.length} warnings)` : ""}. Analyzing...`,
        );
        setState("analyzing");

        const analyzeRes = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tradeSetId, userId: "demo-user" }),
        });

        if (!analyzeRes.ok) {
          const data = await analyzeRes.json();
          throw new Error(data.error ?? "Analysis failed");
        }

        const { sessionsAnalyzed, finalElo } = await analyzeRes.json();
        setProgress(
          `${sessionsAnalyzed} session${sessionsAnalyzed > 1 ? "s" : ""} analyzed. ELO: ${finalElo?.toFixed(0)}`,
        );
        setState("done");

        setTimeout(() => router.push("/overview"), 1200);
      } catch (err) {
        setState("error");
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    },
    [router],
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
          (state === "uploading" || state === "analyzing") &&
            "pointer-events-none opacity-60",
        )}
      >
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={onFileInput}
          disabled={state === "uploading" || state === "analyzing"}
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

        {(state === "uploading" || state === "analyzing") && (
          <div className="text-center">
            <div className="text-sm font-medium text-foreground/80">
              {progress}
            </div>
            <div className="mx-auto mt-3 h-1 w-40 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-accent transition-all duration-700"
                style={{ width: state === "uploading" ? "35%" : "70%" }}
              />
            </div>
          </div>
        )}

        {state === "done" && (
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
