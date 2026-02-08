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

export default function TradeGraph({ nodes, links, onNodeClick, className }: TradeGraphProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
    const animationRef = useRef<number>(0);
    const nodesWithPosRef = useRef<(GraphNode & { x: number; y: number; vx: number; vy: number })[]>([]);
    const isDragging = useRef(false);
    const dragNode = useRef<(GraphNode & { x: number; y: number; vx: number; vy: number }) | null>(null);
    const panRef = useRef({ x: 0, y: 0 });
    const scaleRef = useRef(1);
    const lastMouseRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        if (!canvasRef.current || nodes.length === 0) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const resize = () => {
            const rect = canvas.parentElement!.getBoundingClientRect();
            canvas.width = rect.width * window.devicePixelRatio;
            canvas.height = rect.height * window.devicePixelRatio;
            canvas.style.width = rect.width + 'px';
            canvas.style.height = rect.height + 'px';
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        };
        resize();

        const w = canvas.width / window.devicePixelRatio;
        const h = canvas.height / window.devicePixelRatio;

        // Initialize node positions using force-directed layout
        const simNodes = nodes.map((n, i) => ({
            ...n,
            x: w / 2 + (Math.random() - 0.5) * w * 0.6,
            y: h / 2 + (Math.random() - 0.5) * h * 0.6,
            vx: 0,
            vy: 0,
        }));
        nodesWithPosRef.current = simNodes;

        const nodeMap = new Map(simNodes.map(n => [n.id, n]));

        // Simple force simulation
        const simulate = () => {
            const alpha = 0.1;

            // Repulsion
            for (let i = 0; i < simNodes.length; i++) {
                for (let j = i + 1; j < simNodes.length; j++) {
                    const dx = simNodes[j].x - simNodes[i].x;
                    const dy = simNodes[j].y - simNodes[i].y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    const force = 800 / (dist * dist);
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;
                    simNodes[i].vx -= fx * alpha;
                    simNodes[i].vy -= fy * alpha;
                    simNodes[j].vx += fx * alpha;
                    simNodes[j].vy += fy * alpha;
                }
            }

            // Attraction along links
            links.forEach(link => {
                const source = nodeMap.get(link.source);
                const target = nodeMap.get(link.target);
                if (!source || !target) return;
                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = (dist - 120) * 0.01;
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;
                source.vx += fx * alpha;
                source.vy += fy * alpha;
                target.vx -= fx * alpha;
                target.vy -= fy * alpha;
            });

            // Center gravity
            simNodes.forEach(n => {
                n.vx += (w / 2 - n.x) * 0.001;
                n.vy += (h / 2 - n.y) * 0.001;
                n.vx *= 0.9;
                n.vy *= 0.9;
                if (!isDragging.current || dragNode.current?.id !== n.id) {
                    n.x += n.vx;
                    n.y += n.vy;
                }
                n.x = Math.max(30, Math.min(w - 30, n.x));
                n.y = Math.max(30, Math.min(h - 30, n.y));
            });
        };

        // Render loop
        const render = () => {
            simulate();
            const cw = canvas.width / window.devicePixelRatio;
            const ch = canvas.height / window.devicePixelRatio;

            ctx.save();
            ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, cw, ch);

            ctx.save();
            ctx.translate(panRef.current.x, panRef.current.y);
            ctx.scale(scaleRef.current, scaleRef.current);

            // Draw links
            links.forEach(link => {
                const source = nodeMap.get(link.source);
                const target = nodeMap.get(link.target);
                if (!source || !target) return;

                const isHighlighted = hoveredNode && (hoveredNode.id === source.id || hoveredNode.id === target.id);

                ctx.beginPath();
                ctx.moveTo(source.x, source.y);
                ctx.lineTo(target.x, target.y);
                ctx.strokeStyle = isHighlighted ? 'rgba(6, 214, 160, 0.5)' : 'rgba(255,255,255,0.06)';
                ctx.lineWidth = isHighlighted ? 2 : 1;
                ctx.stroke();
            });

            // Draw nodes
            simNodes.forEach(node => {
                const isHovered = hoveredNode?.id === node.id;
                const radius = Math.max(8, Math.sqrt(node.value) * 3);
                const color = GROUP_COLORS[node.group] || '#6b7280';

                // Glow
                if (isHovered) {
                    const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius * 3);
                    gradient.addColorStop(0, color + '40');
                    gradient.addColorStop(1, 'transparent');
                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, radius * 3, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Node circle
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = isHovered ? color : color + 'cc';
                ctx.fill();

                ctx.strokeStyle = isHovered ? '#ffffff' : color + '60';
                ctx.lineWidth = isHovered ? 2 : 1;
                ctx.stroke();

                // Label
                const fontSize = isHovered ? 12 : 10;
                ctx.font = `${isHovered ? '600' : '400'} ${fontSize}px Inter, sans-serif`;
                ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(255,255,255,0.6)';
                ctx.textAlign = 'center';
                ctx.fillText(node.label, node.x, node.y + radius + fontSize + 4);
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
                const radius = Math.max(8, Math.sqrt(node.value) * 3);
                const dx = node.x - mx;
                const dy = node.y - my;
                if (dx * dx + dy * dy <= (radius + 4) * (radius + 4)) return node;
            }
            return null;
        };

        const handleMove = (e: MouseEvent) => {
            const pos = getMousePos(e);
            if (isDragging.current && dragNode.current) {
                dragNode.current.x = pos.x;
                dragNode.current.y = pos.y;
                return;
            }
            const node = findNode(pos.x, pos.y);
            setHoveredNode(node);
            canvas.style.cursor = node ? 'pointer' : 'default';
        };

        const handleDown = (e: MouseEvent) => {
            const pos = getMousePos(e);
            const node = findNode(pos.x, pos.y);
            if (node) {
                isDragging.current = true;
                dragNode.current = node;
            }
        };

        const handleUp = () => {
            if (isDragging.current && dragNode.current) {
                onNodeClick?.(dragNode.current);
            }
            isDragging.current = false;
            dragNode.current = null;
        };

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.95 : 1.05;
            scaleRef.current = Math.max(0.3, Math.min(3, scaleRef.current * delta));
        };

        canvas.addEventListener('mousemove', handleMove);
        canvas.addEventListener('mousedown', handleDown);
        canvas.addEventListener('mouseup', handleUp);
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        window.addEventListener('resize', resize);

        return () => {
            cancelAnimationFrame(animationRef.current);
            canvas.removeEventListener('mousemove', handleMove);
            canvas.removeEventListener('mousedown', handleDown);
            canvas.removeEventListener('mouseup', handleUp);
            canvas.removeEventListener('wheel', handleWheel);
            window.removeEventListener('resize', resize);
        };
    }, [nodes, links, onNodeClick, hoveredNode]);

    return (
        <div className={`relative ${className || ''}`}>
            <canvas ref={canvasRef} className="h-full w-full" />

            {/* Legend */}
            <div className="absolute bottom-4 left-4 rounded-lg bg-[#0a0a0a]/80 p-3 backdrop-blur-sm ring-1 ring-white/5">
                <p className="text-[10px] font-semibold text-gray-400 mb-2 uppercase tracking-wider">Connections</p>
                <div className="space-y-1">
                    {Object.entries(GROUP_COLORS).map(([group, color]) => (
                        <div key={group} className="flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                            <span className="text-[10px] text-gray-500 capitalize">{group}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="absolute top-4 right-4 rounded-lg bg-[#0a0a0a]/80 px-3 py-2 backdrop-blur-sm ring-1 ring-white/5">
                <p className="text-[10px] text-gray-500">Drag nodes · Scroll to zoom · Click for details</p>
            </div>
        </div>
    );
}
