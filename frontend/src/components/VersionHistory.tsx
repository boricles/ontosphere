import { useState } from "react";
import { useVersions, useRollbackVersion } from "@/api/ontologies";
import { OntologyVersion } from "@/types/ontology";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, RotateCcw, Clock, GitCompareArrows } from "lucide-react";
import { toast } from "sonner";
import VersionDiffPanel from "@/components/VersionDiffPanel";

interface VersionHistoryProps {
  ontologyId: string;
  open: boolean;
  onClose: () => void;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VersionHistory({ ontologyId, open, onClose }: VersionHistoryProps) {
  const { data: versions, isLoading } = useVersions(ontologyId);
  const rollbackMutation = useRollbackVersion(ontologyId);
  const [confirmVersion, setConfirmVersion] = useState<OntologyVersion | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [showDiff, setShowDiff] = useState(false);

  const handleRollback = async (version: OntologyVersion) => {
    try {
      await rollbackMutation.mutateAsync(version.id);
      toast.success(`Rolled back to version ${version.version_number}`);
      setConfirmVersion(null);
      onClose();
    } catch {
      toast.error("Failed to rollback version");
    }
  };

  const toggleVersion = (versionId: string) => {
    setSelectedVersions((prev) => {
      if (prev.includes(versionId)) {
        return prev.filter((id) => id !== versionId);
      }
      if (prev.length >= 2) return prev;
      return [...prev, versionId];
    });
  };

  const handleCompare = () => {
    if (selectedVersions.length !== 2 || !versions) return;
    // Sort so older version is "from"
    const sorted = [...selectedVersions].sort((a, b) => {
      const va = versions.find((v) => v.id === a);
      const vb = versions.find((v) => v.id === b);
      return (va?.version_number ?? 0) - (vb?.version_number ?? 0);
    });
    setSelectedVersions(sorted);
    setShowDiff(true);
  };

  const exitCompareMode = () => {
    setCompareMode(false);
    setSelectedVersions([]);
    setShowDiff(false);
  };

  // Sort so older version is "from" for the diff panel
  const [diffFromId, diffToId] = selectedVersions;

  return (
    <>
      <Dialog open={open && !showDiff} onOpenChange={(isOpen) => {
        if (!isOpen) {
          exitCompareMode();
          onClose();
        }
      }}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Version History
              {versions && versions.length >= 2 && (
                <Button
                  variant={compareMode ? "default" : "outline"}
                  size="sm"
                  className="ml-auto h-7 text-xs"
                  onClick={() => {
                    if (compareMode) {
                      exitCompareMode();
                    } else {
                      setCompareMode(true);
                    }
                  }}
                >
                  <GitCompareArrows className="mr-1 h-3.5 w-3.5" />
                  Compare
                </Button>
              )}
            </DialogTitle>
            <DialogDescription>
              {compareMode
                ? "Select two versions to compare."
                : "View and rollback to previous versions of this ontology."}
            </DialogDescription>
          </DialogHeader>

          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && (!versions || versions.length === 0) && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Clock className="h-8 w-8 opacity-50" />
              <p className="mt-2 text-sm">No versions created yet.</p>
            </div>
          )}

          {!isLoading && versions && versions.length > 0 && (
            <>
              <ul className="divide-y">
                {versions.map((version) => {
                  const isSelected = selectedVersions.includes(version.id);
                  return (
                    <li key={version.version_number} className="flex items-center justify-between py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">v{version.version_number}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(version.created_at)}
                          </span>
                        </div>
                        {version.description && (
                          <p className="mt-1 truncate text-sm text-muted-foreground">
                            {version.description}
                          </p>
                        )}
                      </div>
                      {compareMode ? (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!isSelected && selectedVersions.length >= 2}
                          onChange={() => toggleVersion(version.id)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmVersion(version)}
                          disabled={rollbackMutation.isPending}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" />
                          Rollback
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>

              {compareMode && (
                <div className="flex justify-end pt-2">
                  <Button
                    size="sm"
                    disabled={selectedVersions.length !== 2}
                    onClick={handleCompare}
                  >
                    <GitCompareArrows className="mr-1 h-3.5 w-3.5" />
                    Compare
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Rollback Confirmation Dialog */}
      <Dialog
        open={confirmVersion !== null}
        onOpenChange={(isOpen) => !isOpen && setConfirmVersion(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Rollback</DialogTitle>
            <DialogDescription>
              Are you sure you want to rollback to version {confirmVersion?.version_number}? This
              will replace the current ontology state.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmVersion(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmVersion && handleRollback(confirmVersion)}
              disabled={rollbackMutation.isPending}
            >
              {rollbackMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Rollback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diff Panel */}
      {showDiff && diffFromId && diffToId && (
        <VersionDiffPanel
          ontologyId={ontologyId}
          versionAId={diffFromId}
          versionBId={diffToId}
          open={showDiff}
          onClose={() => setShowDiff(false)}
        />
      )}
    </>
  );
}
