import { useState } from "react";
import { Ontology } from "@/types/ontology";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle,
  Download,
  Edit3,
  Eye,
  Redo2,
  Save,
  Search,
  Clock,
  Undo2,
} from "lucide-react";
import VersionHistory from "@/components/VersionHistory";

interface ToolbarProps {
  ontology: Ontology;
  onValidate: () => void;
  onExport: (format: string) => void;
  onCreateVersion: () => void;
  onToggleEditMode: () => void;
  editMode: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoDescription?: string;
  redoDescription?: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  processing: "bg-yellow-100 text-yellow-800",
  ready: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
};

export default function Toolbar({
  ontology,
  onValidate,
  onExport,
  onCreateVersion,
  onToggleEditMode,
  editMode,
  searchQuery,
  onSearchChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  undoDescription,
  redoDescription,
}: ToolbarProps) {
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b bg-white px-4 py-3">
        {/* Ontology Name & Status */}
        <div className="mr-auto flex items-center gap-3">
          <h1 className="text-lg font-semibold">{ontology.name}</h1>
          <Badge
            variant="secondary"
            className={STATUS_STYLES[ontology.status] ?? STATUS_STYLES.draft}
          >
            {ontology.status.charAt(0).toUpperCase() + ontology.status.slice(1)}
          </Badge>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search nodes..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-9 w-48 pl-8 text-sm"
          />
        </div>

        {/* Edit Mode Toggle */}
        <Button
          variant={editMode ? "default" : "outline"}
          size="sm"
          onClick={onToggleEditMode}
        >
          {editMode ? (
            <>
              <Edit3 className="mr-1.5 h-3.5 w-3.5" />
              Editing
            </>
          ) : (
            <>
              <Eye className="mr-1.5 h-3.5 w-3.5" />
              Viewing
            </>
          )}
        </Button>

        {/* Undo / Redo (edit mode only) */}
        {editMode && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onUndo}
              disabled={!canUndo}
              title={undoDescription ? `Undo: ${undoDescription}` : "Undo"}
            >
              <Undo2 className="mr-1.5 h-3.5 w-3.5" />
              Undo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRedo}
              disabled={!canRedo}
              title={redoDescription ? `Redo: ${redoDescription}` : "Redo"}
            >
              <Redo2 className="mr-1.5 h-3.5 w-3.5" />
              Redo
            </Button>
          </>
        )}

        {/* Validate */}
        <Button variant="outline" size="sm" onClick={onValidate}>
          <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
          Validate
        </Button>

        {/* Export */}
        <div className="flex items-center gap-1">
          <Select onValueChange={onExport}>
            <SelectTrigger className="h-9 w-[130px] text-sm">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              <SelectValue placeholder="Export" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="owl">OWL</SelectItem>
              <SelectItem value="ttl">Turtle</SelectItem>
              <SelectItem value="jsonld">JSON-LD</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Create Version */}
        <Button variant="outline" size="sm" onClick={onCreateVersion}>
          <Save className="mr-1.5 h-3.5 w-3.5" />
          Save Version
        </Button>

        {/* Version History */}
        <Button variant="ghost" size="sm" onClick={() => setVersionHistoryOpen(true)}>
          <Clock className="mr-1.5 h-3.5 w-3.5" />
          History
        </Button>
      </div>

      <VersionHistory
        ontologyId={ontology.id}
        open={versionHistoryOpen}
        onClose={() => setVersionHistoryOpen(false)}
      />
    </>
  );
}
