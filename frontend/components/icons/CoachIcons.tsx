'use client';

import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

/* ── Brilliant "!!" (teal) ── */
export function BrilliantIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#22C55E" />
      <rect x="9" y="8" width="3" height="12" rx="1.2" fill="white" />
      <circle cx="10.5" cy="22.5" r="1.5" fill="white" />
      <rect x="20" y="8" width="3" height="12" rx="1.2" fill="white" />
      <circle cx="21.5" cy="22.5" r="1.5" fill="white" />
    </svg>
  );
}

/* ── Great "!" (blue) ── */
export function GreatIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#38BDF8" />
      <rect x="14.5" y="7.5" width="3" height="13" rx="1.4" fill="white" />
      <circle cx="16" cy="22.8" r="1.7" fill="white" />
    </svg>
  );
}

/* ── Best / Star (green) ── */
export function BestIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#22C55E" />
      <path d="M16 7.5l2.1 4.3 4.8.7-3.5 3.4.8 4.8L16 18.3l-4.2 2.4.8-4.8-3.5-3.4 4.8-.7L16 7.5z" fill="white" />
    </svg>
  );
}

/* ── Excellent / Thumbs-up (green) ── */
export function ExcellentIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#22C55E" />
      <path d="M9 14.5c0-.7.6-1.3 1.3-1.3h2v7.6h-2c-.7 0-1.3-.6-1.3-1.3v-5z" fill="white" />
      <path d="M13.5 11.5L16 8.2c.4-.5 1.1-.6 1.6-.2.3.2.4.5.4.9l-.4 3.3h2.9c1 0 1.8.8 1.8 1.8 0 .2 0 .4-.1.6l-1 5c-.2.9-1 1.6-2 1.6h-6.7v-9.5z" fill="white" />
    </svg>
  );
}

/* ── Good / Checkmark (light green) ── */
export function GoodIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#A3E635" />
      <path d="M12.1 17.8L9.4 15l-1.6 1.6 4.3 4.3 8.1-8.1-1.6-1.6-6.5 6.6z" fill="white" />
    </svg>
  );
}

/* ── Inaccuracy "?!" (yellow) — "Soft Mistake" ── */
export function InaccuracyIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#FACC15" />
      <path d="M11.3 9.3c1 0 1.8.3 2.4.8.6.5.9 1.2.9 2 0 .9-.4 1.6-1 2.1-.6.4-1.1.7-1.4 1.2-.2.3-.3.6-.3 1v.4h-2.2v-.5c0-.8.3-1.5.8-2 .5-.5 1.1-.8 1.5-1.1.4-.3.6-.7.6-1.2 0-.8-.6-1.3-1.5-1.3-.9 0-1.5.5-1.8 1.3L8 11.4c.4-1.3 1.6-2.1 3.3-2.1z" fill="white" />
      <circle cx="11.3" cy="22.1" r="1.3" fill="white" />
      <rect x="18.4" y="9.2" width="2.4" height="9.1" rx="1.1" fill="white" />
      <circle cx="19.6" cy="21.9" r="1.4" fill="white" />
    </svg>
  );
}

/* ── Mistake "?" (orange) ── */
export function MistakeIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#FB923C" />
      <path d="M16 8.7c1.2 0 2.2.3 3 .9.8.6 1.2 1.5 1.2 2.6 0 1.2-.5 2.1-1.3 2.7-.6.5-1.1.8-1.5 1.3-.4.5-.6 1-.6 1.6v.6h-2.4v-.8c0-1.1.4-2 1.1-2.7.5-.6 1.2-1 1.7-1.4.5-.4.8-.9.8-1.5 0-.9-.7-1.5-1.9-1.5s-2 .7-2.3 1.7L11 12.1c.5-2 2.2-3.4 5-3.4z" fill="white" />
      <circle cx="16" cy="22.8" r="1.6" fill="white" />
    </svg>
  );
}

/* ── Miss "X" (red-orange) — "Missed Win" ── */
export function MissIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#FB7185" />
      <path d="M11 11l3.1 3.1L17.2 11l1.8 1.8-3.1 3.1 3.1 3.1-1.8 1.8-3.1-3.1L11 20.8 9.2 19l3.1-3.1L9.2 12.8 11 11z" fill="white" />
    </svg>
  );
}

/* ── Blunder "??" (red) ── */
export function BlunderIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#EF4444" />
      <path d="M11 9.3c1 0 1.8.3 2.4.8.6.5.9 1.2.9 2 0 .9-.4 1.6-1 2.1-.6.4-1.1.7-1.4 1.2-.2.3-.3.6-.3 1v.4H9.4v-.5c0-.8.3-1.5.8-2 .5-.5 1.1-.8 1.5-1.1.4-.3.6-.7.6-1.2 0-.8-.6-1.3-1.5-1.3-.9 0-1.5.5-1.8 1.3L7.7 11.4c.4-1.3 1.6-2.1 3.3-2.1z" fill="white" />
      <circle cx="11" cy="22.1" r="1.3" fill="white" />
      <path d="M21 9.3c1 0 1.8.3 2.4.8.6.5.9 1.2.9 2 0 .9-.4 1.6-1 2.1-.6.4-1.1.7-1.4 1.2-.2.3-.3.6-.3 1v.4h-2.2v-.5c0-.8.3-1.5.8-2 .5-.5 1.1-.8 1.5-1.1.4-.3.6-.7.6-1.2 0-.8-.6-1.3-1.5-1.3-.9 0-1.5.5-1.8 1.3L17.7 11.4c.4-1.3 1.6-2.1 3.3-2.1z" fill="white" />
      <circle cx="21" cy="22.1" r="1.3" fill="white" />
    </svg>
  );
}

/* ── Megablunder "???" (dark red) — "Tilt Meltdown" ── */
export function MegablunderIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#7F1D1D" />
      <path d="M8.8 10.2c.8 0 1.5.3 2 .7.5.4.7 1 .7 1.6 0 .8-.3 1.3-.9 1.8-.4.3-.8.6-1.1.9-.3.3-.4.6-.4 1v.4H7v-.6c0-.9.3-1.5.8-2 .4-.4.8-.7 1.1-1 .3-.3.5-.6.5-1 0-.6-.4-1-1.1-1-.7 0-1.2.4-1.4 1.1L5.3 11c.4-1.1 1.5-1.8 3.5-1.8z" fill="white" />
      <circle cx="8.8" cy="21" r="1.1" fill="white" />
      <path d="M16 9.4c.8 0 1.5.3 2 .7.5.4.7 1 .7 1.6 0 .8-.3 1.3-.9 1.8-.4.3-.8.6-1.1.9-.3.3-.4.6-.4 1v.4h-2.1v-.6c0-.9.3-1.5.8-2 .4-.4.8-.7 1.1-1 .3-.3.5-.6.5-1 0-.6-.4-1-1.1-1-.7 0-1.2.4-1.4 1.1L12.5 10c.4-1.1 1.5-1.8 3.5-1.8z" fill="white" />
      <circle cx="16" cy="21" r="1.1" fill="white" />
      <path d="M23.2 10.2c.8 0 1.5.3 2 .7.5.4.7 1 .7 1.6 0 .8-.3 1.3-.9 1.8-.4.3-.8.6-1.1.9-.3.3-.4.6-.4 1v.4h-2.1v-.6c0-.9.3-1.5.8-2 .4-.4.8-.7 1.1-1 .3-.3.5-.6.5-1 0-.6-.4-1-1.1-1-.7 0-1.2.4-1.4 1.1L19.7 11c.4-1.1 1.5-1.8 3.5-1.8z" fill="white" />
      <circle cx="23.2" cy="21" r="1.1" fill="white" />
    </svg>
  );
}

/* ── Winner / Crown (green) — "Session Win" ── */
export function WinnerIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#22C55E" />
      <path d="M7.5 11l2.2 7.3h12.6L24.5 11l-3.4 2.5-4-3.8-4 3.8L7.5 11z" fill="white" />
      <rect x="10" y="19" width="12" height="2.8" rx="1.2" fill="white" />
    </svg>
  );
}

/* ── Book / Playbook (tan) ── */
export function PlaybookIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#D1A97C" />
      <path d="M9.5 10.5c1.5-.6 3.2-.6 4.8 0 1.6-.6 3.3-.6 4.8 0 1 .4 1.7 1.4 1.7 2.5v6.5c-1.5-.6-3.2-.6-4.8 0-1.6-.6-3.3-.6-4.8 0V13c0-1.1.7-2.1 1.7-2.5z" fill="white" />
      <path d="M14.3 12.4v6.1c-1.1-.3-2.3-.3-3.4 0v-6.1c1.1-.3 2.3-.3 3.4 0z" fill="#D1A97C" />
    </svg>
  );
}

/* ── Forced Move / Arrow (gray) ── */
export function ForcedIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#9CA3AF" />
      <path d="M9 16h9.2l-3.3-3.3 1.6-1.6 5.6 5.6-5.6 5.6-1.6-1.6 3.3-3.3H9v-3.4z" fill="white" />
    </svg>
  );
}

/* ── Timeout / Clock (red) — "Time Mismanagement" ── */
export function TimeoutIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#F97373" />
      <circle cx="16" cy="16" r="8" fill="none" stroke="white" strokeWidth="2.2" />
      <rect x="15.2" y="11.3" width="1.6" height="5" rx="0.8" fill="white" />
      <rect x="16" y="15.5" width="3.8" height="1.6" rx="0.8" transform="rotate(40 16 15.5)" fill="white" />
    </svg>
  );
}

/* ── Revenge Trading / Arrow-back (red) ── */
export function RevengeIcon({ size = 32, className }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="15" fill="#F97373" />
      <path d="M10.2 11.4L7.4 14.2l2.8 2.8 1.5-1.5-1-1h5.1c2.6 0 4.7 2.1 4.7 4.7v1h2.2v-1c0-3.8-3.1-6.9-6.9-6.9h-5l1-1-1.6-1.9z" fill="white" />
    </svg>
  );
}

/* ── FOMO pill badge (red) ── */
export function FomoIcon({ size = 32, className }: IconProps) {
  const w = size * 1.75;
  return (
    <svg viewBox="0 0 56 24" width={w} height={size * 0.75} className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="54" height="22" rx="11" fill="#F97373" />
      <text x="28" y="16" textAnchor="middle" fill="white" fontFamily="Inter, system-ui, sans-serif" fontSize="11" fontWeight="600">FOMO</text>
    </svg>
  );
}

/* ── Overtrading pill badge ── */
export function OvertradingIcon({ size = 32, className }: IconProps) {
  const w = size * 2.5;
  return (
    <svg viewBox="0 0 80 24" width={w} height={size * 0.75} className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="78" height="22" rx="11" fill="#FB923C" />
      <text x="40" y="16" textAnchor="middle" fill="white" fontFamily="Inter, system-ui, sans-serif" fontSize="10" fontWeight="600">OVERTRADING</text>
    </svg>
  );
}

/* ── Map labels to icons ── */
export const LABEL_ICON_MAP: Record<string, React.FC<IconProps>> = {
  BRILLIANT: BrilliantIcon,
  EXCELLENT: ExcellentIcon,
  GOOD: GoodIcon,
  NEUTRAL: ForcedIcon,
  INACCURACY: InaccuracyIcon,
  MISTAKE: MistakeIcon,
  BLUNDER: BlunderIcon,
};

/* ── Map bias types to icons ── */
export const BIAS_ICON_MAP: Record<string, React.FC<IconProps>> = {
  OVERTRADING: OvertradingIcon,
  REVENGE_TRADING: RevengeIcon,
  FOMO: FomoIcon,
  LOSS_AVERSION: MissIcon,
  DISCIPLINE_BREAK: TimeoutIcon,
};

/* ── Convenience: get icon for a label ── */
export function getLabelIcon(label: string): React.FC<IconProps> {
  return LABEL_ICON_MAP[label] || ForcedIcon;
}
