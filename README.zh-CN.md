# Pooder

[English](./README.md) | 简体中文

文档驱动的画布编辑引擎。应用提交一份严格的 `EditorDocument`（v8），Pooder 负责校验、编译成渲染意图、在浏览器里投影到画布，并通过 **Capability** 提供可复用的编辑能力。产品工具栏、文案、工作流编排属于应用，不属于引擎。

当前作为 Popecho 的 git submodule 使用（`external/pooder`），包通过根 workspace 的 `external/pooder/packages/*` 接入。也可以在本目录独立安装、构建。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| **EditorDocument** | 唯一公开的持久化模型。`version` 必须是 `8`。不含别名、迁移层或 v7 运行时。 |
| **Surface** | 文档侧的一面（如正面）。`bounds` 以毫米表示场景世界。 |
| **Scene** | 运行时图。`document-core` 把 `EditorSurface.id` 映射为 `sceneId`；Core / 渲染 / 导出只认 `sceneId`。 |
| **Capability** | 可安装的可复用行为（工厂 + 类型化 facade + 可选文档 schema）。不是工具栏按钮。 |
| **Session** | 由对象 `behaviors` 派生的瞬时工作流状态。不写入 `EditorDocument`。 |

数据流：

```text
EditorDocument  ──apply──►  document-core  ──RenderIntent──►  platform-browser (Fabric)
     ▲                         │                                      │
     │                         │ Scene / Geometry / Interaction       │
     └──── mutate / session ◄──┘                                      ▼
                                                                   <canvas>
```

## 包结构

| 包 | 职责 |
| --- | --- |
| `@pooder/document` | 运行时无关的 v8 契约：解析、校验、遍历。可在 Node / BFF 使用，禁止依赖 DOM、Canvas、Fabric。 |
| `@pooder/core` | 无头运行时：扩展生命周期、服务、场景、坐标、命令、Session、RenderIntent。 |
| `@pooder/document-core` | 把文档接到运行时：`EditorDocumentService`、编译、surface ↔ scene。 |
| `@pooder/platform-browser` | 浏览器宿主：Fabric 适配、画布、视口、导出、图片资源。 |
| `@pooder/geometry-paper` | 按需加载的 Paper.js 几何后端。导入模块本身不碰 DOM。 |
| `@pooder/vue` | Vue 3 宿主。**根入口可 SSR**；画布与工具注册在 `@pooder/vue/editor`。 |
| `@pooder/tools` | 现有能力的迁移聚合包（image-slot、mirror、edge-detection、image-mask、export）。 |
| `@pooder/production-mask` | 独立 Tool 包：文档驱动的生产掩膜（白墨等）。 |
| `@pooder/image-mask-contract` | 跨 Tool 协作的中立契约。实现互不直接依赖。 |
| `@pooder/kit` | 可选便利入口，**只再导出 Tool 工厂**。新应用应直接依赖具体 Tool 包。 |
| `@pooder/integration-tests` | 跨包集成测试（私有，不发布）。 |

依赖方向（生产代码）：

```text
应用
├── @pooder/document
├── @pooder/vue
├── @pooder/tools            （或独立 Tool 包）
└── @pooder/production-mask

@pooder/vue
├── @pooder/core
├── @pooder/document-core
└── @pooder/platform-browser ── @pooder/geometry-paper

@pooder/document-core ── @pooder/core + @pooder/document
@pooder/tools         ── @pooder/core + @pooder/document + 中立契约
@pooder/kit           ── @pooder/tools
```

Tool 包不得依赖 `@pooder/kit`，也不得依赖另一个 Tool 的实现。跨能力协作只通过契约包和运行时 facade。

## 快速开始（Vue）

需要 Vue 3。根入口 `@pooder/vue` 不导出画布组件，避免 SSR 拉入浏览器副作用。

```ts
import {
  createPooderRuntime,
  installPooderDocument,
  PooderRuntimeProvider,
} from "@pooder/vue";
import {
  PooderCanvasHost,
  flushPooderTools,
  registerPooderTools,
} from "@pooder/vue/editor";
import {
  createCapabilitiesForDocument,
  createExportCapability,
} from "@pooder/tools";
import type { EditorDocument } from "@pooder/document";

const document: EditorDocument = {
  version: 8,
  assets: [],
  extension: { required: [], states: {} },
  surfaces: [
    {
      id: "front",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      objects: [
        {
          type: "shape",
          id: "panel",
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
};

const runtime = createPooderRuntime();
const documentService = installPooderDocument(runtime);

registerPooderTools(runtime, [
  createExportCapability(),
  ...createCapabilitiesForDocument(document),
]);

await flushPooderTools(runtime);
const result = await documentService.apply(document);
if (!result.ok) throw new Error(result.diagnostics[0]?.message ?? "apply failed");
```

```vue
<template>
  <PooderRuntimeProvider :runtime="runtime">
    <PooderCanvasHost />
  </PooderRuntimeProvider>
</template>
```

`PooderCanvasHost` 会注册 Paper 几何后端并挂上浏览器服务（Canvas、导出、图片资源）。之后用 `documentService.mutate()` / `openSession()` 改文档，用 `runtime.activateSurface(id)` 切面。

无 Vue 时：直接 `new Pooder()`（`@pooder/core`），再 `registerEditorDocumentService`（`@pooder/document-core`）和 `attachBrowserHost`（`@pooder/platform-browser`）。

BFF / Node 只处理文档时，只依赖 `@pooder/document`：

```ts
import { parseEditorDocument, validateEditorDocument } from "@pooder/document";

const document = parseEditorDocument(payload);
const diagnostics = validateEditorDocument(document);
```

## EditorDocument v8

公开模型只有这一份。字段是精确集合：`version`、`assets`、`extension`、`surfaces`。

```ts
interface EditorDocument {
  version: 8;
  assets: EditorAsset[];
  extension: {
    required: string[]; // BFF 声明的 capability / extension id，不从对象推断
    states: Record<string, JsonValue>;
  };
  surfaces: EditorSurface[];
}
```

对象树要点：

- 每个 surface 一棵 `objects` 树。绘制顺序 = 数组顺序 + 深度优先，下标 `0` 在最底。
- `group` 只提供局部坐标、选择和联动；没有 `localFrame`、opacity、effects，也不是渲染层。
- 叶子只有 `image` / `path` / `shape`。没有文档级 text 对象。
- 每个节点有 `localToParent`。叶子另有 `localFrame`（内容被放入的矩形，毫米）。
- 工具激活来自 `behaviors`；`interaction` 只描述选择、拖拽和约束。
- 裁切另一对象用 `core.geometry.clip` 效果，不是 `contentFit`。

`EditorDocumentService.activateSurface(surfaceId)` 是文档侧切面 API，内部调用 `SceneService.setActiveRoot(sceneId)`。

更完整的对象树约定见 [docs/editor-document-v8-groups.md](./docs/editor-document-v8-groups.md)。

## Capabilities

应用按文档的 `extension.required` 和对象 behaviors 安装能力。`createCapabilitiesForDocument()` 会根据文档收集 `@pooder/tools` 里已有的能力。

| Capability | 包 | 默认 id |
| --- | --- | --- |
| Image slot | `@pooder/tools` | `pooder.kit.image-slot` |
| Mirror | `@pooder/tools` | `pooder.kit.mirror` |
| Edge detection | `@pooder/tools` | `pooder.kit.edge-detection` |
| Image mask | `@pooder/tools` | `pooder.kit.image-mask` |
| Export | `@pooder/tools` | `pooder.export` |
| Production mask | `@pooder/production-mask` | `pooder.production-mask` |

`pooder.kit.*` 是兼容命名空间，**新 id 不要再用**。新 Tool 应做成独立包（参考 `@pooder/production-mask`），不要往 `@pooder/tools` 里继续堆实现。

解析 facade：

```ts
import { requirePooderCapability } from "@pooder/vue/editor";
import {
  EXPORT_CAPABILITY_ID,
  type ExportCapabilityApi,
} from "@pooder/tools";

const exporter = requirePooderCapability<ExportCapabilityApi>(
  runtime,
  EXPORT_CAPABILITY_ID,
);
await exporter.exportImage({ sceneId: "front", purpose: "design" });
```

刀版（cutline）和 Feature 没有独立 capability：它们是带 `core.guide` / 几何效果的普通文档对象，工作流由应用用 `openSession()` 编排。见 [docs/app-workflow-composition.md](./docs/app-workflow-composition.md)。

## 坐标与几何

跨包边界的几何值必须带空间标签，只有四种空间：`object-local`、`parent-local`、`scene`、`screen`。渲染节点的位置只认 `AffinePlacement.localToScene`，不要把 `localFrame` 的 `x/y` 当成场景位移。

详见 [docs/coordinate-spaces.md](./docs/coordinate-spaces.md) 和 [docs/geometry-sources.md](./docs/geometry-sources.md)。

## 开发

需要 pnpm 10。在本目录：

```bash
pnpm install
pnpm build                          # 构建 packages/*
pnpm --filter @pooder/core test:foundation
pnpm --filter @pooder/document-core test
pnpm --filter @pooder/platform-browser test:foundation
pnpm --filter @pooder/integration-tests test
pnpm test:import-safety             # 无 window / 无 canvas context 的 import 契约
pnpm test:package-boundaries        # Tool 包边界
```

在 Popecho 根目录，改完 pooder 或定制流水线后跑：

```bash
pnpm build:pooder
pnpm test:contracts                 # 构建 + 基础/仿射/document-core/platform/集成/入口契约
pnpm check:architecture             # 含 docs/dependency-boundaries.md
```

发布使用 [changesets](./.changeset/README.md)：`pnpm changeset` → `pnpm version-packages` → `pnpm release`。

## 深入文档

| 文档 | 内容 |
| --- | --- |
| [docs/naming-and-contribution-policy.md](./docs/naming-and-contribution-policy.md) | 命名、所有权、公开 API 边界 |
| [docs/capability-authoring.md](./docs/capability-authoring.md) | 如何编写 Capability |
| [docs/tool-package-contract.md](./docs/tool-package-contract.md) | 独立 Tool 包必须满足的契约 |
| [docs/document-object-interaction.md](./docs/document-object-interaction.md) | `interaction` vs `behaviors` |
| [docs/app-workflow-composition.md](./docs/app-workflow-composition.md) | 应用如何组合刀版 / Feature / 导出 |
| [docs/editor-document-v8-groups.md](./docs/editor-document-v8-groups.md) | v8 对象树、继承、flatten 保证 |

## 所有权约定

- **Core** 拥有运行时中立的服务与契约，不泄漏 Fabric / DOM 类型。
- **Platform** 实现浏览器适配，公开 API 仍返回 Core 契约。
- **Tool** 拥有自己的 capability / command id、facade、工厂、测试和持久化 schema。
- **应用** 拥有产品 tool id、标签、图标、排序、可见性和工作流。

扩展可以贡献 capability、服务、命令、文档 schema 和可复用渲染行为，**不能**贡献产品工具栏项。
