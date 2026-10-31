import { MIN_FREE_BYTES, assertDiskRoom, freeBytesOf } from "./disk";

it("throws disk_low when any volume is under the floor, and checks every path", async () => {
  const asked: string[] = [];
  const free = async (p: string) => { asked.push(p); return p === "/scratch" ? MIN_FREE_BYTES - 1 : MIN_FREE_BYTES; };
  await expect(assertDiskRoom(free, ["/tmp", "/scratch"])).rejects.toThrow("disk_low");
  expect(asked).toEqual(["/tmp", "/scratch"]);
  await expect(assertDiskRoom(async () => MIN_FREE_BYTES, ["/tmp"])).resolves.toBeUndefined();
  expect(await freeBytesOf(process.cwd())).toBeGreaterThan(0);
});
