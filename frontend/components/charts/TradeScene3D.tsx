'use client';

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
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
    EXCELLENT: 0x06d6a0,
    GOOD: 0x3b82f6,
    NEUTRAL: 0x6b7280,
    INACCURACY: 0xf59e0b,
    MISTAKE: 0xf97316,
    BLUNDER: 0xef476f,
};

export default function TradeScene3D({ trades, onNodeClick, onNodeHover, className }: TradeSceneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const meshesRef = useRef<THREE.Mesh[]>([]);
    const linesRef = useRef<THREE.Group | null>(null);
    const raycasterRef = useRef(new THREE.Raycaster());
    const mouseRef = useRef(new THREE.Vector2());
    const hoveredRef = useRef<THREE.Mesh | null>(null);
    const [hoveredTrade, setHoveredTrade] = useState<TradeNode | null>(null);
    const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
    const frameRef = useRef<number>(0);

    useEffect(() => {
        if (!containerRef.current) return;
        const container = containerRef.current;

        // Scene setup
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0a);
        scene.fog = new THREE.FogExp2(0x0a0a0a, 0.02);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
        camera.position.set(0, 5, 20);
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(container.clientWidth, container.clientHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        container.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.maxDistance = 50;
        controls.minDistance = 5;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
        controlsRef.current = controls;

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        scene.add(ambientLight);

        const pointLight1 = new THREE.PointLight(0x06d6a0, 2, 50);
        pointLight1.position.set(10, 10, 10);
        scene.add(pointLight1);

        const pointLight2 = new THREE.PointLight(0xef476f, 1.5, 50);
        pointLight2.position.set(-10, -5, -10);
        scene.add(pointLight2);

        const pointLight3 = new THREE.PointLight(0x3b82f6, 1, 40);
        pointLight3.position.set(0, 15, 0);
        scene.add(pointLight3);

        // Grid helper
        const gridHelper = new THREE.GridHelper(40, 40, 0x1a1a1a, 0x111111);
        gridHelper.position.y = -3;
        scene.add(gridHelper);

        // Create trade nodes as spheres distributed in 3D space based on time and P/L
        const meshes: THREE.Mesh[] = [];
        const lineGroup = new THREE.Group();
        scene.add(lineGroup);
        linesRef.current = lineGroup;

        if (trades.length > 0) {
            const timeRange = trades.length > 1
                ? new Date(trades[trades.length - 1].timestamp).getTime() - new Date(trades[0].timestamp).getTime()
                : 1;
            const maxAbsPnL = Math.max(...trades.map(t => Math.abs(t.sessionPnL)), 1);

            trades.forEach((trade, i) => {
                const timeFrac = trades.length > 1
                    ? (new Date(trade.timestamp).getTime() - new Date(trades[0].timestamp).getTime()) / timeRange
                    : 0.5;

                // Position: X = time progression, Y = session P/L, Z = variation by asset
                const x = (timeFrac - 0.5) * 20;
                const y = (trade.sessionPnL / maxAbsPnL) * 6;
                const assetHash = trade.asset.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
                const z = ((assetHash % 10) - 5) * 1.2;

                const size = 0.15 + Math.abs(trade.pnl) / (maxAbsPnL * 0.3) * 0.35;
                const color = LABEL_COLORS[trade.label] || 0x6b7280;

                const geometry = new THREE.SphereGeometry(Math.min(size, 0.6), 24, 24);
                const material = new THREE.MeshStandardMaterial({
                    color,
                    roughness: 0.2,
                    metalness: 0.8,
                    emissive: new THREE.Color(color),
                    emissiveIntensity: 0.15,
                });

                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.set(x, y, z);
                mesh.userData = { trade, index: i };
                scene.add(mesh);
                meshes.push(mesh);

                // Glow ring for biased trades
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

                // Connection lines between consecutive trades
                if (i > 0) {
                    const prevMesh = meshes[i - 1];
                    const points = [prevMesh.position.clone(), mesh.position.clone()];
                    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
                    const lineMat = new THREE.LineBasicMaterial({
                        color: trade.pnl >= 0 ? 0x06d6a0 : 0xef476f,
                        transparent: true,
                        opacity: 0.2,
                    });
                    const line = new THREE.Line(lineGeo, lineMat);
                    lineGroup.add(line);
                }
            });
        }

        meshesRef.current = meshes;

        // Particles background
        const particleCount = 500;
        const particleGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount * 3; i++) {
            positions[i] = (Math.random() - 0.5) * 60;
        }
        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMat = new THREE.PointsMaterial({
            color: 0x06d6a0,
            size: 0.05,
            transparent: true,
            opacity: 0.4,
        });
        const particles = new THREE.Points(particleGeo, particleMat);
        scene.add(particles);

        // Animation loop
        const animate = () => {
            frameRef.current = requestAnimationFrame(animate);
            controls.update();

            // Gentle particle rotation
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

            // Pulse biased node rings
            meshes.forEach((mesh) => {
                const trade = mesh.userData.trade as TradeNode;
                if (trade.biases.length > 0) {
                    const scale = 1 + Math.sin(Date.now() * 0.003 + mesh.userData.index) * 0.05;
                    mesh.scale.setScalar(scale);
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
            const intersects = raycasterRef.current.intersectObjects(meshes);
            if (intersects.length > 0) {
                const trade = intersects[0].object.userData.trade as TradeNode;
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
            const intersects = raycasterRef.current.intersectObjects(meshes);
            if (intersects.length > 0) {
                const trade = intersects[0].object.userData.trade as TradeNode;
                onNodeClick?.(trade);
                controls.autoRotate = false;
            }
        };

        container.addEventListener('mousemove', handleMouseMove);
        container.addEventListener('click', handleClick);

        // Resize handler
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
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
    }, [trades, onNodeClick, onNodeHover]);

    return (
        <div className={`relative ${className || ''}`}>
            <div ref={containerRef} className="h-full w-full" />

            {/* Hover tooltip */}
            {hoveredTrade && (
                <div
                    className="pointer-events-none absolute z-20 rounded-xl bg-[#1a1a1a]/95 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-md"
                    style={{ left: hoverPos.x + 16, top: hoverPos.y - 16, maxWidth: 240 }}
                >
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-white">{hoveredTrade.asset}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            hoveredTrade.pnl >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                            {hoveredTrade.pnl >= 0 ? '+' : ''}{hoveredTrade.pnl.toFixed(0)}
                        </span>
                    </div>
                    <p className="text-[10px] text-gray-400">
                        {hoveredTrade.side} · {hoveredTrade.label} · {hoveredTrade.timestamp.split(' ')[1]?.slice(0, 5)}
                    </p>
                    {hoveredTrade.biases.length > 0 && (
                        <p className="text-[10px] text-red-400 mt-1">
                            ⚠ {hoveredTrade.biases.join(', ')}
                        </p>
                    )}
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

            {/* Controls hint */}
            <div className="absolute top-4 right-4 rounded-lg bg-[#0a0a0a]/80 px-3 py-2 backdrop-blur-sm ring-1 ring-white/5">
                <p className="text-[10px] text-gray-500">Drag to rotate · Scroll to zoom · Click node for details</p>
            </div>
        </div>
    );
}
