import { CsvDropzone } from "@/components/upload/csv-dropzone";

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-2 text-2xl font-semibold">Upload Trade CSV</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Upload your file to run deterministic bias analysis and review.
      </p>
      <CsvDropzone />
    </div>
  );
}
