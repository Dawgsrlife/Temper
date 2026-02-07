import { CsvDropzone } from "@/components/upload/csv-dropzone";

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="animate-slide-down mb-1 text-xl font-semibold">
        Upload Trades
      </h1>
      <p className="animate-slide-up delay-1 mb-8 text-sm text-muted-foreground">
        Drop a CSV file. We analyze your decisions, assign labels,
        and compute your Temper Score and ELO delta.
      </p>
      <div className="animate-slide-up delay-2">
        <CsvDropzone />
      </div>
    </div>
  );
}
