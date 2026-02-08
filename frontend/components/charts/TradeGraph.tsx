'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

export interface GraphNode {
    id: string;
    label: string;
    group: string;
    value: number;
    color: string;
    depth: number;
}

export interface GraphLink {
    source: string;
    target: string;
}

interface TradeGraphProps {
    nodes: GraphNode[];
    links: GraphLink[];
    onNodeClick?: (node: GraphNode) => void;
    className?: string;
}

const GROUP_COLORS: Record<string, string> = {
    asset: '#06d6a0',
    bias: '#ef476f',
    session: '#3b82f6',
    pattern: '#f59e0b',
    mood: '#8b5cf6',
};

const GROUP_ATTRACTORS: Record<string, { x: number; y: number }> = {
    session: { x: 0.5, y: 0.5 },
    asset: { x: 0.22, y: 0.28 },
    bias: { x: 0.78, y: 0.28 },
    pattern: { x: 0.3, y: 0.78 },
    mood: { x: 0.7, y: 0.78 },
};

type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number };

export default function TradeGraph({ nodes, links, onNodeClick, className }: TradeGraphProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number>(0);
    const nodesRef = useRef<SimNode[]>([]);
    const hoveredRef = useRef<SimNode | null>(null);
    const selectedRef = useRef<SimNode | null>(null);
    const isDragging = useRef(false);
    const dragNode = useRef<SimNode | null>(null);
    const panRef = useRef({ x: 0, y: 0 });
    const scaleRef = useRef(1);
    const isPanning = useRef(false);
    const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
    const tickRef = useRef(0);
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

    useEffect(() => {
        if (!canvasRef.current || nodes.length === 0) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let w = 0, h = 0;

        const resize = () => {
            const rect = canvas.parentElement!.getBoundingClientRect();
            const dpr = window.devicePixelRatio;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            canvas.style.width = rect.width + 'px';
            canvas.style.height = rect.height + 'px';
            w = rect.width;
            h = rect.height;
        };
        resize();

        // Initialize nodes with group-based positioning for tighter clustering
        const simNodes: SimNode[] = nodes.map((n) => {
            const attractor = GROUP_ATTRACTORS[n.group] || { x: 0.5, y: 0.5 };
            return {
                ...n,
                x: attractor.x * w + (Math.random() - 0.5) * w * 0.2,
                y: attractor.y * h + (Math.random() - 0.5) * h * 0.2,
                vx: 0,
                vy: 0,
            };
        });
        nodesRef.current = simNodes;
        tickRef.current = 0;

        const nodeMap = new Map(simNodes.map(n => [n.id, n]));

        const simulate = () => {
            tickRef.current++;
            const alpha = Math.max(0.002, 0.06 * Math.pow(0.995, tickRef.current));

            // Repulsion
            for (let i = 0; i < simNodes.length; i++) {
                for (let j = i + 1; j < simNodes.length; j++) {
                    const dx = simNodes[j].x - simNodes[i].x;
                    const dy = simNodes[j].y - simNodes[i].y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq > 50000) continue;
                    const dist = Math.sqrt(distSq) || 1;
                    const force = 500 / (distSq + 100);
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    simNodes[i].vx -= fx * alpha;
                    simNodes[i].vy -= fy * alpha;
                    simNodes[j].vx += fx * alpha;
                    simNodes[j].vy += fy * alpha;
                }
            }

            // Link attraction
            links.forEach(link => {
                const source = nodeMap.get(link.source);
                const target = nodeMap.get(link.target);
                if (!source || !target) return;
                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const idealDist = source.group === target.group ? 60 : 130;
                const force = (dist - idealDist) * 0.006;
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                source.vx += fx * alpha;
                source.vy += fy * alpha;
                target.vx -= fx * alpha;
                target.vy -= fy * alpha;
            });

            // Group clustering force
            simNodes.forEach(n => {
                const att = GROUP_ATTRACTORS[n.group] || { x: 0.5, y: 0.5 };
                n.vx += (att.x * w - n.x) * 0.0005;
                n.vy += (att.y * h - n.y) * 0.0005;
                n.vx += (w / 2 - n.x) * 0.00015;
                n.vy += (h / 2 - n.y) * 0.00015;
                n.vx *= 0.82;
                n.vy *= 0.82;
                if (!isDragging.current || dragNode.current?.id !== n.id) {
                    n.x += n.vx;
                    n.y += n.vy;
                }
                n.x = Math.max(40, Math.min(w - 40, n.x));
                n.y = Math.max(40, Math.min(h - 40, n.y));
            });
        };

        const render = () => {
            simulate();
            const dpr = window.devicePixelRatio;
            ctx.save();
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, w, h);
            ctx.save();
            ctx.translate(panRef.current.x, panRef.current.y);
            ctx.scale(scaleRef.current, scaleRef.current);

            const hovered = hoveredRef.current;
            const selected = selectedRef.current;

            // Draw links
            links.forEach(link => {
                const source = nodeMap.get(link.source);
                const target = nodeMap.get(link.target);
                if (!source || !target) return;
                const isHl = (hovered && (hovered.id === source.id || hovered.id === target.id))
                    || (selected && (selected.id === source.id || selected.id === target.id));

                ctx.beginPath();
                ctx.moveTo(source.x, source.y);
                if (source.group === target.group) {
                    const mx = (source.x + target.x) / 2;
                    const my = (source.y + target.y) / 2 - 15;
                    ctx.quadraticCurveTo(mx, my, target.x, target.y);
                } else {
                    ctx.lineTo(target.x, target.y);
                }
                ctx.strokeStyle = isHl ? 'rgba(6, 214, 160, 0.5)' : 'rgba(255,255,255,0.04)';
                ctx.lineWidth = isHl ? 2 : 0.7;
                ctx.stroke();
            });

            // Cluster zone labels
            Object.entries(GROUP_ATTRACTORS).forEach(([group, pos]) => {
                const color = GROUP_COLORS[group] || '#6b7280';
                ctx.font = '700 9px Inter, sans-serif';
                ctx.fillStyle = color + '25';
                ctx.textAlign = 'center';
                ctx.fillText(group.toUpperCase(), pos.x * w, pos.y * h - 55);
            });

            // Draw nodes
            simNodes.forEach(node => {
                const isH = hovered?.id === node.id;
                const isS = selected?.id === node.id;
                const radius = Math.max(6, Math.sqrt(node.value) * 2.5);
                const color = GROUP_COLORS[node.group] || '#6b7280';

                if (isH || isS) {
                    const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius * 3);
                    gradient.addColorStop(0, color + '35');
                    gradient.addColorStop(1, 'transparent');
                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, radius * 3, 0, Math.PI * 2);
                    ctx.fill();
                }

                if (isS) {
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                ctx.beginPath();
                ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = isH || isS ? color : color + 'cc';
                ctx.fill();
                ctx.strokeStyle = isH || isS ? '#ffffff' : color + '30';
                ctx.lineWidth = isH || isS ? 2 : 1;
                ctx.stroke();

                if (radius > 10) {
                    ctx.font = `600 ${Math.min(radius * 0.7, 10)}px Inter, sans-serif`;
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    const sym = node.group === 'asset' ? '$' : node.group === 'bias' ? '!' : '•';
                    ctx.fillText(sym, node.x, node.y);
                    ctx.textBaseline = 'alphabetic';
                }

                const fs = isH || isS ? 11 : 9;
                ctx.font = `${isH || isS ? '600' : '400'} ${fs}px Inter, sans-serif`;
                ctx.fillStyle = isH || isS ? '#ffffff' : 'rgba(255,255,255,0.45)';
                ctx.textAlign = 'center';
                ctx.fillText(node.label, node.x, node.y + radius + fs + 3);
            });

            ctx.restore();
            ctx.restore();
            animationRef.current = requestAnimationFrame(render);
        };

        animationRef.current = requestAnimationFrame(render);

        // Mouse interactions
        const getMousePos = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left - panRef.current.x) / scaleRef.current,
                y: (e.clientY - rect.top - panRef.current.y) / scaleRef.current,
            };
        };

        const findNode = (mx: number, my: number) => {
            for (const node of simNodes) {
                const radius = Math.max(6, Math.sqrt(node.value) * 2.5);
                const dx = node.x - mx, dy = node.y - my;
                if (dx * dx + dy * dy <= (radius + 6) * (radius + 6)) return node;
            }
            return null;
        };

        let dragDidMove = false;

        const handleMove = (e: MouseEvent) => {
            if (isPanning.current) {
                panRef.current.x = panStartRef.current.panX + (e.clientX - panStartRef.current.x);
                panRef.current.y = panStartRef.current.panY + (e.clientY - panStartRef.current.y);
                return;
            }
            const pos = getMousePos(e);
            if (isDragging.current && dragNode.current) {
                dragNode.current.x = pos.x;
                dragNode.current.y = pos.y;
                dragNode.current.vx = 0;
                dragNode.current.vy = 0;
                dragDidMove = true;
                return;
            }
            const node = findNode(pos.x, pos.y);
            hoveredRef.current = node;
            canvas.style.cursor = node ? 'pointer' : 'grab';
        };

        const handleDown = (e: MouseEvent) => {
            const pos = getMousePos(e);
            const node = findNode(pos.x, pos.y);
            if (node) {
                isDragging.current = true;
                dragNode.current = node;
                dragDidMove = false;
            } else {
                isPanning.current = true;
                panStartRef.current = { x: e.clientX, y: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
                canvas.style.cursor = 'grabbing';
            }
        };

        const handleUp = () => {
            if (isDragging.current && dragNode.current && !dragDidMove) {
                selectedRef.current = selectedRef.current?.id === dragNode.current.id ? null : dragNode.current;
                setSelectedNode(selectedRef.current);
                onNodeClick?.(dragNode.current);
            }
            isDragging.current = false;
            dragNode.current = null;
            isPanning.current = false;
        };

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const delta = e.deltaY > 0 ? 0.92 : 1.08;
            const newScale = Math.max(0.3, Math.min(4, scaleRef.current * delta));
            panRef.current.x = mx - (mx - panRef.current.x) * (newScale / scaleRef.current);
            panRef.current.y = my - (my - panRef.current.y) * (newScale / scaleRef.current);
            scaleRef.current = newScale;
        };

        canvas.addEventListener('mousemove', handleMove);
        canvas.addEventListener('mousedown', handleDown);
        canvas.addEventListener('mouseup', handleUp);
        canvas.addEventListener('mouseleave', handleUp);
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        window.addEventListener('resize', resize);

        return () => {
            cancelAnimationFrame(animationRef.current);
            canvas.removeEventListener('mousemove', handleMove);
            canvas.removeEventListener('mousedown', handleDown);
            canvas.removeEventListener('mouseup', handleUp);
            canvas.removeEventListener('mouseleave', handleUp);
            canvas.removeEventListener('wheel', handleWheel);
            window.removeEventListener('resize', resize);
        };
    }, [nodes, links, onNodeClick]);

    return (
        <div className={`relative ${className || ''}`}>
            <canvas ref={canvasRef} className="h-full w-full" />

            {selectedNode && (
                <div className="absolute top-4 right-4 w-64 rounded-xl bg-[#141414]/95 p-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-md">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-400">{selectedNode.group}</span>
                        <button onClick={() => { selectedRef.current = null; setSelectedNode(null); }} className="cursor-pointer rounded-md p-1 text-gray-500 hover:bg-white/10 hover:text-white transition-colors">
                            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                        </button>
                    </div>
                    <p className="text-sm font-semibold text-white mb-2">{selectedNode.label}</p>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">Type</span>
                            <span className="capitalize text-white">{selectedNode.group}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">Impact</span>
                            <span className="text-white">{selectedNode.value.toFixed(0)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500">Connections</span>
                            <span className="text-white">{links.filter(l => l.source === selectedNode.id || l.target === selectedNode.id).length}</span>
                        </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: GROUP_COLORS[selectedNode.group] || '#6b7280' }} />
                        <span className="text-[10px] text-gray-500">
                            {selectedNode.group === 'session' ? 'Trade node' : selectedNode.group === 'asset' ? 'Asset cluster' : selectedNode.group === 'bias' ? 'Bias cluster' : 'Pattern node'}
                        </span>
                    </div>
                </div>
            )}

            <div className="absolute bottom-4 left-4 rounded-lg bg-[#0a0a0a]/80 p-3 backdrop-blur-sm ring-1 ring-white/5">
                <p className="text-[10px] font-semibold text-gray-400 mb-2 uppercase tracking-wider">Clusters</p>
                <div className="space-y-1">
                    {Object.entries(GROUP_COLORS).map(([group, color]) => (
                        <div key={group} className="flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                            <span className="text-[10px] text-gray-500 capitalize">{group}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="absolute top-4 left-4 rounded-lg bg-[#0a0a0a]/80 px-3 py-2 backdrop-blur-sm ring-1 ring-white/5">
                <p className="text-[10px] text-gray-500">Drag nodes · Pan background · Scroll zoom · Click for details</p>
            </div>
        </div>
    );
}
