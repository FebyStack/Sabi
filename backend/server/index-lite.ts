import { createApp } from "../app/app";
import { seedDemo } from "../modules/demo/seed";
import { startRetention } from "../modules/retention/sweep";
import { makeMemoryDeps } from "../shared/testing";

// Full API, zero infrastructure (in-memory repos, files under DATA_DIR). First thing to reach for when debugging.
const port = Number(process.env.PORT ?? 3001);
const dataDir = process.env.DATA_DIR ?? "/Volumes/PortableSSD/Bong/captions-clone-data";
const deps = makeMemoryDeps(dataDir);
createApp(deps).listen(port, () => console.log(`api (lite, in-memory) on http://localhost:${port}, data in ${dataDir}`));
const demo = await seedDemo(deps).catch((err) => { console.error("demo seed failed", err); return null; }); // the in-memory repo starts empty: every boot gets the demo
if (demo) console.log(`seeded demo project ${demo.id}`);
startRetention(deps);
