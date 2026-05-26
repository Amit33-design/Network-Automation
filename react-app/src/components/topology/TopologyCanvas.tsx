import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { TopologyGraph } from '@/domain/topology';

// ─── Layer Y positions ────────────────────────────────────────────────────────
const LAYER_Y: Record<string, number> = {
  'super-spine': 0,
  'pe-router':   0,
  'p-router':    0,
  'sdwan-controller': 0,
  'sdwan-orchestrator': 0,
  spine:         150,
  core:          150,
  'wan-edge':    150,
  distribution:  300,
  leaf:          300,
  'border-leaf': 300,
  'firewall':    300,
  access:        450,
  'server':      600,
};

const ROLE_COLOR: Record<string, string> = {
  spine:         '#3b82f6',
  'super-spine': '#1d4ed8',
  leaf:          '#10b981',
  'border-leaf': '#059669',
  core:          '#8b5cf6',
  distribution:  '#6d28d9',
  access:        '#f59e0b',
  'pe-router':   '#ef4444',
  'p-router':    '#dc2626',
  'wan-edge':    '#f97316',
  firewall:      '#e11d48',
};

interface TopologyCanvasProps {
  graph: TopologyGraph;
  height?: number;
}

export function TopologyCanvas({ graph, height = 520 }: TopologyCanvasProps) {
  const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
    // Group nodes by layer to compute X positions
    const byLayer: Record<string, typeof graph.nodes> = {};
    for (const n of graph.nodes) {
      const layer = n.layer ?? 'leaf';
      (byLayer[layer] ??= []).push(n);
    }

    const nodes: Node[] = graph.nodes.map((n) => {
      const layer = n.layer ?? 'leaf';
      const peers = byLayer[layer] ?? [];
      const idx = peers.indexOf(n);
      const gap = 160;
      const totalW = (peers.length - 1) * gap;
      const x = idx * gap - totalW / 2 + 400;
      const y = LAYER_Y[layer] ?? 300;
      const color = ROLE_COLOR[n.role ?? layer] ?? '#64748b';

      return {
        id: n.id,
        position: { x, y },
        data: { label: n.hostname ?? n.id },
        style: {
          background: `${color}22`,
          border: `2px solid ${color}`,
          borderRadius: 8,
          color: '#f1f5f9',
          fontSize: 11,
          fontFamily: 'monospace',
          padding: '6px 10px',
          minWidth: 100,
          textAlign: 'center' as const,
        },
      };
    });

    const edges: Edge[] = graph.links.map((l, i) => ({
      id: `e${i}`,
      source: l.source,
      target: l.target,
      style: { stroke: '#475569', strokeWidth: 1.5 },
      animated: false,
    }));

    return { nodes, edges };
  }, [graph]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 border border-slate-700 rounded-lg text-slate-500 text-sm">
        No devices — complete the Requirements tab first.
      </div>
    );
  }

  return (
    <div style={{ height }} className="border border-slate-700 rounded-lg overflow-hidden">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        zoomOnScroll
        colorMode="dark"
      >
        <Background color="#334155" gap={24} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => (n.style as { border?: string })?.border?.replace('2px solid ', '') ?? '#475569'}
          maskColor="#0f172a99"
          style={{ background: '#1e293b' }}
        />
      </ReactFlow>
    </div>
  );
}
