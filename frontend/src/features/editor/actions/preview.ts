import { applyLocal } from "@shared/editing/applyLocal";
import type { Project } from "@shared/types";
import type { DragPreview } from "../store/editorStore";

// The project as the Player and the timeline show it mid-drag: the drag's actions folded locally, never sent.
export function previewOf(project: Project, drag: DragPreview | null): Project {
  if (!drag) return project;
  const out = applyLocal(project, drag.actions);
  return "error" in out ? project : out.project;
}
