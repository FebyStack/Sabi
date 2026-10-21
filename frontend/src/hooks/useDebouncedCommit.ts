import { useEffect, useRef } from "react";
import type { Action } from "@shared/types";

// For ranges and colour pickers: only the last batch is sent, after `ms` of quiet.
export function useDebouncedCommit(commit: (actions: Action[]) => Promise<void> | void, ms = 300): (actions: Action[]) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => () => clearTimeout(timer.current), []);
  return (actions) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void latest.current(actions), ms);
  };
}
