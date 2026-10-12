---
sidebar_position: 3
---

# On-device AI

Where Chrome ships its built-in language model (**Gemma Nano**), Tabverse uses
it for two small jobs, entirely on this device:

- **Summarize a tab into a new note** - the page's visible text becomes a short,
  factual summary in a [note](../basic-usage/note) attached to the current
  tabverse.
- **Suggest a name** for the current tab collection, from its tabs' titles and
  hosts.

## Where to find it

**Settings ▸ AI** reports three things: whether this device can use the model at
all, whether it is switched on (*Use the on-device model*), and whether the
local model is installed. Chrome downloads the model once, on first use.

![Settings ▸ AI: the on-device model and its two features](../../static/img/user_manual_ondevice_ai.png)

The two features are a lightbulb in the manager:

![The two lightbulbs, and the AI history panel on the right](../../static/img/user_manual_ondevice_ai_features.png)

- **Name a tabverse** - the lightbulb next to the tabverse's name at the top of
  the tab list. It suggests three names to pick from.
- **Summarize a tab** - the lightbulb on the right of a live tab row. It turns
  that page into a new note in the Note tool.

Without Chrome's built-in model the two lightbulbs simply do not appear, and
**Settings ▸ AI** says why.

## AI history

The **AI history** panel (the chat icon on the right rail) is a local log of what
this extension asked the model: each entry shows the prompt and the answer,
newest first, with a **Clear** button. It is kept on this device and is never
synced.

## Privacy

Nothing leaves the browser: the text is handed to the model inside the page, and
no request is made to us or to anyone else. The model itself is Chrome's own and
is downloaded once by Chrome; it is not part of the extension.
