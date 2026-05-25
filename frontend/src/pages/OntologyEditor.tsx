import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useOntology,
  useGraph,
  useValidateOntology,
  downloadExport,
  useCreateVersion,
  useOntologyStatus,
  useAddRelationship,
  useDeleteRelationship,
  useDeleteClass,
  useAddClass,
  keys as queryKeys,
} from "@/api/ontologies";
import { useOntologyStore } from "@/store/ontologyStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import type { GraphNode } from "@/types/ontology";
import type { EdgeCreateEvent } from "@/components/graph/ConnectionTool";
import type { GraphMenuActions } from "@/components/graph/GraphContextMenu";
import Toolbar from "@/components/Toolbar";
import GraphViewer from "@/components/GraphViewer";
import NodePanel from "@/components/NodePanel";
import ProcessingOverlay from "@/components/ProcessingOverlay";
import ConnectionBanner from "@/components/ConnectionBanner";
import AddClassDialog from "@/components/AddClassDialog";
import RelationshipPickerDialog from "@/components/RelationshipPickerDialog";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import ValidationPanel from "@/components/ValidationPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function OntologyEditor() {
  const { id: ontologyId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    selectedNodeId,
    editMode,
    searchQuery,
    sidePanel,
    validationResult,
    setSelectedNode,
    toggleEditMode,
    setSearchQuery,
    setSidePanel,
    setValidationResult,
  } = useOntologyStore();

  const {
    data: ontology,
    isLoading: ontologyLoading,
    error: ontologyError,
  } = useOntology(ontologyId!);
  const { data: graphData, isLoading: graphLoading } = useGraph(ontologyId!);

  const isProcessing = ontology?.status === "processing";
  const { data: taskStatus } = useOntologyStatus(ontologyId!, isProcessing);

  const validateOntology = useValidateOntology(ontologyId!);
  const createVersion = useCreateVersion(ontologyId!);
  const addRelationship = useAddRelationship(ontologyId!);
  const deleteRelationship = useDeleteRelationship(ontologyId!);
  const deleteClass = useDeleteClass(ontologyId!);
  const addClass = useAddClass(ontologyId!);

  const { pushAction, undo, redo, canUndo, canRedo, undoDescription, redoDescription } =
    useUndoRedo();

  // State for context menu actions
  const [addClassDialogOpen, setAddClassDialogOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    nodeId: string;
    nodeUri: string;
    nodeLabel: string;
  } | null>(null);
  const [pendingEdge, setPendingEdge] = useState<EdgeCreateEvent | null>(null);

  // WebSocket for live updates during processing
  const { lastMessage, connectionState, reconnectNow } = useWebSocket(ontologyId!);

  // Detect processing completion via HTTP polling (works without WebSocket)
  const prevTaskStatusRef = useRef<string | undefined>();
  useEffect(() => {
    const current = taskStatus?.status;
    const prev = prevTaskStatusRef.current;
    prevTaskStatusRef.current = current;

    if (!current || current === prev) return;

    if (current === "ready") {
      toast.success("Ontology processing complete!");
      void queryClient.invalidateQueries({ queryKey: queryKeys.detail(ontologyId!) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.graph(ontologyId!) });
    } else if (current === "error") {
      const msg = taskStatus?.message ?? "Unknown error";
      toast.error(`Processing failed: ${msg}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.detail(ontologyId!) });
    }
  }, [taskStatus?.status, taskStatus?.message, queryClient, ontologyId]);

  // Handle WebSocket messages — fast-path invalidation (toast handled by polling effect)
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === "status_update") {
      const status = lastMessage.payload?.status as string | undefined;
      if (status === "ready" || status === "error") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.detail(ontologyId!) });
        if (status === "ready") {
          void queryClient.invalidateQueries({ queryKey: queryKeys.graph(ontologyId!) });
        }
      }
    }
  }, [lastMessage, queryClient, ontologyId]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        void undo();
      } else if (e.key.toLowerCase() === "z" && e.shiftKey) {
        e.preventDefault();
        void redo();
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        void redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editMode, undo, redo]);

  // Find the selected node from graph data
  const selectedNode: GraphNode | null = useMemo(() => {
    if (!selectedNodeId || !graphData?.nodes) return null;
    return graphData.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId, graphData]);

  const edges = useMemo(() => graphData?.edges ?? [], [graphData]);

  const nodeLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of graphData?.nodes ?? []) {
      map.set(n.id, n.label || n.uri || n.id);
    }
    return map;
  }, [graphData]);

  const graphDataRef = useRef(graphData);
  graphDataRef.current = graphData;

  // Callbacks
  const handleNodeSelect = useCallback(
    (nodeId: string | null) => {
      setSelectedNode(nodeId);
      if (nodeId) {
        setSidePanel("details");
      }
    },
    [setSelectedNode, setSidePanel],
  );

  const handleToggleEditMode = useCallback(() => {
    toggleEditMode();
  }, [toggleEditMode]);

  const handleEdgeCreate = useCallback(
    (event: EdgeCreateEvent) => {
      setPendingEdge(event);
    },
    [],
  );

  const handleRelationshipSelect = useCallback(
    async (relationshipType: string) => {
      if (!pendingEdge) return;
      const payload = {
        source_uri: pendingEdge.sourceUri,
        target_uri: pendingEdge.targetUri,
        relationship_type: relationshipType,
      };
      const { sourceId, targetId } = pendingEdge;
      try {
        await addRelationship.mutateAsync(payload);
        toast.success("Relationship created");
        pushAction({
          type: "ADD_RELATIONSHIP",
          doAction: async () => {
            await addRelationship.mutateAsync(payload);
          },
          undoAction: async () => {
            const edges = graphDataRef.current?.edges ?? [];
            const edge = edges.find(
              (e) =>
                e.source === sourceId &&
                e.target === targetId &&
                e.edge_type === relationshipType,
            );
            if (edge) await deleteRelationship.mutateAsync(edge.id);
          },
          description: `Add Relationship '${relationshipType}'`,
        });
      } catch {
        toast.error("Failed to create relationship");
      }
      setPendingEdge(null);
    },
    [addRelationship, deleteRelationship, pendingEdge, pushAction],
  );

  const handleSearchChange = useCallback(
    (q: string) => {
      setSearchQuery(q);
    },
    [setSearchQuery],
  );

  const handleValidate = useCallback(async () => {
    try {
      const result = await validateOntology.mutateAsync();
      setValidationResult(result);
      setSidePanel("validation");
      if (result.conforms) {
        toast.success("Validation passed - no issues found");
      } else {
        toast.warning(`Validation found ${result.violations?.length ?? 0} issue(s)`);
      }
    } catch {
      toast.error("Validation failed");
    }
  }, [validateOntology, setValidationResult, setSidePanel]);

  const handleExport = useCallback(
    async (format: string) => {
      try {
        await downloadExport(ontologyId!, format, ontology?.name);
        toast.success(`Exported as ${format.toUpperCase()}`);
      } catch {
        toast.error("Export failed");
      }
    },
    [ontologyId, ontology?.name],
  );

  // Context menu action handlers
  const handleContextDeleteNode = useCallback(
    async (nodeUri: string) => {
      const node = graphDataRef.current?.nodes.find((n) => n.uri === nodeUri);
      const capturedLabel = node?.label ?? "";
      const capturedDescription = node?.description ?? "";

      try {
        await deleteClass.mutateAsync(nodeUri);
        toast.success("Node deleted");
        setSelectedNode(null);
        setDeleteConfirm(null);
        pushAction({
          type: "DELETE_CLASS",
          doAction: async () => {
            await deleteClass.mutateAsync(nodeUri);
          },
          undoAction: async () => {
            await addClass.mutateAsync({
              uri: nodeUri,
              label: capturedLabel,
              description: capturedDescription || undefined,
            });
          },
          description: `Delete Class '${capturedLabel}'`,
        });
      } catch {
        toast.error("Failed to delete node");
      }
    },
    [deleteClass, addClass, setSelectedNode, pushAction],
  );

  const handleContextAddClass = useCallback(
    async (uri: string, label: string, description?: string) => {
      try {
        await addClass.mutateAsync({ uri, label, description });
        toast.success("Class added");
        setAddClassDialogOpen(false);
        pushAction({
          type: "ADD_CLASS",
          doAction: async () => {
            await addClass.mutateAsync({ uri, label, description });
          },
          undoAction: async () => {
            await deleteClass.mutateAsync(uri);
          },
          description: `Add Class '${label}'`,
        });
      } catch {
        toast.error("Failed to add class");
      }
    },
    [addClass, deleteClass, pushAction],
  );

  const menuActions: GraphMenuActions = useMemo(
    () => ({
      onSelectForEdit: (nodeId: string) => {
        setSelectedNode(nodeId);
        setSidePanel("details");
        if (!editMode) toggleEditMode();
      },
      onDeleteNode: (nodeId: string, nodeUri: string, nodeLabel: string) => {
        setDeleteConfirm({ nodeId, nodeUri, nodeLabel });
      },
      onAddRelationshipFrom: (nodeId: string) => {
        setSelectedNode(nodeId);
        setSidePanel("details");
        if (!editMode) toggleEditMode();
      },
      onAddClass: () => {
        setAddClassDialogOpen(true);
      },
    }),
    [setSelectedNode, setSidePanel, editMode, toggleEditMode],
  );

  const handleCreateVersion = useCallback(async () => {
    try {
      await createVersion.mutateAsync("Version created from editor");
      toast.success("Version created");
    } catch {
      toast.error("Failed to create version");
    }
  }, [createVersion]);

  // Loading state
  if (ontologyLoading || graphLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Loading ontology...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (ontologyError || !ontology) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <p className="mt-3 text-sm text-destructive">Failed to load ontology</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/")}>
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Toolbar */}
      <Toolbar
        ontology={ontology}
        onValidate={handleValidate}
        onExport={handleExport}
        onCreateVersion={handleCreateVersion}
        onToggleEditMode={handleToggleEditMode}
        editMode={editMode}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        undoDescription={undoDescription}
        redoDescription={redoDescription}
      />

      {/* Main Content Area */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Graph Viewer (center) */}
        <div className="relative flex-1 overflow-hidden">
          <GraphViewer
            data={graphData ?? { nodes: [], edges: [] }}
            onNodeSelect={handleNodeSelect}
            onEdgeCreate={handleEdgeCreate}
            menuActions={menuActions}
            searchQuery={searchQuery}
            editMode={editMode}
            selectedNodeId={selectedNodeId}
          />

          {/* Connection Status Banner */}
          <ConnectionBanner
            connectionState={connectionState}
            onReconnect={reconnectNow}
          />

          {/* Processing Overlay */}
          <ProcessingOverlay
            status={taskStatus ?? null}
            isProcessing={isProcessing}
          />

          {/* Validation Panel (floating at bottom of graph) */}
          {validationResult && (
            <div className="absolute bottom-4 left-4 right-4 z-40 max-w-xl">
              <div className="relative">
                <button
                  className="absolute right-2 top-2 z-10 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setValidationResult(null)}
                >
                  Dismiss
                </button>
                <ValidationPanel result={validationResult} />
              </div>
            </div>
          )}
        </div>

        {/* Side Panel (right) */}
        <div
          className={cn(
            "shrink-0 border-l bg-white transition-all duration-200",
            sidePanel !== null ? "w-[350px]" : "w-0",
          )}
        >
          {sidePanel !== null && (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <h2 className="text-sm font-medium">Node Details</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSidePanel(null);
                    setSelectedNode(null);
                  }}
                  className="h-7 w-7 p-0"
                >
                  &times;
                </Button>
              </div>
              <div className="flex-1 overflow-hidden">
                <NodePanel
                  node={selectedNode}
                  ontologyId={ontologyId!}
                  editMode={editMode}
                  edges={edges}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog (context menu) */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Node</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteConfirm?.nodeLabel}&quot;? This will
              also remove all connected relationships. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleContextDeleteNode(deleteConfirm.nodeUri)}
              disabled={deleteClass.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Class Dialog (context menu) */}
      <AddClassDialog
        open={addClassDialogOpen}
        onOpenChange={setAddClassDialogOpen}
        onSubmit={handleContextAddClass}
        isPending={addClass.isPending}
        namespaceUri={ontology?.namespace_uri}
      />

      {/* Relationship Type Picker (drag-to-connect) */}
      <RelationshipPickerDialog
        open={pendingEdge !== null}
        sourceLabel={pendingEdge ? (nodeLabels.get(pendingEdge.sourceId) ?? pendingEdge.sourceUri) : ""}
        targetLabel={pendingEdge ? (nodeLabels.get(pendingEdge.targetId) ?? pendingEdge.targetUri) : ""}
        onSelect={handleRelationshipSelect}
        onCancel={() => setPendingEdge(null)}
        isPending={addRelationship.isPending}
      />
    </div>
  );
}
