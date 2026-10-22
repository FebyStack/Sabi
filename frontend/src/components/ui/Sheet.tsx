import { useEffect, useId, useRef, type ReactNode } from "react";

// Native <dialog>: focus trap and Escape for free. Bottom sheet on phones, centred card from md up.
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={id} onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}
      className="sheet m-0 mt-auto w-full max-w-none rounded-t-4 bg-surface-1 p-4 text-ink backdrop:bg-black/60 md:m-auto md:max-w-md md:rounded-4">
      <h2 id={id} className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </dialog>
  );
}
