import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packagesRoot = join(root, "packages");
const packageDirectories = await readdir(packagesRoot, { withFileTypes: true });
const violations = [];
const baseEditorPackages = new Set([
  "core",
  "document",
  "document-core",
  "platform-browser",
  "vue",
]);

for (const entry of packageDirectories) {
  if (!entry.isDirectory()) continue;

  const packageRoot = join(packagesRoot, entry.name);
  const manifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  const runtimeDependencies = manifest.dependencies ?? {};

  if (baseEditorPackages.has(entry.name)) {
    if ("@pooder/kit" in runtimeDependencies) {
      violations.push(`${manifest.name}: base editor must not depend on Kit`);
    }
    const source = await readSourceTree(join(packageRoot, "src"));
    if (/from\s+["']@pooder\/kit(?:\/|["'])/.test(source)) {
      violations.push(
        `${manifest.name}: base editor source must not import Kit`,
      );
    }
  }

  if (!entry.name.startsWith("tool-")) continue;

  if (!("@pooder/core" in runtimeDependencies)) {
    violations.push(`${manifest.name}: must directly depend on @pooder/core`);
  }
  if ("@pooder/kit" in runtimeDependencies) {
    violations.push(`${manifest.name}: must not depend on @pooder/kit`);
  }

  for (const dependency of Object.keys(runtimeDependencies)) {
    if (/^@pooder\/tool-/.test(dependency)) {
      violations.push(
        `${manifest.name}: must declare cross-Tool dependencies through a capability contract, not ${dependency}`,
      );
    }
  }

  const source = await readSourceTree(join(packageRoot, "src"));
  if (/from\s+["']@pooder\/kit(?:\/|["'])/.test(source)) {
    violations.push(`${manifest.name}: source must not import @pooder/kit`);
  }
  if (/\btools\s*:/.test(source)) {
    violations.push(
      `${manifest.name}: Tool packages must not contribute toolbar tools`,
    );
  }
}

const kitSource = await readFile(
  join(packagesRoot, "kit/src/index.ts"),
  "utf8",
);
const kitManifest = JSON.parse(
  await readFile(join(packagesRoot, "kit/package.json"), "utf8"),
);
if (/export\s+\*\s+from/.test(kitSource)) {
  violations.push("@pooder/kit: must use explicit factory exports");
}
if (/document|validator|controller/i.test(kitSource)) {
  violations.push("@pooder/kit: must not own Document integration");
}
if (Object.keys(kitManifest.exports ?? {}).some((entry) => entry !== ".")) {
  violations.push("@pooder/kit: must expose only its factory aggregate entry");
}

for (const exportedName of kitSource.matchAll(/\b(create[A-Z]\w+)\b/g)) {
  if (!exportedName[1].endsWith("Capability")) {
    violations.push(
      `@pooder/kit: ${exportedName[1]} is not a Tool capability factory`,
    );
  }
}

if (violations.length > 0) {
  throw new Error(
    `Tool package boundary violations:\n- ${violations.join("\n- ")}`,
  );
}

console.log("Tool package boundaries passed.");

async function readSourceTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) contents.push(await readSourceTree(path));
    else if (/\.(?:ts|tsx|vue)$/.test(entry.name)) {
      contents.push(await readFile(path, "utf8"));
    }
  }
  return contents.join("\n");
}
