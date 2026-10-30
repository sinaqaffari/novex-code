# Bundled builder preset extension

The existing plugin API v1 supports `builder.presets`, a filter protected by the `builder:presets` capability. A trusted, repository-bundled plugin can append `{ id, label, description, document }` to the array. The host validates the entire result against the canonical page schema before passing it to the editor. IDs must be unique, lowercase slugs and the list is capped at 50. Plugins are activated through the existing CMS plugin manager; reload the editor after changing activation state.

`plugins/announcement-preset` is an example. It contributes a native Container and Text preset. The normal inspector edits the inserted Text, and ordinary Astro rendering renders it. Insertion copies native nodes into the page; disabling the plugin removes the insertion option but cannot remove those nodes or require plugin code to render them. This is a component preset, not a new serialized component type or an independently registered inspector control.

Plugin code is bundled trusted Node code, not a sandbox. Do not accept or execute downloaded JavaScript with this API. The existing manifest capability checks, CMS authorization and lifecycle apply. This does not provide a marketplace, package upload, third-party isolation, or dynamic plugin component registration.

## Parameterized compositions

An optional `parameters` array (maximum 12) declares text inputs bound to specific properties on nodes in the validated document. Each entry has `key`, `label`, `nodeId`, `property`, `defaultValue`, and `maxLength`. The host only permits Heading/Text `text`, Button `label`/`href`, and Image `alt`/`caption`; it checks that the target exists, bounds and targets are unique, and defaults and entered values pass the canonical property validator. Unsafe links are rejected. Unknown declaration fields are rejected. The bundled announcement example asks for its message before insertion.

The editor presents these fields, then materializes a validated native fragment and inserts fresh IDs through the normal history/autosave path. Once inserted, fields are edited via the native Inspector, not a persistent plugin-specific Inspector. This is not a custom serialized component runtime: no plugin identity or parameters remain linked to inserted nodes, and updating a plugin does not update existing copies. Plugin filters themselves still run as trusted bundled Node code; the declarative payload is not a sandbox for that code.

The host accepts at most the first 50 contributions and rejects malformed or duplicate declarations individually, logging the count rather than hiding valid peers. Duplicate IDs are first-wins; authors should namespace IDs to avoid collisions. A filter returning a non-array cannot be recovered. Trusted plugin callbacks may still have side effects and are not isolated from the process.
