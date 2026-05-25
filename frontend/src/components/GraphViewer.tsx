import { useRef, useEffect, useMemo } from "react";
import cytoscape, { Core, EventObject } from "cytoscape";
import dagre from "cytoscape-dagre";
import { GraphData } from "@/types/ontology";
import {
  createConnectionTool,
  type IConnectionTool,
  type EdgeCreateEvent,
} from "@/components/graph/ConnectionTool";
import {
  createGraphContextMenu,
  type IGraphContextMenu,
  type GraphMenuActions,
} from "@/components/graph/GraphContextMenu";
import "cytoscape-context-menus/cytoscape-context-menus.css";
import { Network } from "lucide-react";

// Register the dagre layout extension once
let dagreRegistered = false;
if (!dagreRegistered) {
  try {
    cytoscape.use(dagre);
  } catch {
    // Already registered
  }
  dagreRegistered = true;
}

interface GraphViewerProps {
  data: GraphData;
  onNodeSelect: (nodeId: string | null) => void;
  onEdgeCreate?: (event: EdgeCreateEvent) => void;
  menuActions?: GraphMenuActions;
  searchQuery: string;
  editMode: boolean;
  selectedNodeId: string | null;
}

const NODE_COLORS: Record<string, string> = {
  class: "#3b82f6",
  property: "#22c55e",
  individual: "#a855f7",
};

const NODE_SHAPES: Record<string, string> = {
  class: "roundrectangle",
  property: "diamond",
  individual: "ellipse",
};

const EDGE_STYLES: Record<string, { lineColor: string; lineStyle: string }> = {
  SUBCLASS_OF: { lineColor: "#374151", lineStyle: "solid" },
  HAS_PROPERTY: { lineColor: "#22c55e", lineStyle: "dashed" },
  DOMAIN: { lineColor: "#9ca3af", lineStyle: "dotted" },
  RANGE: { lineColor: "#9ca3af", lineStyle: "dotted" },
  RELATED_TO: { lineColor: "#6366f1", lineStyle: "solid" },
  EQUIVALENT_TO: { lineColor: "#f59e0b", lineStyle: "solid" },
  DISJOINT_WITH: { lineColor: "#ef4444", lineStyle: "dashed" },
};

export default function GraphViewer({
  data,
  onNodeSelect,
  onEdgeCreate,
  menuActions,
  searchQuery,
  editMode,
  selectedNodeId,
}: GraphViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const connectionToolRef = useRef<IConnectionTool | null>(null);
  const contextMenuRef = useRef<IGraphContextMenu | null>(null);

  // Convert graph data to cytoscape elements
  const elements = useMemo(() => {
    const nodes = (data.nodes ?? []).map((node) => ({
      data: {
        id: node.id,
        label: node.label || node.uri || node.id,
        type: node.node_type || "class",
        uri: node.uri,
        description: node.description,
      },
    }));

    const edges = (data.edges ?? []).map((edge) => ({
      data: {
        id: edge.id || `${edge.source}-${edge.edge_type}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        edge_type: edge.edge_type || "RELATED_TO",
        label: edge.edge_type || "",
      },
    }));

    return { nodes, edges };
  }, [data]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [...elements.nodes, ...elements.edges],
      style: [
        {
          selector: "node",
          style: {
            label: "data(label)",
            "text-valign": "center" as const,
            "text-halign": "center" as const,
            "font-size": "11px",
            "text-wrap": "wrap" as const,
            "text-max-width": "100px",
            color: "#ffffff",
            "text-outline-color": "#000000",
            "text-outline-width": 1,
            width: 60,
            height: 40,
            "background-color": (ele: cytoscape.NodeSingular) =>
              NODE_COLORS[ele.data("type")] || NODE_COLORS.class,
            shape: (ele: cytoscape.NodeSingular) =>
              NODE_SHAPES[ele.data("type")] || NODE_SHAPES.class,
            "border-width": 2,
            "border-color": (ele: cytoscape.NodeSingular) =>
              NODE_COLORS[ele.data("type")] || NODE_COLORS.class,
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 4,
            "border-color": "#eab308",
            width: 70,
            height: 50,
          },
        },
        {
          selector: "node.highlighted",
          style: {
            "border-width": 3,
            "border-color": "#eab308",
          },
        },
        {
          selector: "node.faded",
          style: {
            opacity: 0.2,
          },
        },
        {
          selector: "edge",
          style: {
            width: 2,
            "curve-style": "bezier" as const,
            "target-arrow-shape": "triangle" as const,
            "target-arrow-color": "#9ca3af",
            "line-color": "#9ca3af",
            label: "data(label)",
            "font-size": "9px",
            "text-rotation": "autorotate" as const,
            color: "#6b7280",
            "text-background-color": "#ffffff",
            "text-background-opacity": 0.8,
            "text-background-padding": "2px",
          },
        },
        {
          selector: "edge.faded",
          style: {
            opacity: 0.15,
          },
        },
        // Edge type specific styles
        ...Object.entries(EDGE_STYLES).map(([type, style]) => ({
          selector: `edge[edge_type = "${type}"]`,
          style: {
            "line-color": style.lineColor,
            "target-arrow-color": style.lineColor,
            "line-style": style.lineStyle as "solid" | "dashed" | "dotted",
          },
        })),
      ],
      layout: {
        name: "dagre",
        rankDir: "TB",
        nodeSep: 60,
        rankSep: 80,
        padding: 30,
      } as cytoscape.LayoutOptions,
      minZoom: 0.2,
      maxZoom: 4,
      wheelSensitivity: 0.3,
    });

    cyRef.current = cy;

    // Event handlers
    cy.on("tap", "node", (evt: EventObject) => {
      const nodeId = evt.target.id();
      onNodeSelect(nodeId);
    });

    cy.on("tap", (evt: EventObject) => {
      if (evt.target === cy) {
        onNodeSelect(null);
      }
    });

    // Initialize connection tool (starts disabled — editMode effect controls it)
    if (onEdgeCreate) {
      connectionToolRef.current = createConnectionTool(cy, cytoscape, {
        onEdgeCreate,
      });
    }

    // Initialize context menu (starts hidden — editMode effect controls it)
    if (menuActions) {
      contextMenuRef.current = createGraphContextMenu(cy, cytoscape, menuActions);
    }

    // Fit to view
    cy.fit(undefined, 30);

    return () => {
      contextMenuRef.current?.destroy();
      contextMenuRef.current = null;
      connectionToolRef.current?.destroy();
      connectionToolRef.current = null;
      cy.destroy();
      cyRef.current = null;
    };
    // Only re-create when elements change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements]);

  // Toggle edit-mode tools (connection tool + context menu)
  // Re-run when elements change because the Cytoscape instance (and tools)
  // are recreated — the new tools start disabled and need re-enabling.
  useEffect(() => {
    const connTool = connectionToolRef.current;
    const ctxMenu = contextMenuRef.current;

    if (editMode) {
      connTool?.enable();
      ctxMenu?.enable();
    } else {
      connTool?.disable();
      ctxMenu?.disable();
    }
  }, [editMode, elements]);

  // Handle external node selection
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.nodes().unselect();
    cy.nodes().removeClass("highlighted");

    if (selectedNodeId) {
      const node = cy.getElementById(selectedNodeId);
      if (node.length > 0) {
        node.select();
        node.addClass("highlighted");
      }
    }
  }, [selectedNodeId]);

  // Handle search highlighting
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      cy.elements().removeClass("faded");
      return;
    }

    cy.batch(() => {
      cy.elements().addClass("faded");

      cy.nodes().forEach((node) => {
        const label = (node.data("label") || "").toLowerCase();
        const id = (node.data("id") || "").toLowerCase();
        if (label.includes(query) || id.includes(query)) {
          node.removeClass("faded");
          node.connectedEdges().removeClass("faded");
          node.connectedEdges().connectedNodes().removeClass("faded");
        }
      });
    });
  }, [searchQuery]);

  const isEmpty = elements.nodes.length === 0;

  if (isEmpty) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
        <Network className="h-12 w-12 opacity-30" />
        <p className="mt-3 text-sm">No graph data to display.</p>
        <p className="text-xs">Upload documents and process the ontology to generate a graph.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ minHeight: 400 }}
    />
  );
}
