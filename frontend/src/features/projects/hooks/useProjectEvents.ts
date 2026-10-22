import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useRef } from "react";
import { ProjectEventSchema, api } from "@shared/contract";
import type { JobState } from "@shared/types";
import { initialEventsState, reduceProjectEvents } from "./projectEvents";

export function useProjectEvents(id: string, onJobDone?: (job: JobState) => void) {
  const [state, dispatch] = useReducer(reduceProjectEvents, initialEventsState);
  const qc = useQueryClient();
  const done = useRef(onJobDone);
  done.current = onJobDone;

  useEffect(() => {
    const es = new EventSource(api.projectEvents(id));
    const onEvent = (ev: MessageEvent) => {
      const parsed = ProjectEventSchema.safeParse(JSON.parse(ev.data));
      if (!parsed.success) return;
      dispatch(parsed.data);
      if (parsed.data.type === "job" && parsed.data.job.state === "COMPLETE") done.current?.(parsed.data.job);
      if (parsed.data.type === "project" || parsed.data.job.state === "COMPLETE" || parsed.data.job.state === "FAILED")
        qc.invalidateQueries({ queryKey: ["project", id] });
      if (parsed.data.type === "job" && ["broll", "generate"].includes(parsed.data.job.kind) && ["COMPLETE", "FAILED"].includes(parsed.data.job.state))
        qc.invalidateQueries({ queryKey: ["usage"] }); // the job may have spent fal credits
    };
    es.addEventListener("job", onEvent);
    es.addEventListener("project", onEvent);
    return () => es.close();
  }, [id, qc]);

  return state;
}
