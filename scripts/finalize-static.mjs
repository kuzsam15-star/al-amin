import { rm } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const artifactRoot = path.resolve(projectRoot, "out");

if (path.dirname(artifactRoot) !== projectRoot || path.basename(artifactRoot) !== "out") {
  throw new Error("Refusing to finalize an unexpected artifact directory.");
}

// Next.js currently requires one generated parameter for an exported dynamic
// segment. The placeholder lets the framework compile an empty catalog, then
// is removed so it never becomes a public URL in the portable artifact.
await rm(path.join(artifactRoot, "specialists", "__empty__"), { recursive: true, force: true });

// Empty public directories have no runtime meaning and should not be carried
// into the hand-off artifact.
await rm(path.join(artifactRoot, "design-preview"), { recursive: true, force: true });

console.log("Static artifact finalized without technical placeholder routes.");
