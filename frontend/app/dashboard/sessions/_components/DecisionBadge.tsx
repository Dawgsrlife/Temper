import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { DecisionLabel } from '../[id]/types';

interface DecisionBadgeProps {
    label: DecisionLabel;
    symbolCode: string;
    className?: string;
    size?: 'sm' | 'md' | 'lg';
}

const labelColors: Record<DecisionLabel, string> = {
    BRILLIANT: 'bg-teal-500 text-white shadow-teal-500/50',
    GREAT: 'bg-cyan-500 text-white shadow-cyan-500/50',
    BEST: 'bg-emerald-500 text-white shadow-emerald-500/50',
    EXCELLENT: 'bg-green-500 text-white shadow-green-500/50',
    GOOD: 'bg-emerald-400 text-white shadow-emerald-400/50',
    INACCURACY: 'bg-yellow-400 text-yellow-900 shadow-yellow-400/50',
    MISTAKE: 'bg-orange-500 text-white shadow-orange-500/50',
    MISS: 'bg-gray-500 text-white shadow-gray-500/50',
    BLUNDER: 'bg-red-600 text-white shadow-red-600/50',
    MEGABLUNDER: 'bg-red-900 text-white shadow-red-900/50',
    BOOK: 'bg-blue-400 text-white shadow-blue-400/50',
    FORCED: 'bg-purple-500 text-white shadow-purple-500/50',
    INTERESTING: 'bg-amber-500 text-white shadow-amber-500/50',
    CHECKMATED: 'bg-rose-700 text-white shadow-rose-700/50',
    WINNER: 'bg-yellow-500 text-black shadow-yellow-500/50',
    DRAW: 'bg-slate-500 text-white shadow-slate-500/50',
    RESIGN: 'bg-stone-600 text-white shadow-stone-600/50',
};

const sizeClasses = {
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-12 h-12 text-lg font-bold',
};

export function DecisionBadge({ label, symbolCode, className, size = 'md' }: DecisionBadgeProps) {
    return (
        <div
            className={twMerge(
                'flex items-center justify-center rounded-full font-bold shadow-lg shadow-sm',
                labelColors[label],
                sizeClasses[size],
                className
            )}
            title={label}
        >
            {symbolCode}
        </div>
    );
}
