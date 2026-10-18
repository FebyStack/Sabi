import { createApp } from "../app/app";
import { makeMemoryDeps } from "../shared/testing";

// Full API, zero infrastructure. First thing to reach for when debugging.
const port = Number(process.env.PORT ?? 3001);
createApp(makeMemoryDeps()).listen(port, () => console.log(`api (lite, in-memory) on http://localhost:${port}`));
