import { Play } from 'lucide-react';

export default function DemoTerminalPage() {
    return (
        <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="h-24 w-24 rounded-full bg-temper-subtle flex items-center justify-center mb-6">
                <Play className="h-10 w-10 text-temper-gold fill-temper-gold" />
            </div>
            <h1 className="text-2xl font-bold font-coach text-white mb-2">Practice Terminal</h1>
            <p className="text-temper-muted max-w-md">
                Test your discipline on simulated price action.
            </p>
            <div className="mt-8 p-4 rounded-lg bg-temper-surface border border-temper-border w-full max-w-2xl h-64 flex items-center justify-center">
                <span className="text-temper-muted font-mono">Chart Placeholder [To Be Implemented]</span>
            </div>
        </div>
    );
}
