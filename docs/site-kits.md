# Bundled site kits

The template dialog offers one versioned Persian business starter containing three draft pages: home, services, and contact. Preview each page and choose a unique ASCII slug prefix before confirming installation. It uses existing native component types and no package assets. The sample content, pricing and links must be reviewed and replaced before publication.

The server validates the bundled kit, component declarations and documents. It rejects kits whose asset dependencies cannot be resolved and refuses to overwrite any existing page. All pages are checked and written in one queued file-store write; the implementation does not claim cross-process locking. Installation creates drafts and does not publish. This is a single-site installation and does not create a new tenant. Shared header/footer ownership, package uploads, update merging and package provenance are not implemented.
