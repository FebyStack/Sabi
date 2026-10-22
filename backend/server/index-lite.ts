import { createApp } from "../app/app";
import { seedDemo } from "../modules/demo/seed";
import { startRetention } from "../modules/retention/sweep";
import { makeMemoryDeps } from "../shared/testing";
import { shutdownHandler } from "./boot";

// Full API, zero infrastructure (in-memory repos, files under DATA_DIR). First thing to reach for when debugging.
const port = Number(process.env.PORT ?? 3001);
const dataDir = process.env.DATA_DIR ?? "/Volumes/PortableSSD/Bong/captions-clone-data";
const deps = makeMemoryDeps(dataDir);
createApp(deps).listen(port, () => console.log(`api (lite, in-memory) on http://localhost:${port}, data in ${dataDir}`));
const demo = await seedDemo(deps).catch((err) => { console.error("demo seed failed", err); return null; }); // the in-memory repo starts empty: every boot gets the demo
if (demo) console.log(`seeded demo project ${demo.id}`);
startRetention(deps);
const warmStart = Date.now(); // bundle + browser now, so the first render or frame does not pay for them
deps.renderer.warm?.().then(() => console.log(`renderer warm in ${((Date.now() - warmStart) / 1000).toFixed(1)}s`), (err) => console.error("renderer warm-up failed", err));
const stop = shutdownHandler(deps.renderer);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
