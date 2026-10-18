import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";
import { ProjectEventSchema, api } from "@shared/contract";
import { initialEventsState, reduceProjectEvents } from "./projectEvents";

export function useProjectEvents(id: string) {
  const [state, dispatch] = useReducer(reduceProjectEvents, initialEventsState);
  const qc = useQueryClient();

  useEffect(() => {
    const es = new EventSource(api.projectEvents(id));
    const onEvent = (ev: MessageEvent) => {
      const parsed = ProjectEventSchema.safeParse(JSON.parse(ev.data));
      if (!parsed.success) return;
      dispatch(parsed.data);
      if (parsed.data.type === "project" || parsed.data.job.state === "COMPLETE" || parsed.data.job.state === "FAILED")
        qc.invalidateQueries({ queryKey: ["project", id] });
    };
    es.addEventListener("job", onEvent);
    es.addEventListener("project", onEvent);
    return () => es.close();
  }, [id, qc]);

  return state;
}
