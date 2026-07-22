# @pooder/kit

## 10.0.0

### Major Changes

- Reduced Kit to an optional factory-only aggregate with explicit Tool factory
  exports.
- Removed ownership of services, Document Controller APIs, and runtime adapters.
- Removed the deprecated `@pooder/kit/document` entry point; Tool schemas are
  composed through `@pooder/document` by the application.
