---
sidebar_position: 3
---

# On-device AI

Where Chrome ships its built-in language model (**Gemma Nano**), Tabverse uses
it for two small jobs, entirely on this device:

- **Summarize this tab into a new note** - the page's visible text becomes a
  short, factual summary in a [note](../basic-usage/note) attached to the
  current tabverse.
- **Suggest a name** for the current tab collection, from its tabs' titles and
  hosts.

Nothing leaves the browser: the text is handed to the model inside the page, and
no request is made to us or to anyone else. The model itself is Chrome's own and
is downloaded once by Chrome when the feature is first used; it is not part of
the extension.

Without Chrome's built-in model the two buttons simply do not appear. There is
also a switch in the AI settings to turn the features off even where the model
is available.
