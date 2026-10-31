import { isolateTmpdir } from "../../../backend/shared/testDirs";

// Before the workers start, so each inherits TMPDIR: every temp dir a suite makes (even at collection time, even in a
// skipped file) lands in one folder that the run removes at the end.
export default () => isolateTmpdir();
