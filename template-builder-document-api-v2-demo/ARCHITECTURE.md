# Architecture

```mermaid
flowchart LR
  SuperDoc[SuperDoc UI + Document API] <--> Controller[FieldController]
  Controller -->|immutable field snapshots| App[Vue App]
  App --> Components[Field explorer components]
  Components -->|CRUD intent| App
  App -->|controller methods| Controller
```

`FieldController` is the single source of truth for native field instances. It
loads and normalizes fields, observes external content-control changes, performs
CRUD mutations, reconciles pending creations, and publishes snapshots.

Vue derives logical groups from each instance's `tag.group` value. UI-only state
such as the selected tab and highlight toggles remains in `App.vue`.
