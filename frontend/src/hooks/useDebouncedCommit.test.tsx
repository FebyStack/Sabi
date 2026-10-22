import { renderToStaticMarkup } from "react-dom/server";
import type { Action } from "@shared/types";
import { useDebouncedCommit } from "./useDebouncedCommit";

describe("useDebouncedCommit", () => {
  it("sends only the last batch after the quiet period", () => {
    vi.useFakeTimers();
    const commit = vi.fn(async (_: Action[]) => {});
    let send!: (a: Action[]) => void;
    const Probe = () => { send = useDebouncedCommit(commit, 300); return null; };
    renderToStaticMarkup(<Probe />);
    send([{ type: "setTitle", title: "a" }]);
    vi.advanceTimersByTime(200);
    send([{ type: "setTitle", title: "b" }]);
    vi.advanceTimersByTime(299);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([{ type: "setTitle", title: "b" }]);
    vi.useRealTimers();
  });
});
