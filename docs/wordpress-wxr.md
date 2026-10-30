# Local WordPress WXR text import

In the builder, choose **بررسی خروجی WordPress WXR**, select a local WXR XML export (maximum 1 MiB and 200 items), choose a page or post, review the preview and warnings, and explicitly confirm replacement of the current page's nodes. The current title, slug and page theme are preserved. The result is an ordinary unsaved builder edit, subject to the existing autosave, undo and conflict workflow; it is never published automatically.

The importer reads WXR page/post titles, source IDs, slugs, status, excerpt and content for inspection. Content is converted to plain native Text nodes only. HTML formatting, hyperlinks, WordPress blocks, categories, metadata, excerpts and attachments are not persisted. Posts become builder page content, not blog posts. Images and remote assets are never downloaded. Unsupported records (e.g. attachments) are counted. The original export is not stored: keep a backup.

XML DTD and entity declarations are rejected and the parser is size-limited. It does not execute source HTML, JavaScript or PHP. This is not a complete WordPress migration, REST connection, WXR asset migration, or bulk import; preview uses the editor renderer and needs browser verification.
