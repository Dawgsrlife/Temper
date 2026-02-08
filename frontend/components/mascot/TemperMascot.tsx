'use client';

import React, { useRef, useEffect } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

/* ─────────────────────────────────────────────────────────────
 *  Temper Mascot – An expressive flame creature that reacts
 *  to trade quality labels with cute emotional animations.
 *
 *  Labels:  BRILLIANT · EXCELLENT · GOOD · BOOK
 *           INACCURACY · MISTAKE · BLUNDER · MISSED_WIN
 * ───────────────────────────────────────────────────────────── */

export interface TemperMascotProps {
  /** DecisionLabel string (e.g. "BRILLIANT", "BLUNDER") */
  label: string;
  /** Pixel size of the mascot (width & height). Default 120. */
  size?: number;
  /** Whether to animate on mount / label change. Default true. */
  animate?: boolean;
  /** Optional extra className for the wrapper. */
  className?: string;
  /** Show the label text beneath the mascot. */
  showLabel?: boolean;
  /** Show a speech bubble with a short quip. */
  showBubble?: boolean;
}

/* ── Palette per label ── */
interface MascotTheme {
  body: string;       // main body gradient stop 1
  bodyEnd: string;    // main body gradient stop 2
  glow: string;       // outer glow color
  cheeks: string;     // blush color
  mouth: 'happy' | 'grin' | 'smile' | 'neutral' | 'worried' | 'sad' | 'shocked' | 'cry';
  eyes: 'sparkle' | 'happy' | 'normal' | 'book' | 'worried' | 'sad' | 'xeyes' | 'side';
  brows: 'raised' | 'happy' | 'normal' | 'book' | 'worried' | 'angry' | 'scared' | 'sad';
  extras: 'stars' | 'sparkle' | 'none' | 'sweat' | 'tears' | 'question';
  quip: string;
  labelColor: string;
}

const THEMES: Record<string, MascotTheme> = {
  BRILLIANT: {
    body: '#06D6A0', bodyEnd: '#00B4D8', glow: '#06D6A0',
    cheeks: '#FF6B9D', mouth: 'grin', eyes: 'sparkle', brows: 'raised',
    extras: 'stars', quip: 'Incredible move!', labelColor: '#06D6A0',
  },
  EXCELLENT: {
    body: '#22C55E', bodyEnd: '#16A34A', glow: '#22C55E',
    cheeks: '#FF8FAB', mouth: 'happy', eyes: 'happy', brows: 'happy',
    extras: 'sparkle', quip: 'Great discipline!', labelColor: '#22C55E',
  },
  GOOD: {
    body: '#86EFAC', bodyEnd: '#4ADE80', glow: '#86EFAC',
    cheeks: '#FFC0CB', mouth: 'smile', eyes: 'normal', brows: 'normal',
    extras: 'none', quip: 'Solid trade.', labelColor: '#86EFAC',
  },
  BOOK: {
    body: '#60A5FA', bodyEnd: '#3B82F6', glow: '#60A5FA',
    cheeks: '#C4B5FD', mouth: 'neutral', eyes: 'book', brows: 'book',
    extras: 'none', quip: 'By the book.', labelColor: '#60A5FA',
  },
  INACCURACY: {
    body: '#FACC15', bodyEnd: '#EAB308', glow: '#FACC15',
    cheeks: '#FDE68A', mouth: 'worried', eyes: 'worried', brows: 'worried',
    extras: 'sweat', quip: 'Hmm, be careful...', labelColor: '#FACC15',
  },
  MISTAKE: {
    body: '#FB923C', bodyEnd: '#F97316', glow: '#FB923C',
    cheeks: '#FDBA74', mouth: 'sad', eyes: 'sad', brows: 'angry',
    extras: 'sweat', quip: 'Ouch, that hurt.', labelColor: '#FB923C',
  },
  BLUNDER: {
    body: '#EF4444', bodyEnd: '#DC2626', glow: '#EF4444',
    cheeks: '#FCA5A5', mouth: 'shocked', eyes: 'xeyes', brows: 'scared',
    extras: 'tears', quip: 'Oh no...!', labelColor: '#EF4444',
  },
  MISSED_WIN: {
    body: '#94A3B8', bodyEnd: '#64748B', glow: '#94A3B8',
    cheeks: '#CBD5E1', mouth: 'cry', eyes: 'side', brows: 'sad',
    extras: 'tears', quip: 'So close...', labelColor: '#94A3B8',
  },
};

const DEFAULT_THEME: MascotTheme = THEMES.BOOK;

/* ═══════════════════════════════════════════════════════════════ */
/*  SVG Sub-Components                                             */
/* ═══════════════════════════════════════════════════════════════ */

function MascotEyes({ type, cx1, cx2, cy }: { type: string; cx1: number; cx2: number; cy: number }) {
  switch (type) {
    case 'sparkle':
      return (
        <>
          {/* Star-sparkle eyes */}
          <g className="mascot-eyes">
            {[cx1, cx2].map((cx, i) => (
              <g key={i}>
                <circle cx={cx} cy={cy} r="5" fill="white" />
                <circle cx={cx} cy={cy} r="3.2" fill="#1a1a2e" />
                <circle cx={cx - 1} cy={cy - 1.2} r="1.3" fill="white" />
                <circle cx={cx + 1.5} cy={cy + 0.8} r="0.7" fill="white" />
                {/* Star sparkle */}
                <path
                  d={`M${cx} ${cy - 7} l1 2.5 2.5 1 -2.5 1 -1 2.5 -1 -2.5 -2.5 -1 2.5 -1z`}
                  fill="white"
                  opacity="0.9"
                  className="mascot-sparkle"
                />
              </g>
            ))}
          </g>
        </>
      );
    case 'happy':
      return (
        <g className="mascot-eyes">
          {/* Happy squinted arc eyes */}
          <path d={`M${cx1 - 4} ${cy + 1} Q${cx1} ${cy - 5} ${cx1 + 4} ${cy + 1}`} stroke="#1a1a2e" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d={`M${cx2 - 4} ${cy + 1} Q${cx2} ${cy - 5} ${cx2 + 4} ${cy + 1}`} stroke="#1a1a2e" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'worried':
      return (
        <g className="mascot-eyes">
          {[cx1, cx2].map((cx, i) => (
            <g key={i}>
              <ellipse cx={cx} cy={cy + 1} rx="4" ry="5" fill="white" />
              <circle cx={cx} cy={cy + 2} r="2.8" fill="#1a1a2e" />
              <circle cx={cx - 0.8} cy={cy + 1} r="1" fill="white" />
            </g>
          ))}
        </g>
      );
    case 'sad':
      return (
        <g className="mascot-eyes">
          {[cx1, cx2].map((cx, i) => (
            <g key={i}>
              <ellipse cx={cx} cy={cy + 1} rx="3.5" ry="4.5" fill="white" />
              <circle cx={cx} cy={cy + 2.5} r="2.5" fill="#1a1a2e" />
              <circle cx={cx - 0.8} cy={cy + 1.5} r="0.9" fill="white" />
            </g>
          ))}
        </g>
      );
    case 'xeyes':
      return (
        <g className="mascot-eyes">
          {[cx1, cx2].map((cx, i) => (
            <g key={i}>
              <line x1={cx - 3.5} y1={cy - 3.5} x2={cx + 3.5} y2={cy + 3.5} stroke="#1a1a2e" strokeWidth="2.5" strokeLinecap="round" />
              <line x1={cx + 3.5} y1={cy - 3.5} x2={cx - 3.5} y2={cy + 3.5} stroke="#1a1a2e" strokeWidth="2.5" strokeLinecap="round" />
            </g>
          ))}
        </g>
      );
    case 'side':
      return (
        <g className="mascot-eyes">
          {[cx1, cx2].map((cx, i) => (
            <g key={i}>
              <ellipse cx={cx} cy={cy} rx="4" ry="4.5" fill="white" />
              <circle cx={cx + 1.5} cy={cy + 0.5} r="2.5" fill="#1a1a2e" />
              <circle cx={cx + 0.8} cy={cy - 0.5} r="0.8" fill="white" />
            </g>
          ))}
        </g>
      );
    case 'book':
      return (
        <g className="mascot-eyes">
          {[cx1, cx2].map((cx, i) => (
            <g key={i}>
              <ellipse cx={cx} cy={cy} rx="3.8" ry="4" fill="white" />
              <circle cx={cx} cy={cy + 0.3} r="2.5" fill="#1a1a2e" />
              <circle cx={cx - 0.7} cy={cy - 0.7} r="1" fill="white" />
            </g>
          ))}
        </g>
      );
    default: // normal
      return (
        <g className="mascot-eyes">
          {[cx1, cx2].map((cx, i) => (
            <g key={i}>
              <ellipse cx={cx} cy={cy} rx="4" ry="4.5" fill="white" />
              <circle cx={cx} cy={cy + 0.5} r="2.8" fill="#1a1a2e" />
              <circle cx={cx - 1} cy={cy - 0.5} r="1.1" fill="white" />
            </g>
          ))}
        </g>
      );
  }
}

function MascotBrows({ type, cx1, cx2, cy }: { type: string; cx1: number; cx2: number; cy: number }) {
  const y = cy - 9;
  switch (type) {
    case 'raised':
      return (
        <g className="mascot-brows">
          <path d={`M${cx1 - 5} ${y - 2} Q${cx1} ${y - 5} ${cx1 + 5} ${y - 2}`} stroke="#1a1a2e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d={`M${cx2 - 5} ${y - 2} Q${cx2} ${y - 5} ${cx2 + 5} ${y - 2}`} stroke="#1a1a2e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'happy':
      return (
        <g className="mascot-brows">
          <path d={`M${cx1 - 4} ${y} Q${cx1} ${y - 2} ${cx1 + 4} ${y}`} stroke="#1a1a2e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d={`M${cx2 - 4} ${y} Q${cx2} ${y - 2} ${cx2 + 4} ${y}`} stroke="#1a1a2e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'worried':
      return (
        <g className="mascot-brows">
          <path d={`M${cx1 - 5} ${y - 3} Q${cx1} ${y} ${cx1 + 5} ${y - 1}`} stroke="#1a1a2e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <path d={`M${cx2 - 5} ${y - 1} Q${cx2} ${y} ${cx2 + 5} ${y - 3}`} stroke="#1a1a2e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'angry':
      return (
        <g className="mascot-brows">
          <path d={`M${cx1 - 5} ${y - 2} L${cx1 + 4} ${y + 1}`} stroke="#1a1a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d={`M${cx2 - 4} ${y + 1} L${cx2 + 5} ${y - 2}`} stroke="#1a1a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'scared':
      return (
        <g className="mascot-brows">
          <path d={`M${cx1 - 5} ${y - 1} Q${cx1} ${y - 5} ${cx1 + 5} ${y + 1}`} stroke="#1a1a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d={`M${cx2 - 5} ${y + 1} Q${cx2} ${y - 5} ${cx2 + 5} ${y - 1}`} stroke="#1a1a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'sad':
      return (
        <g className="mascot-brows">
          <path d={`M${cx1 - 4} ${y - 1} Q${cx1} ${y - 3} ${cx1 + 4} ${y + 1}`} stroke="#1a1a2e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <path d={`M${cx2 - 4} ${y + 1} Q${cx2} ${y - 3} ${cx2 + 4} ${y - 1}`} stroke="#1a1a2e" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'book':
      return (
        <g className="mascot-brows">
          <line x1={cx1 - 4} y1={y} x2={cx1 + 4} y2={y} stroke="#1a1a2e" strokeWidth="1.5" strokeLinecap="round" />
          <line x1={cx2 - 4} y1={y} x2={cx2 + 4} y2={y} stroke="#1a1a2e" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      );
    default: // normal
      return (
        <g className="mascot-brows">
          <line x1={cx1 - 4} y1={y} x2={cx1 + 4} y2={y - 1} stroke="#1a1a2e" strokeWidth="1.5" strokeLinecap="round" />
          <line x1={cx2 - 4} y1={y - 1} x2={cx2 + 4} y2={y} stroke="#1a1a2e" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      );
  }
}

function MascotMouth({ type, cx, cy }: { type: string; cx: number; cy: number }) {
  switch (type) {
    case 'grin':
      return (
        <g className="mascot-mouth">
          <path d={`M${cx - 8} ${cy - 2} Q${cx} ${cy + 10} ${cx + 8} ${cy - 2}`} fill="#1a1a2e" />
          <path d={`M${cx - 6} ${cy - 1} Q${cx} ${cy + 2} ${cx + 6} ${cy - 1}`} fill="white" opacity="0.9" />
          {/* Tongue */}
          <ellipse cx={cx} cy={cy + 5} rx="3.5" ry="2.5" fill="#FF6B9D" />
        </g>
      );
    case 'happy':
      return (
        <g className="mascot-mouth">
          <path d={`M${cx - 7} ${cy - 1} Q${cx} ${cy + 8} ${cx + 7} ${cy - 1}`} fill="#1a1a2e" />
          <path d={`M${cx - 5} ${cy} Q${cx} ${cy + 2} ${cx + 5} ${cy}`} fill="white" opacity="0.8" />
        </g>
      );
    case 'smile':
      return (
        <g className="mascot-mouth">
          <path d={`M${cx - 5} ${cy} Q${cx} ${cy + 5} ${cx + 5} ${cy}`} stroke="#1a1a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'worried':
      return (
        <g className="mascot-mouth">
          <path d={`M${cx - 4} ${cy + 2} Q${cx} ${cy - 2} ${cx + 4} ${cy + 2}`} stroke="#1a1a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'sad':
      return (
        <g className="mascot-mouth">
          <path d={`M${cx - 5} ${cy + 2} Q${cx} ${cy - 3} ${cx + 5} ${cy + 2}`} stroke="#1a1a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'shocked':
      return (
        <g className="mascot-mouth">
          <ellipse cx={cx} cy={cy + 1} rx="4" ry="5" fill="#1a1a2e" />
          <ellipse cx={cx} cy={cy + 1} rx="2.5" ry="3" fill="#3a1a2e" opacity="0.5" />
        </g>
      );
    case 'cry':
      return (
        <g className="mascot-mouth">
          <path d={`M${cx - 5} ${cy + 3} Q${cx} ${cy - 3} ${cx + 5} ${cy + 3}`} stroke="#1a1a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
          {/* Quivering lip line */}
          <path d={`M${cx - 3} ${cy + 4} Q${cx} ${cy + 5.5} ${cx + 3} ${cy + 4}`} stroke="#1a1a2e" strokeWidth="0.8" fill="none" opacity="0.5" />
        </g>
      );
    default: // neutral
      return (
        <g className="mascot-mouth">
          <line x1={cx - 4} y1={cy + 1} x2={cx + 4} y2={cy + 1} stroke="#1a1a2e" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
  }
}

function MascotExtras({ type, width }: { type: string; width: number }) {
  const cx = width / 2;
  switch (type) {
    case 'stars':
      return (
        <g className="mascot-extras">
          {/* Floating stars */}
          <path d="M18 8 l1.5 3 3 0.8 -2.2 2.2 0.5 3 -2.8-1.5 -2.8 1.5 0.5-3 -2.2-2.2 3-0.8z" fill="#FFD700" opacity="0.9" className="mascot-star-1" />
          <path d="M78 12 l1 2 2 0.5 -1.5 1.5 0.3 2 -1.8-1 -1.8 1 0.3-2 -1.5-1.5 2-0.5z" fill="#FFD700" opacity="0.8" className="mascot-star-2" />
          <path d="M52 5 l0.8 1.6 1.6 0.4 -1.2 1.2 0.3 1.6 -1.5-0.8 -1.5 0.8 0.3-1.6 -1.2-1.2 1.6-0.4z" fill="#FFD700" opacity="0.7" className="mascot-star-3" />
        </g>
      );
    case 'sparkle':
      return (
        <g className="mascot-extras">
          {/* Small sparkle dots */}
          <circle cx={20} cy={10} r="2" fill="white" opacity="0.6" className="mascot-dot-1" />
          <circle cx={cx + 22} cy={8} r="1.5" fill="white" opacity="0.5" className="mascot-dot-2" />
          <circle cx={cx - 5} cy={5} r="1.8" fill="white" opacity="0.4" className="mascot-dot-3" />
        </g>
      );
    case 'sweat':
      return (
        <g className="mascot-extras">
          {/* Sweat drop */}
          <path d={`M${cx + 22} 28 Q${cx + 24} 22 ${cx + 26} 28 Q${cx + 24} 32 ${cx + 22} 28z`} fill="#87CEEB" opacity="0.8" className="mascot-sweat" />
        </g>
      );
    case 'tears':
      return (
        <g className="mascot-extras">
          {/* Tear streams */}
          <path d={`M${cx - 12} 52 Q${cx - 13} 58 ${cx - 11} 64`} stroke="#87CEEB" strokeWidth="2" fill="none" opacity="0.6" strokeLinecap="round" className="mascot-tear-l" />
          <path d={`M${cx + 12} 52 Q${cx + 13} 58 ${cx + 11} 64`} stroke="#87CEEB" strokeWidth="2" fill="none" opacity="0.6" strokeLinecap="round" className="mascot-tear-r" />
        </g>
      );
    case 'question':
      return (
        <g className="mascot-extras">
          <text x={cx + 20} y="18" fill="white" fontSize="14" fontWeight="bold" opacity="0.7" className="mascot-question">?</text>
        </g>
      );
    default:
      return null;
  }
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Main Mascot Component                                          */
/* ═══════════════════════════════════════════════════════════════ */

export default function TemperMascot({
  label,
  size = 120,
  animate = true,
  className = '',
  showLabel = false,
  showBubble = false,
}: TemperMascotProps) {
  const theme = THEMES[label] || DEFAULT_THEME;
  const svgRef = useRef<SVGSVGElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const id = `mascot-${label}-${Math.random().toString(36).slice(2, 6)}`;

  /* ── Idle breathing animation ── */
  useGSAP(() => {
    if (!animate || !svgRef.current) return;
    const body = svgRef.current.querySelector('.mascot-body');
    if (!body) return;

    gsap.to(body, {
      scaleY: 1.03,
      scaleX: 0.97,
      transformOrigin: '50% 80%',
      duration: 1.8,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
    });
  }, [animate]);

  /* ── Label-change bounce + reaction ── */
  useGSAP(() => {
    if (!animate || !svgRef.current) return;

    const tl = gsap.timeline({ defaults: { ease: 'back.out(2)' } });

    // Bounce the whole mascot
    tl.fromTo(
      svgRef.current,
      { scale: 0.7, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.5 },
    );

    // Animate eyes
    const eyes = svgRef.current.querySelector('.mascot-eyes');
    if (eyes) {
      tl.fromTo(eyes, { scale: 0.5, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.3 }, '-=0.2');
    }

    // Animate extras (stars, sparkles, sweat, tears)
    const extras = svgRef.current.querySelectorAll('.mascot-star-1, .mascot-star-2, .mascot-star-3');
    if (extras.length) {
      tl.fromTo(extras, { scale: 0, rotation: -45, transformOrigin: '50% 50%' }, { scale: 1, rotation: 0, stagger: 0.1, duration: 0.4 }, '-=0.2');
      // Continuous float for stars
      extras.forEach((star, i) => {
        gsap.to(star, {
          y: -3 + i,
          duration: 1.5 + i * 0.3,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
          delay: i * 0.2,
        });
      });
    }

    // Sparkle dots float
    const dots = svgRef.current.querySelectorAll('.mascot-dot-1, .mascot-dot-2, .mascot-dot-3');
    dots.forEach((dot, i) => {
      gsap.to(dot, {
        y: -4,
        opacity: 0.8,
        duration: 1.2 + i * 0.2,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        delay: i * 0.3,
      });
    });

    // Sparkle pulse on brilliant eyes
    const sparkles = svgRef.current.querySelectorAll('.mascot-sparkle');
    if (sparkles.length) {
      sparkles.forEach((s, i) => {
        gsap.to(s, {
          scale: 1.3,
          opacity: 0.5,
          transformOrigin: '50% 50%',
          duration: 0.8,
          ease: 'sine.inOut',
          yoyo: true,
          repeat: -1,
          delay: i * 0.4,
        });
      });
    }

    // Sweat drop fall
    const sweat = svgRef.current.querySelector('.mascot-sweat');
    if (sweat) {
      gsap.to(sweat, {
        y: 8,
        opacity: 0,
        duration: 1.5,
        ease: 'power1.in',
        repeat: -1,
        repeatDelay: 1,
      });
    }

    // Tear streams
    const tearL = svgRef.current.querySelector('.mascot-tear-l');
    const tearR = svgRef.current.querySelector('.mascot-tear-r');
    [tearL, tearR].forEach((tear) => {
      if (tear) {
        gsap.fromTo(
          tear,
          { strokeDasharray: '0 20', opacity: 0.4 },
          { strokeDasharray: '10 10', opacity: 0.8, duration: 1.2, ease: 'sine.inOut', yoyo: true, repeat: -1 },
        );
      }
    });

    // Bubble entrance
    if (showBubble && bubbleRef.current) {
      tl.fromTo(
        bubbleRef.current,
        { scale: 0, opacity: 0, transformOrigin: '0% 100%' },
        { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2.5)' },
        '-=0.1',
      );
    }
  }, [label, animate, showBubble]);

  /* ── Emotion-specific auto-animations ── */
  useGSAP(() => {
    if (!animate || !svgRef.current) return;

    // Blunder: shake the whole thing
    if (label === 'BLUNDER') {
      gsap.to(svgRef.current, {
        x: 2, duration: 0.08, yoyo: true, repeat: 5, ease: 'power1.inOut',
        delay: 0.5,
      });
    }

    // Brilliant: quick celebratory jump
    if (label === 'BRILLIANT') {
      gsap.to(svgRef.current, {
        y: -6, duration: 0.25, yoyo: true, repeat: 1, ease: 'power2.out',
        delay: 0.4,
      });
    }

    // Mistake: slight droop
    if (label === 'MISTAKE') {
      gsap.to(svgRef.current, {
        rotation: -3, duration: 0.4, ease: 'power2.out',
        delay: 0.5,
      });
      gsap.to(svgRef.current, {
        rotation: 0, duration: 0.6, ease: 'elastic.out(1, 0.5)',
        delay: 0.9,
      });
    }

    // Missed win: slow sad tilt
    if (label === 'MISSED_WIN') {
      gsap.to(svgRef.current, {
        rotation: -5, duration: 0.8, ease: 'power1.out',
        delay: 0.3,
      });
      gsap.to(svgRef.current, {
        rotation: 0, duration: 1, ease: 'power1.out',
        delay: 1.5,
      });
    }
  }, [label, animate]);

  const viewW = 100;
  const viewH = 110;
  const bodyCx = viewW / 2;
  const bodyCy = 58;
  const eyesCy = 48;
  const mouthCy = 62;

  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewW} ${viewH}`}
          width={size}
          height={size * (viewH / viewW)}
          xmlns="http://www.w3.org/2000/svg"
          className="overflow-visible"
        >
          <defs>
            {/* Body gradient */}
            <radialGradient id={`${id}-body`} cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor={theme.body} />
              <stop offset="100%" stopColor={theme.bodyEnd} />
            </radialGradient>
            {/* Glow filter */}
            <filter id={`${id}-glow`}>
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Inner highlight */}
            <radialGradient id={`${id}-highlight`} cx="40%" cy="30%" r="50%">
              <stop offset="0%" stopColor="white" stopOpacity="0.35" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* ── Outer glow ── */}
          <ellipse
            cx={bodyCx}
            cy={bodyCy + 8}
            rx="32"
            ry="6"
            fill={theme.glow}
            opacity="0.15"
          />

          {/* ── Main body (rounded flame shape) ── */}
          <g className="mascot-body">
            {/* Shadow */}
            <ellipse cx={bodyCx} cy={bodyCy + 28} rx="22" ry="4" fill="black" opacity="0.15" />

            {/* Body shape – a cute bean/flame hybrid */}
            <path
              d={`
                M${bodyCx} ${bodyCy - 32}
                C${bodyCx - 8} ${bodyCy - 28} ${bodyCx - 28} ${bodyCy - 15} ${bodyCx - 26} ${bodyCy}
                C${bodyCx - 24} ${bodyCy + 14} ${bodyCx - 18} ${bodyCy + 24} ${bodyCx} ${bodyCy + 26}
                C${bodyCx + 18} ${bodyCy + 24} ${bodyCx + 24} ${bodyCy + 14} ${bodyCx + 26} ${bodyCy}
                C${bodyCx + 28} ${bodyCy - 15} ${bodyCx + 8} ${bodyCy - 28} ${bodyCx} ${bodyCy - 32}
                Z
              `}
              fill={`url(#${id}-body)`}
              filter={`url(#${id}-glow)`}
            />

            {/* Inner highlight */}
            <path
              d={`
                M${bodyCx} ${bodyCy - 32}
                C${bodyCx - 8} ${bodyCy - 28} ${bodyCx - 28} ${bodyCy - 15} ${bodyCx - 26} ${bodyCy}
                C${bodyCx - 24} ${bodyCy + 14} ${bodyCx - 18} ${bodyCy + 24} ${bodyCx} ${bodyCy + 26}
                C${bodyCx + 18} ${bodyCy + 24} ${bodyCx + 24} ${bodyCy + 14} ${bodyCx + 26} ${bodyCy}
                C${bodyCx + 28} ${bodyCy - 15} ${bodyCx + 8} ${bodyCy - 28} ${bodyCx} ${bodyCy - 32}
                Z
              `}
              fill={`url(#${id}-highlight)`}
            />

            {/* Flame tip accent */}
            <path
              d={`
                M${bodyCx} ${bodyCy - 32}
                C${bodyCx - 4} ${bodyCy - 26} ${bodyCx + 4} ${bodyCy - 26} ${bodyCx} ${bodyCy - 32}
              `}
              fill="white"
              opacity="0.5"
            />

            {/* ── Cheek blush ── */}
            <ellipse cx={bodyCx - 16} cy={eyesCy + 7} rx="5" ry="3" fill={theme.cheeks} opacity="0.4" />
            <ellipse cx={bodyCx + 16} cy={eyesCy + 7} rx="5" ry="3" fill={theme.cheeks} opacity="0.4" />

            {/* ── Face ── */}
            <MascotBrows type={theme.brows} cx1={bodyCx - 10} cx2={bodyCx + 10} cy={eyesCy} />
            <MascotEyes type={theme.eyes} cx1={bodyCx - 10} cx2={bodyCx + 10} cy={eyesCy} />
            <MascotMouth type={theme.mouth} cx={bodyCx} cy={mouthCy} />
          </g>

          {/* ── Floating extras (stars, sparkles, tears, sweat) ── */}
          <MascotExtras type={theme.extras} width={viewW} />

          {/* ── Tiny feet ── */}
          <ellipse cx={bodyCx - 8} cy={bodyCy + 27} rx="5" ry="2.5" fill={theme.bodyEnd} opacity="0.8" />
          <ellipse cx={bodyCx + 8} cy={bodyCy + 27} rx="5" ry="2.5" fill={theme.bodyEnd} opacity="0.8" />
        </svg>

        {/* ── Speech bubble ── */}
        {showBubble && (
          <div
            ref={bubbleRef}
            className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-xl bg-white/[0.1] backdrop-blur-sm px-3 py-1.5 text-[11px] font-medium text-white shadow-lg border border-white/[0.08]"
            style={{ transformOrigin: '50% 100%' }}
          >
            <span style={{ color: theme.labelColor }}>{theme.quip}</span>
            {/* Bubble tail (centered below) */}
            <div className="absolute left-1/2 -bottom-1.5 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-white/[0.1] border-r border-b border-white/[0.08]" />
          </div>
        )}
      </div>

      {/* ── Label text ── */}
      {showLabel && (
        <span
          className="mt-2 text-xs font-bold tracking-wide"
          style={{ color: theme.labelColor }}
        >
          {label.replace('_', ' ')}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  Grid: show all mascot variants (for demo/testing)              */
/* ═══════════════════════════════════════════════════════════════ */

export function TemperMascotGrid({ size = 80, className = '' }: { size?: number; className?: string }) {
  const labels = ['BRILLIANT', 'EXCELLENT', 'GOOD', 'BOOK', 'INACCURACY', 'MISTAKE', 'BLUNDER', 'MISSED_WIN'];
  return (
    <div className={`grid grid-cols-4 gap-4 ${className}`}>
      {labels.map((label) => (
        <TemperMascot key={label} label={label} size={size} showLabel showBubble />
      ))}
    </div>
  );
}
