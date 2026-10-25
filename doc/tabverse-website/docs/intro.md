---
sidebar_position: 1
---

# Get Started

Tabverse is a Chrome extension that turns a window full of related tabs into a
named workspace you can put down and pick up again.

When you work on something, you usually open one Chrome window and a pile of
tabs in it - searches, results, documents, tools, all about the same thing.
That window and its tabs are a **Tabverse**. Tabverse gives the window a name,
remembers it, and hangs the small things that go with the work - notes, todos,
bookmarks, the tabs you closed - off it, so that when you are done (or just
need a break) you can close the window without losing the thread.

Everything is **local first**: on its own, Tabverse needs no account and no
network. Pairing with a server is optional and comes later.

## Install

Tabverse is a Chrome extension (Manifest V3, Chrome 140 or newer).

Install it from the
[Chrome Web Store](https://chromewebstore.google.com/detail/tabverse/lffblcippngalmglinedcbmikkncihdm).
That listing is the release build; Chrome keeps it updated for you.

### Without the store

You can also run a build by hand. [GitHub releases](https://github.com/liyu1981/tabverse/releases)
carry `tabverse.zip`:

1. Download `tabverse.zip` and **extract it to a folder, and keep that folder.**
   Chrome loads a folder, not a zip; extracting each new version into the *same*
   folder keeps the extension id - and so your settings - stable, while a new
   folder is a new extension.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked**, and pick the extracted folder.

Note that a hand-loaded build has its own extension id and so its own, empty,
profile: your data does not move between it and the store install. Export a
`.tabverse` file to carry it across.

The
[manual installation guide](https://www.cnet.com/tech/services-and-software/how-to-install-chrome-extensions-manually/)
walks the same steps through with screenshots.

### From source

To build the extension yourself - or work on it - see
[Install from source](./install-from-source): a clone, `pnpm install`, a build,
and load `dist/` unpacked.

## What it does

- **Tabverses** - one Chrome window is one workspace. Name it, save it, and
  restore it later with all its tabs. → [Tabverses](./basic-usage/tabverses)
- **Todo, Note, Bookmark, History and AI Chat tools** attached to the tabverse,
  each saved and restored with it. Pin one to the top, focus it, and the layout
  is remembered.
- **One search** across tabs, history, notes, todos and bookmarks.
- **On-device AI** that can chat about a page you attach, summarize a page into
  a note, or suggest a name for a tab collection, where Chrome ships its
  built-in model - and a page-to-Markdown viewer that needs no model at all.
- **Optional server sync**, so the same workspace is on every browser you use,
  with a server you run yourself.

## Your first Tabverse

After installing, click the Tabverse `T` icon in Chrome's toolbar to open the
popup:

![The Tabverse toolbar popup](../static/img/user_manual_chrome_popup.png)

- **New tabverse** makes the current window a tabverse (if it already has one,
  Tabverse asks first - the current one is already saved).
- **Import** reads a `.tabverse` file as a new saved tabverse.
- The search box and the **Recent** list reach every tabverse saved in this
  browser; a row badged *this window* is the one you are in.

The [Basic Usage](./basic-usage/tabverses) pages walk the manager interface
section by section.

## Optional: server sync

Tabverse works entirely in this browser. If you want the same tabverses on a
second browser or machine, you can pair it with a **`tabversed`** server that
you run yourself; the extension talks only to the address you enter.

- [Sync with a server](./advanced-usage/server-sync) - what syncs, how pairing
  works, and the privacy posture.
- [Self-host a server](./self-host-server) - run `tabversed` for yourself.

## Questions and feedback

Support and discussion happen at [r/tabverse](https://www.reddit.com/r/tabverse/)
on Reddit: ask a question, report a problem, or say what you would like Tabverse
to do. Code, releases and the source of this site are in the
[repository](https://github.com/liyu1981/tabverse), which also takes
[issues](https://github.com/liyu1981/tabverse/issues) and
[discussions](https://github.com/liyu1981/tabverse/discussions).
