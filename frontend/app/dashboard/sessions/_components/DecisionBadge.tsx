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
    EXCELLENT: 'bg-green-500 text-white shadow-green-500/50',
    GOOD: 'bg-emerald-400 text-white shadow-emerald-400/50',
    BOOK: 'bg-blue-400 text-white shadow-blue-400/50',
    INACCURACY: 'bg-yellow-400 text-yellow-900 shadow-yellow-400/50',
    MISTAKE: 'bg-orange-500 text-white shadow-orange-500/50',
    BLUNDER: 'bg-red-600 text-white shadow-red-600/50',
    MISSED_WIN: 'bg-pink-500 text-white shadow-pink-500/50',
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
