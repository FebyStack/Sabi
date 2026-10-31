import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { getUsage, spendText } from "./api";

// Projects header: this month's fal spend against the cap; opens the usage list.
export function UsageChip() {
  const usage = useQuery({ queryKey: ["usage"], queryFn: getUsage });
  if (!usage.data) return null;
  return <Link to="/usage" className="grid min-h-11 place-items-center text-xs tabular-nums text-ink-muted underline-offset-2 hover:underline">{spendText(usage.data.monthCents, usage.data.capCents)}</Link>;
}
