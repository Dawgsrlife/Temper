-- Temper hackathon metadata schema (Supabase Postgres)
-- Source of truth for job history and artifact pointers.

create table if not exists public.jobs (
  id text primary key,
  user_id text not null,
  created_at timestamptz not null default now(),
  status text not null,
  engine_version text,
  input_sha256 text,
  outcome text,
  delta_pnl double precision,
  cost_of_bias double precision,
  badge_counts jsonb not null default '{}'::jsonb,
  bias_rates jsonb not null default '{}'::jsonb,
  error_type text,
  error_message text,
  coach_status text,
  coach_error_type text,
  coach_error_message text,
  upload_source text,
  uploadthing_file_key text,
  original_filename text,
  byte_size bigint
);

create index if not exists jobs_user_created_idx
  on public.jobs (user_id, created_at desc);

create table if not exists public.job_artifacts (
  id bigserial primary key,
  job_id text not null references public.jobs(id) on delete cascade,
  type text not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (job_id, type)
);

create index if not exists job_artifacts_job_idx
  on public.job_artifacts (job_id, created_at desc);
