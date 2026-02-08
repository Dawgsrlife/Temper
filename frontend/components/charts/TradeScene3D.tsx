'use client';

import { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface TradeNode {
    id: string;
    timestamp: string;
    asset: string;
    pnl: number;
    sessionPnL: number;
    label: string;
    biases: string[];
    side: string;
    index: number;
}

interface TradeSceneProps {
    trades: TradeNode[];
    onNodeClick?: (trade: TradeNode) => void;
    onNodeHover?: (trade: TradeNode | null) => void;
    className?: string;
}

const LABEL_COLORS: Record<string, number> = {
    BRILLIANT: 0x06d6a0,
    GREAT: 0x00b4d8,
    BEST: 0x10b981,
    EXCELLENT: 0x22c55e,
    GOOD: 0x3b82f6,
    BOOK: 0x60a5fa,
    FORCED: 0xa78bfa,
    INTERESTING: 0xfbbf24,
    INACCURACY: 0xf59e0b,
    MISTAKE: 0xf97316,
    MISS: 0x6b7280,
    BLUNDER: 0xef476f,
    MEGABLUNDER: 0x991b1b,
    CHECKMATED: 0xbe123c,
    WINNER: 0xfde047,
    DRAW: 0x94a3b8,
    RESIGN: 0x475569,
};

export default function TradeScene3D({ trades, onNodeClick, onNodeHover, className }: TradeSceneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const meshesRef = useRef<THREE.Mesh[]>([]);
    const raycasterRef = useRef(new THREE.Raycaster());
    const mouseRef = useRef(new THREE.Vector2());
    const hoveredRef = useRef<THREE.Mesh | null>(null);
    const frameRef = useRef<number>(0);
    const isAnimatingRef = useRef(false);
    const [selectedTrade, setSelectedTrade] = useState<TradeNode | null>(null);
    const [hoveredTrade, setHoveredTrade] = useState<TradeNode | null>(null);
    const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

    useEffect(() => {
        if (!containerRef.current) return;
        const container = containerRef.current;

        // Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x141414);
        scene.fog = new THREE.FogExp2(0x1a1a1a, 0.008);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
        camera.position.set(0, 8, 22);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.8;
        container.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.maxDistance = 50;
        controls.minDistance = 3;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.4;
        controlsRef.current = controls;

        // Lighting
        scene.add(new THREE.AmbientLight(0xffffff, 0.9));
        const ptLight1 = new THREE.PointLight(0x06d6a0, 3.5, 60);
        ptLight1.position.set(12, 12, 12);
        scene.add(ptLight1);
        const ptLight2 = new THREE.PointLight(0xef476f, 2.5, 50);
        ptLight2.position.set(-10, -5, -10);
        scene.add(ptLight2);
        const ptLight3 = new THREE.PointLight(0xf59e0b, 1.8, 40);
        ptLight3.position.set(0, 15, 0);
        scene.add(ptLight3);

        // Grid
        const grid = new THREE.GridHelper(40, 40, 0x2a2a2a, 0x1a1a1a);
        grid.position.y = -3;
        scene.add(grid);

        // Create trade meshes
        const meshes: THREE.Mesh[] = [];
        const lineGroup = new THREE.Group();
        scene.add(lineGroup);

        if (trades.length > 0) {
            const timeRange = trades.length > 1
                ? new Date(trades[trades.length - 1].timestamp).getTime() - new Date(trades[0].timestamp).getTime()
                : 1;
            const maxAbsPnL = Math.max(...trades.map(t => Math.abs(t.sessionPnL)), 1);

            trades.forEach((trade, i) => {
                const timeFrac = trades.length > 1
                    ? (new Date(trade.timestamp).getTime() - new Date(trades[0].timestamp).getTime()) / timeRange
                    : 0.5;

                const x = (timeFrac - 0.5) * 20;
                const y = (trade.sessionPnL / maxAbsPnL) * 6;
                const assetHash = trade.asset.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
                const z = ((assetHash % 10) - 5) * 1.2;

                const size = 0.15 + Math.abs(trade.pnl) / (maxAbsPnL * 0.3) * 0.35;
                const color = LABEL_COLORS[trade.label] || 0x6b7280;

                const geometry = new THREE.SphereGeometry(Math.min(size, 0.6), 24, 24);
                const material = new THREE.MeshStandardMaterial({
                    color,
                    roughness: 0.3,
                    metalness: 0.6,
                    emissive: new THREE.Color(color),
                    emissiveIntensity: 0.3,
                });

                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.set(x, y, z);
                mesh.userData = { trade, index: i };
                scene.add(mesh);
                meshes.push(mesh);

                // Bias ring
                if (trade.biases.length > 0) {
                    const ringGeo = new THREE.RingGeometry(size + 0.1, size + 0.2, 32);
                    const ringMat = new THREE.MeshBasicMaterial({
                        color: 0xef476f,
                        transparent: true,
                        opacity: 0.6,
                        side: THREE.DoubleSide,
                    });
                    const ring = new THREE.Mesh(ringGeo, ringMat);
                    ring.position.copy(mesh.position);
                    ring.lookAt(camera.position);
                    scene.add(ring);
                }

                // Connecting lines
                if (i > 0) {
                    const prev = meshes[i - 1];
                    const points = [prev.position.clone(), mesh.position.clone()];
                    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
                    const lineMat = new THREE.LineBasicMaterial({
                        color: trade.pnl >= 0 ? 0x06d6a0 : 0xef476f,
                        transparent: true,
                        opacity: 0.2,
                    });
                    lineGroup.add(new THREE.Line(lineGeo, lineMat));
                }
            });
        }

        meshesRef.current = meshes;

        // Particles
        const pCount = 400;
        const pGeo = new THREE.BufferGeometry();
        const pos = new Float32Array(pCount * 3);
        for (let i = 0; i < pCount * 3; i++) pos[i] = (Math.random() - 0.5) * 60;
        pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const pMat = new THREE.PointsMaterial({ color: 0x06d6a0, size: 0.05, transparent: true, opacity: 0.35 });
        const particles = new THREE.Points(pGeo, pMat);
        scene.add(particles);

        // Smooth camera fly-to function
        const flyToNode = (mesh: THREE.Mesh) => {
            if (isAnimatingRef.current) return;
            isAnimatingRef.current = true;
            controls.autoRotate = false;

            const targetPos = mesh.position.clone();
            // Preserve current camera viewing angle — compute offset from current direction
            const currentDir = camera.position.clone().sub(controls.target).normalize();
            const zoomDist = 5;
            const offset = currentDir.multiplyScalar(zoomDist);
            const destination = targetPos.clone().add(offset);

            const startPos = camera.position.clone();
            const startTarget = controls.target.clone();
            const endTarget = targetPos.clone();

            let progress = 0;
            const duration = 60; // frames

            const animateCamera = () => {
                progress++;
                const t = Math.min(progress / duration, 1);
                // Smooth ease-in-out
                const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

                camera.position.lerpVectors(startPos, destination, ease);
                controls.target.lerpVectors(startTarget, endTarget, ease);
                controls.update();

                if (t < 1) {
                    requestAnimationFrame(animateCamera);
                } else {
                    isAnimatingRef.current = false;
                }
            };
            animateCamera();
        };

        // Animation loop
        const animate = () => {
            frameRef.current = requestAnimationFrame(animate);
            controls.update();
            particles.rotation.y += 0.0003;

            // Raycasting for hover
            raycasterRef.current.setFromCamera(mouseRef.current, camera);
            const intersects = raycasterRef.current.intersectObjects(meshes);

            if (hoveredRef.current) {
                const mat = hoveredRef.current.material as THREE.MeshStandardMaterial;
                mat.emissiveIntensity = 0.15;
                hoveredRef.current.scale.setScalar(1);
            }

            if (intersects.length > 0) {
                const mesh = intersects[0].object as THREE.Mesh;
                const mat = mesh.material as THREE.MeshStandardMaterial;
                mat.emissiveIntensity = 0.6;
                mesh.scale.setScalar(1.3);
                hoveredRef.current = mesh;
                container.style.cursor = 'pointer';
            } else {
                hoveredRef.current = null;
                container.style.cursor = 'default';
            }

            // Pulse biased rings
            meshes.forEach(m => {
                const t = m.userData.trade as TradeNode;
                if (t.biases.length > 0) {
                    const sc = 1 + Math.sin(Date.now() * 0.003 + m.userData.index) * 0.05;
                    if (hoveredRef.current !== m) m.scale.setScalar(sc);
                }
            });

            renderer.render(scene, camera);
        };
        animate();

        // Mouse handling
        const handleMouseMove = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });

            raycasterRef.current.setFromCamera(mouseRef.current, camera);
            const hits = raycasterRef.current.intersectObjects(meshes);
            if (hits.length > 0) {
                const trade = hits[0].object.userData.trade as TradeNode;
                setHoveredTrade(trade);
                onNodeHover?.(trade);
            } else {
                setHoveredTrade(null);
                onNodeHover?.(null);
            }
        };

        const handleClick = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            raycasterRef.current.setFromCamera(mouseRef.current, camera);
            const hits = raycasterRef.current.intersectObjects(meshes);
            if (hits.length > 0) {
                const trade = hits[0].object.userData.trade as TradeNode;
                setSelectedTrade(trade);
                onNodeClick?.(trade);
                flyToNode(hits[0].object as THREE.Mesh);
            }
        };

        container.addEventListener('mousemove', handleMouseMove);
        container.addEventListener('click', handleClick);

        const handleResize = () => {
            camera.aspect = container.clientWidth / container.clientHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(container.clientWidth, container.clientHeight);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            cancelAnimationFrame(frameRef.current);
            container.removeEventListener('mousemove', handleMouseMove);
            container.removeEventListener('click', handleClick);
            window.removeEventListener('resize', handleResize);
            renderer.dispose();
            controls.dispose();
            if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
        };
    }, [trades, onNodeClick, onNodeHover]);

    return (
        <div className={`relative ${className || ''}`}>
            <div ref={containerRef} className="h-full w-full" />

            {/* Floating hover tooltip */}
            {hoveredTrade && (
                <div
                    className="pointer-events-none absolute z-20 rounded-xl bg-[#1a1a1a]/95 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
                    style={{ left: hoverPos.x + 16, top: hoverPos.y - 16, maxWidth: 240 }}
                >
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-white">{hoveredTrade.asset}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${hoveredTrade.pnl >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                            {hoveredTrade.pnl >= 0 ? '+' : ''}{hoveredTrade.pnl.toFixed(0)}
                        </span>
                    </div>
                    <p className="text-[10px] text-gray-400">
                        {hoveredTrade.side} · {hoveredTrade.label} · {hoveredTrade.timestamp.split(' ')[1]?.slice(0, 5)}
                    </p>
                    {hoveredTrade.biases.length > 0 && (
                        <p className="text-[10px] text-red-400 mt-1">⚠ {hoveredTrade.biases.join(', ')}</p>
                    )}
                </div>
            )}

            {/* Selected trade info card (top-right) */}
            {selectedTrade && (
                <div className="absolute top-4 right-4 w-72 rounded-xl bg-[#141414]/95 p-4 shadow-2xl ring-1 ring-white/10 backdrop-blur-md z-30">
                    <div className="flex items-center justify-between mb-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                            selectedTrade.label === 'BRILLIANT' || selectedTrade.label === 'EXCELLENT' || selectedTrade.label === 'GOOD'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : selectedTrade.label === 'BLUNDER' || selectedTrade.label === 'MISTAKE'
                                    ? 'bg-red-500/20 text-red-400'
                                    : 'bg-yellow-500/20 text-yellow-400'
                        }`}>{selectedTrade.label}</span>
                        <button onClick={() => setSelectedTrade(null)} className="cursor-pointer rounded-md p-1 text-gray-500 hover:bg-white/10 hover:text-white transition-colors">
                            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="rounded-lg bg-white/[0.06] p-2">
                            <p className="text-[9px] text-gray-500 uppercase">Asset</p>
                            <p className="text-sm font-bold text-white">{selectedTrade.asset}</p>
                        </div>
                        <div className="rounded-lg bg-white/[0.06] p-2">
                            <p className="text-[9px] text-gray-500 uppercase">Side</p>
                            <p className={`text-sm font-bold ${selectedTrade.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{selectedTrade.side}</p>
                        </div>
                        <div className="rounded-lg bg-white/[0.06] p-2">
                            <p className="text-[9px] text-gray-500 uppercase">P/L</p>
                            <p className={`text-sm font-bold ${selectedTrade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {selectedTrade.pnl >= 0 ? '+' : ''}${Math.abs(selectedTrade.pnl).toFixed(0)}
                            </p>
                        </div>
                        <div className="rounded-lg bg-white/[0.06] p-2">
                            <p className="text-[9px] text-gray-500 uppercase">Session P/L</p>
                            <p className={`text-sm font-bold ${selectedTrade.sessionPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {selectedTrade.sessionPnL >= 0 ? '+' : ''}${Math.abs(selectedTrade.sessionPnL).toFixed(0)}
                            </p>
                        </div>
                    </div>
                    {selectedTrade.biases.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                            {selectedTrade.biases.map((b, i) => (
                                <span key={i} className="rounded-full bg-red-400/10 px-2 py-0.5 text-[10px] font-medium text-red-400">⚠ {b.replace('_', ' ')}</span>
                            ))}
                        </div>
                    )}
                    <p className="text-[10px] text-gray-500">{selectedTrade.timestamp}</p>
                </div>
            )}

            {/* Legend */}
            <div className="absolute bottom-4 left-4 rounded-lg bg-[#0a0a0a]/80 p-3 backdrop-blur-sm ring-1 ring-white/5">
                <p className="text-[10px] font-semibold text-gray-400 mb-2 uppercase tracking-wider">Trade Nodes</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(LABEL_COLORS).map(([label, color]) => (
                        <div key={label} className="flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: `#${color.toString(16).padStart(6, '0')}` }} />
                            <span className="text-[10px] text-gray-500">{label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="absolute top-4 left-4 rounded-lg bg-[#0a0a0a]/80 px-3 py-2 backdrop-blur-sm ring-1 ring-white/5">
                <p className="text-[10px] text-gray-500">Drag to rotate · Scroll to zoom · Click node to focus</p>
            </div>
        </div>
    );
}
