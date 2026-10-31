import { UsageSchema, api } from "@shared/contract";
import { json } from "@/services/http";

export const getUsage = () => json<unknown>(api.usage).then(UsageSchema.parse);
export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const spendText = (monthCents: number, capCents: number) => `This month ${usd(monthCents)}${capCents ? ` of ${usd(capCents)}` : ""}`;
