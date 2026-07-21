# Tool Package Contract

Status: normative
Date: 2026-07-21

This document defines the package boundary for reusable Pooder tools. A Tool is
an independently installable runtime capability, not an application toolbar
item and not a member of Kit by ownership.

## Required Public Surface

Every Tool package owns and exports:

- its capability id;
- every command id implemented by the package;
- its typed capability facade;
- a factory that creates its extension definition;
- option types for caller-owned layer, session, and configuration namespace
  identifiers;
- its own tests and, when it persists document data, its own Document effect
  schema contribution.

Capability and command ids are part of the Tool package API. New ids must use a
Tool-owned namespace. The `pooder.kit.*` namespace is a compatibility surface
and must not be used for new ids.

## Dependency Direction

A Tool package:

- directly depends on `@pooder/core`;
- never depends on `@pooder/kit`;
- depends on `@pooder/document` only when it owns persisted document schema or
  document value types;
- never imports another Tool implementation or lists another Tool package as a
  runtime dependency;
- declares cross-Tool requirements through
  `CapabilityDefinition.dependencies.capabilities` and resolves the required
  facade from Core at runtime.

Pure algorithms may live in neutral packages with no Tool lifecycle. Shared
types needed for optional collaboration may live in a contract-only package.
Neither is allowed to register the collaborating Tool or call its concrete
factory.

## Caller-Owned Identity

Any identity that crosses the application boundary is supplied by the caller.
Tool factory options must accept the identifiers they use, including where
applicable:

```ts
interface ToolInstallationOptions {
  capabilityId?: string;
  commandNamespace?: string;
  configNamespace?: string;
  sessionId?: string;
  layers?: Record<string, string | readonly string[]>;
}
```

A Tool may provide package-local defaults for standalone use. It must not use a
Storefront tool id, toolbar id, label, icon, ordering rule, or workflow name as
an architectural default.

## Contributions

A Tool package may contribute capabilities, commands, services,
configuration definitions, render producers, and Document effect schemas that
belong to that Tool.

A Tool package must not contribute Storefront toolbar metadata or application
workflow orchestration. In particular it must not contribute product `tools`,
activity-bar labels/icons, Storefront visibility rules, or application-owned
session policy.

## Document Integration

Document owns generic normalization, validation, capability requirement
collection, and the Document Controller. A Tool that persists an effect exports
only its schema and effect-to-capability mapping. The application composes Tool
schemas when it validates a document and registers Tool factories when it
installs required capabilities.

No aggregate package may own a validator or Document Controller on behalf of
all Tools.

## Kit Contract

`@pooder/kit` is an optional convenience aggregate. It:

- explicitly re-exports Tool factories and nothing else;
- does not own capability ids, command ids, facade types, or Storefront
  constants;
- does not expose a Document validator, schema registry, Document Controller,
  or runtime adapter;
- must not be required to create the base editor runtime.

Removing Kit changes only convenience imports. Directly installed Tool
packages and the base editor continue to work.

## Compatibility Aggregate

`@pooder/tools` is currently a migration aggregate around implementations that
predate this contract. It is not the target package boundary. New Tools must be
created as individual packages; existing implementations move out one at a
time. Compatibility exports may remain for a major-version migration window,
but Kit must not re-export that aggregate wholesale.

## Acceptance Checklist

A Tool package is conformant only when all of the following are true:

- it builds and its tests run when selected alone;
- a host can install and register only that Tool;
- removing it leaves Core and unrelated Tools buildable;
- its package manifest has a direct Core dependency and no Kit or concrete
  Tool dependency;
- its public entry owns its ids, facade, options, schema (if any), and factory;
- cross-Tool requirements are visible in capability dependency metadata;
- no Storefront toolbar metadata exists in the package;
- Kit contains only explicit factory exports and can be omitted from base
  editor startup.
