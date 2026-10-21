import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { configured } from "./analytics";
import { readConsent, writeConsent } from "./consent";

// First visit only: states the 30-day auto-delete and asks for analytics (decline = nothing is ever sent).
export function ConsentBanner() {
  const [open, setOpen] = useState(() => readConsent() === null);
  if (!open) return null;
  const choose = (analytics: boolean) => { writeConsent({ analytics, at: new Date().toISOString() }); setOpen(false); };
  const keys = configured();
  return (
    <div role="dialog" aria-label="Privacy"
      className="fixed inset-x-2 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-lg space-y-3 rounded-3 border border-line bg-surface-1 p-4 text-sm text-ink shadow-lg lg:bottom-4">
      <p>
        Sabi keeps your uploads, generated media and renders for 30 days after you last open a project, then deletes them.{" "}
        {keys ? "Allow anonymous usage analytics (which features you use, never your media)?" : "Analytics is off in this build."}
      </p>
      <div className="flex justify-end gap-2">
        {keys ? <><Button onClick={() => choose(false)}>Decline</Button><Button variant="primary" onClick={() => choose(true)}>Allow</Button></>
          : <Button variant="primary" onClick={() => choose(false)}>OK</Button>}
      </div>
    </div>
  );
}
