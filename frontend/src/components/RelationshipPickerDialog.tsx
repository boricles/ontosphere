import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const RELATIONSHIP_TYPES = [
  "SUBCLASS_OF",
  "HAS_PROPERTY",
  "RELATED_TO",
  "EQUIVALENT_TO",
  "DISJOINT_WITH",
] as const;

interface RelationshipPickerDialogProps {
  open: boolean;
  sourceLabel: string;
  targetLabel: string;
  onSelect: (relationshipType: string) => void;
  onCancel: () => void;
  isPending: boolean;
}

export default function RelationshipPickerDialog({
  open,
  sourceLabel,
  targetLabel,
  onSelect,
  onCancel,
  isPending,
}: RelationshipPickerDialogProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customType, setCustomType] = useState("");

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setShowCustom(false);
      setCustomType("");
      onCancel();
    }
  };

  const handleSelect = (type: string) => {
    setShowCustom(false);
    setCustomType("");
    onSelect(type);
  };

  const handleCustomSubmit = () => {
    const trimmed = customType.trim();
    if (!trimmed) return;
    handleSelect(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose Relationship Type</DialogTitle>
          <DialogDescription>
            {sourceLabel} &rarr; {targetLabel}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          {RELATIONSHIP_TYPES.map((type) => (
            <Button
              key={type}
              variant="outline"
              className="justify-start font-mono text-sm"
              onClick={() => handleSelect(type)}
              disabled={isPending}
            >
              {type}
            </Button>
          ))}
          {showCustom ? (
            <div className="flex gap-2">
              <Input
                autoFocus
                placeholder="CUSTOM_TYPE"
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCustomSubmit();
                }}
                className="font-mono text-sm"
              />
              <Button
                onClick={handleCustomSubmit}
                disabled={isPending || !customType.trim()}
                size="sm"
              >
                OK
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="justify-start text-sm text-muted-foreground"
              onClick={() => setShowCustom(true)}
              disabled={isPending}
            >
              Custom&hellip;
            </Button>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
