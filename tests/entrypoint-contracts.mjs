import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const pooderRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const contracts = [
  {
    name: "Document imports in pure Node",
    source: `
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.HTMLCanvasElement;
      const documentModule = await import("./packages/document/dist/index.mjs");
      if (typeof documentModule.validateEditorDocument !== "function") {
        throw new Error("Document public contract is unavailable.");
      }
    `,
  },
  {
    name: "Vue root imports during SSR without editor side effects",
    source: `
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.HTMLCanvasElement;
      const vueRoot = await import("./packages/vue/dist/index.mjs");
      if (typeof vueRoot.createPooderRuntime !== "function") {
        throw new Error("Vue SSR runtime factory is unavailable.");
      }
      if ("PooderCanvasHost" in vueRoot || "registerPooderTools" in vueRoot) {
        throw new Error("Vue root entry leaked client editor exports.");
      }
      const runtime = vueRoot.createPooderRuntime();
      await runtime.dispose();
    `,
  },
  {
    name: "client Editor entry loads independently",
    source: `
      const documentStub = {
        createElement(tagName) {
          return tagName === "canvas"
            ? { getContext: () => null, style: {} }
            : { style: {} };
        },
        createElementNS(_namespace, tagName) {
          return this.createElement(tagName);
        },
      };
      globalThis.document = documentStub;
      globalThis.window = {
        document: documentStub,
        devicePixelRatio: 1,
        navigator: { userAgent: "pooder-contract-test" },
      };
      globalThis.HTMLCanvasElement = class HTMLCanvasElement {
        getContext() {
          return null;
        }
      };
      const editor = await import("./packages/vue/dist/editor.mjs");
      if (
        typeof editor.registerPooderTools !== "function" ||
        !editor.PooderCanvasHost
      ) {
        throw new Error("Client Editor public contract is incomplete.");
      }
    `,
  },
  {
    name: "base editor applies documents without Kit",
    source: `
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.HTMLCanvasElement;
      const vueRoot = await import("./packages/vue/dist/index.mjs");
      const runtime = vueRoot.createPooderRuntime();
      const documentService = vueRoot.installPooderDocument(runtime);
      const result = await documentService.apply({
        version: 8,
        assets: [],
        extension: { required: [], states: {} },
        surfaces: [
          {
            id: "front",
            geometry: {
              canvasBounds: { x: 0, y: 0, width: 100, height: 100 },
              productionBounds: { x: 0, y: 0, width: 100, height: 100 },
            },
            objects: [
              {
                type: "group",
                id: "artwork",
                tags: [],
                visible: true,
                locked: false,
                localToParent: [1, 0, 0, 1, 0, 0],
                children: [
                  {
                    type: "shape",
                    id: "shape",
                    tags: [],
                    visible: true,
                    locked: false,
                    localFrame: { x: 0, y: 0, width: 30, height: 40 },
                    localToParent: [1, 0, 0, 1, 10, 20],
                    localPivot: { x: 0, y: 0 },
                    source: {
                      kind: "inline",
                      content: {
                        shape: "rect",
                        params: { width: 30, height: 40 },
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      });
      if (!result.ok || documentService.export()?.surfaces.length !== 1) {
        throw new Error("Base editor failed without Kit.");
      }
      await runtime.dispose();
    `,
  },
];

for (const contract of contracts) {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", contract.source],
    {
      cwd: pooderRoot,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test" },
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`FAIL ${contract.name}`);
  }
  console.log(`PASS ${contract.name}`);
}

console.log("All entrypoint contracts passed.");
