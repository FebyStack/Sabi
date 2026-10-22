import type { ReactNode } from "react";
import { Button } from "./Button";

const TONE = { info: "border-line text-ink", warn: "border-warn text-warn", error: "border-danger text-danger" } as const;

export function Notice({ tone, children, action }: { tone: keyof typeof TONE; children: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-3 rounded-2 border bg-surface-1 px-3 py-2 text-sm ${TONE[tone]}`}>
      <div className="flex-1">{children}</div>
      {action && <Button size="sm" onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
