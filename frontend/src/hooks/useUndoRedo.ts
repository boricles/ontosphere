import { useCallback, useReducer, useRef } from "react";

export interface UndoableAction {
  type: string;
  doAction: () => Promise<void>;
  undoAction: () => Promise<void>;
  description: string;
}

const MAX_STACK_SIZE = 50;

export function useUndoRedo() {
  const undoStackRef = useRef<UndoableAction[]>([]);
  const redoStackRef = useRef<UndoableAction[]>([]);
  const [, forceUpdate] = useReducer((c: number) => c + 1, 0);

  const pushAction = useCallback((action: UndoableAction) => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_STACK_SIZE - 1)),
      action,
    ];
    redoStackRef.current = [];
    forceUpdate();
  }, []);

  const undo = useCallback(async () => {
    const stack = undoStackRef.current;
    const action = stack[stack.length - 1];
    if (!action) return;
    await action.undoAction();
    undoStackRef.current = stack.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, action];
    forceUpdate();
  }, []);

  const redo = useCallback(async () => {
    const stack = redoStackRef.current;
    const action = stack[stack.length - 1];
    if (!action) return;
    await action.doAction();
    redoStackRef.current = stack.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, action];
    forceUpdate();
  }, []);

  return {
    pushAction,
    undo,
    redo,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    undoDescription: undoStackRef.current[undoStackRef.current.length - 1]?.description,
    redoDescription: redoStackRef.current[redoStackRef.current.length - 1]?.description,
  };
}
