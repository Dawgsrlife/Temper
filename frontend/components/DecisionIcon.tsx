'use client';

interface DecisionIconProps {
    label: string;
    size?: number;
    showLabel?: boolean;
    className?: string;
}

const ICON_CONFIG: Record<string, { bg: string; text: string; symbol: string; border: string }> = {
    BRILLIANT: { bg: 'bg-emerald-500', text: 'text-white', symbol: '!!', border: 'ring-emerald-400/30' },
    GREAT: { bg: 'bg-cyan-500', text: 'text-white', symbol: '!', border: 'ring-cyan-400/30' },
    BEST: { bg: 'bg-teal-500', text: 'text-white', symbol: '★', border: 'ring-teal-400/30' },
    EXCELLENT: { bg: 'bg-green-500', text: 'text-white', symbol: '✓', border: 'ring-green-400/30' },
    GOOD: { bg: 'bg-blue-500', text: 'text-white', symbol: '+', border: 'ring-blue-400/30' },
    NEUTRAL: { bg: 'bg-gray-500', text: 'text-white', symbol: '—', border: 'ring-gray-400/30' },
    BOOK: { bg: 'bg-sky-500', text: 'text-white', symbol: '📖', border: 'ring-sky-400/30' },
    FORCED: { bg: 'bg-purple-500', text: 'text-white', symbol: '□', border: 'ring-purple-400/30' },
    INTERESTING: { bg: 'bg-amber-500', text: 'text-white', symbol: '!?', border: 'ring-amber-400/30' },
    INACCURACY: { bg: 'bg-yellow-500', text: 'text-black', symbol: '?!', border: 'ring-yellow-400/30' },
    MISTAKE: { bg: 'bg-orange-500', text: 'text-white', symbol: '?', border: 'ring-orange-400/30' },
    MISS: { bg: 'bg-gray-600', text: 'text-white', symbol: '⨯', border: 'ring-gray-500/30' },
    BLUNDER: { bg: 'bg-red-500', text: 'text-white', symbol: '??', border: 'ring-red-400/30' },
    MEGABLUNDER: { bg: 'bg-red-800', text: 'text-white', symbol: '???', border: 'ring-red-700/30' },
    CHECKMATED: { bg: 'bg-rose-700', text: 'text-white', symbol: '#', border: 'ring-rose-600/30' },
    WINNER: { bg: 'bg-yellow-500', text: 'text-black', symbol: '♔', border: 'ring-yellow-400/30' },
    DRAW: { bg: 'bg-slate-500', text: 'text-white', symbol: '½', border: 'ring-slate-400/30' },
    RESIGN: { bg: 'bg-stone-600', text: 'text-white', symbol: '⊘', border: 'ring-stone-500/30' },
};

export function DecisionIcon({ label, size = 32, showLabel = false, className = '' }: DecisionIconProps) {
    const config = ICON_CONFIG[label] || ICON_CONFIG.NEUTRAL;

    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <div
                className={`flex items-center justify-center rounded-full ${config.bg} ${config.text} font-bold ring-2 ${config.border} shadow-lg`}
                style={{ width: size, height: size, fontSize: size * 0.38 }}
            >
                {config.symbol}
            </div>
            {showLabel && (
                <span className="text-xs font-semibold text-gray-300 capitalize">
                    {label.toLowerCase().replace('_', ' ')}
                </span>
            )}
        </div>
    );
}

export function DecisionIconGrid({ className = '' }: { className?: string }) {
    return (
        <div className={`grid grid-cols-3 gap-3 ${className}`}>
            {Object.keys(ICON_CONFIG).map(label => (
                <DecisionIcon key={label} label={label} size={28} showLabel />
            ))}
        </div>
    );
}

export default DecisionIcon;
