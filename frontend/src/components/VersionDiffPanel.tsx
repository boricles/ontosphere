import { useVersionDiff } from "@/api/ontologies";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, ArrowLeft } from "lucide-react";
import type { NodeDiff, EdgeDiff, BreakingChange } from "@/types/ontology";

interface VersionDiffPanelProps {
  ontologyId: string;
  versionAId: string;
  versionBId: string;
  open: boolean;
  onClose: () => void;
}

function statusBadge(status: "added" | "removed" | "modified") {
  const variants: Record<string, string> = {
    added: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    removed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    modified: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variants[status]}`}
    >
      {status}
    </span>
  );
}

function localName(uri: string): string {
  const idx = Math.max(uri.lastIndexOf("#"), uri.lastIndexOf("/"));
  return idx >= 0 ? uri.slice(idx + 1) : uri;
}

function NodeDiffRow({ node }: { node: NodeDiff }) {
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-2">
        {statusBadge(node.status)}
        <span className="font-medium text-sm">{node.label || localName(node.uri)}</span>
        <span className="text-xs text-muted-foreground truncate">{node.uri}</span>
      </div>
      {node.status === "modified" && Object.keys(node.changes).length > 0 && (
        <div className="ml-6 space-y-0.5">
          {Object.entries(node.changes).map(([field, vals]) => (
            <div key={field} className="text-xs text-muted-foreground">
              <span className="font-medium">{field}:</span>{" "}
              <span className="line-through text-red-600 dark:text-red-400">{vals.old || "(empty)"}</span>
              {" \u2192 "}
              <span className="text-green-600 dark:text-green-400">{vals.new || "(empty)"}</span>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

function EdgeDiffRow({ edge }: { edge: EdgeDiff }) {
  return (
    <li className="flex items-center gap-2 py-2">
      {statusBadge(edge.status)}
      <span className="text-sm">
        {localName(edge.source_uri)}
        <span className="mx-1 text-muted-foreground">{"\u2192"}</span>
        {localName(edge.target_uri)}
      </span>
      <Badge variant="outline" className="text-xs">
        {edge.edge_type}
      </Badge>
    </li>
  );
}

function severityBadge(severity: "error" | "warning") {
  if (severity === "error") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900 dark:text-red-200">
        error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900 dark:text-orange-200">
      warning
    </span>
  );
}

function BreakingChangeRow({ change }: { change: BreakingChange }) {
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-start gap-2">
        {severityBadge(change.severity)}
        <span className="text-sm">{change.message}</span>
      </div>
      {change.affected_uris.length > 0 && (
        <div className="ml-6 flex flex-wrap gap-1">
          {change.affected_uris.map((uri) => (
            <span
              key={uri}
              className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              {localName(uri)}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

export default function VersionDiffPanel({
  ontologyId,
  versionAId,
  versionBId,
  open,
  onClose,
}: VersionDiffPanelProps) {
  const { data: diff, isLoading, isError } = useVersionDiff(
    ontologyId,
    versionAId,
    versionBId,
  );

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {diff
              ? `Comparing v${diff.from_version} \u2192 v${diff.to_version}`
              : "Version Diff"}
          </DialogTitle>
          {diff && (
            <DialogDescription>{diff.summary}</DialogDescription>
          )}
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="py-8 text-center text-sm text-red-600 dark:text-red-400">
            Failed to load diff.
          </div>
        )}

        {diff && (
          <div className="space-y-4">
            {/* Compatibility section */}
            {diff.breaking_changes.length > 0 ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                <h3 className="text-sm font-semibold text-red-800 dark:text-red-200 mb-1">
                  Compatibility Issues
                </h3>
                <ul className="divide-y divide-red-200 dark:divide-red-800">
                  {diff.breaking_changes.map((change, i) => (
                    <BreakingChangeRow key={i} change={change} />
                  ))}
                </ul>
              </div>
            ) : (
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-950">
                <span className="text-sm text-green-800 dark:text-green-200">
                  No compatibility issues
                </span>
              </div>
            )}

            {/* Classes section */}
            <div>
              <h3 className="text-sm font-semibold mb-1">Classes</h3>
              {diff.nodes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No class changes.</p>
              ) : (
                <ul className="divide-y">
                  {diff.nodes.map((node) => (
                    <NodeDiffRow key={node.uri} node={node} />
                  ))}
                </ul>
              )}
            </div>

            {/* Relationships section */}
            <div>
              <h3 className="text-sm font-semibold mb-1">Relationships</h3>
              {diff.edges.length === 0 ? (
                <p className="text-xs text-muted-foreground">No relationship changes.</p>
              ) : (
                <ul className="divide-y">
                  {diff.edges.map((edge) => (
                    <EdgeDiffRow
                      key={`${edge.source_uri}-${edge.target_uri}-${edge.edge_type}`}
                      edge={edge}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
