# Copied section library

The existing template library can search starter and saved templates, preview their current document, and insert a copy alongside the current selection. A selected container receives the copy as its last children; a selected leaf receives it after itself; with no selection it is appended at the root. Existing template replacement still asks for confirmation when the page has content.

A selected node can be saved through the existing template endpoint. It is a snapshot, not a linked or global section. Insertion regenerates all node IDs, preserves responsive style values and media references, validates the resulting canonical page, and does not change the target page theme. A fragment may therefore look different when its source and target page themes differ. The normal edit history and autosave apply; no publication occurs. Invalid nesting, stale selection, node limits and ID collisions fail without changing the page.

Previews use the editor's approximate React preview rather than the published Astro renderer. Saved templates retain the existing schema and are not versioned packages. This is not a marketplace, site kit installer, asset migration system, or globally synchronized component system.
