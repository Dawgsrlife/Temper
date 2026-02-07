'use client';

import * as React from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useNodesState,
    useEdgesState,
    type Node,
    type Edge,
    type NodeProps,
    Handle,
    Position,
    useReactFlow
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TradeEvent, DecisionLabel } from '../[id]/types';
import { DecisionBadge } from './DecisionBadge';
import { clsx } from 'clsx'; // Assuming standard Shadcn or util

// --- Custom Node ---
function TradeNode({ data, selected }: NodeProps<Node<{ trade: TradeEvent, label: string }>>) {
    const { trade } = data;
    return (
        <div className={clsx(
            "relative flex flex-col items-center rounded-xl border-2 bg-temper-surface p-2 shadow-lg transition-all duration-300 min-w-[120px]",
            selected
                ? "border-temper-teal scale-110 shadow-[0_0_20px_rgba(6,214,160,0.4)] z-50"
                : "border-temper-border hover:border-temper-muted"
        )}>
            <Handle type="target" position={Position.Left} className="!bg-temper-muted !w-3 !h-3" />

            <div className="-mt-6 mb-2">
                <DecisionBadge label={trade.label} symbolCode={trade.symbolCode} size="md" />
            </div>

            <div className="text-center">
                <div className="text-[10px] font-mono text-temper-muted mb-1">
                    {trade.timestamp.split('T')[1].split('.')[0]}
                </div>
                <div className={clsx("text-sm font-bold font-mono", trade.realizedPnl >= 0 ? "text-temper-teal" : "text-temper-red")}>
                    {trade.realizedPnl >= 0 ? '+' : ''}{trade.realizedPnl}
                </div>
            </div>

            <div className="mt-2 text-[10px] font-bold uppercase tracking-wider text-temper-text/50">
                Trade #{trade.index + 1}
            </div>

            <Handle type="source" position={Position.Right} className="!bg-temper-muted !w-3 !h-3" />
        </div>
    );
}

const nodeTypes = {
    trade: TradeNode,
};

// --- Main Component ---

interface TradeGraphProps {
    trades: TradeEvent[];
    selectedId: string | null;
    onSelect: (tradeId: string) => void;
}

export function TradeGraph({ trades, selectedId, onSelect }: TradeGraphProps) {
    // Convert trades to nodes/edges
    const initialNodes: Node[] = React.useMemo(() => {
        return trades.map((trade, i) => ({
            id: trade.id,
            type: 'trade',
            position: { x: i * 200, y: 100 + (i % 2 === 0 ? -50 : 50) }, // Zig-zag for visual interest
            data: { trade, label: trade.symbolCode },
            selected: trade.id === selectedId
        }));
    }, [trades, selectedId]);

    const initialEdges: Edge[] = React.useMemo(() => {
        const edges: Edge[] = [];
        for (let i = 0; i < trades.length - 1; i++) {
            edges.push({
                id: `e-${trades[i].id}-${trades[i + 1].id}`,
                source: trades[i].id,
                target: trades[i + 1].id,
                animated: true,
                style: { stroke: '#2F2F42', strokeWidth: 2 },
            });
        }
        return edges;
    }, [trades]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Sync selection from props to nodes
    React.useEffect(() => {
        setNodes((nds) => nds.map((node) => ({
            ...node,
            selected: node.id === selectedId,
        })));
    }, [selectedId, setNodes]);

    return (
        <div className="h-full w-full bg-[#0B0B16]">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={(_, node) => onSelect(node.id)}
                fitView
                minZoom={0.5}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
            >
                <Background color="#1E1E2F" gap={20} size={1} />
                <Controls className="!bg-temper-surface !border-temper-border !fill-temper-text" />
            </ReactFlow>
        </div>
    );
}
