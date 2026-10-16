# Commands

TheEditor! has no menus and no buttons. Every action is a command. Each command is
reachable three ways:

- **F12 console**: `te.<id>(...)`, for example `te.theme("nord-light")`, `te.lines.sort()`.
  `te.help()` lists everything; `te.help("text")` lists one namespace.
- **Key combo**: listed next to each command below.
- **Status-bar prompt**: Ctrl+` (the backquote key, one hand) turns the bottom bar into a prompt behind a `❯`. Type the id and
  space-separated arguments: `theme nord-light`, `tabs.go 2`, `status.fields ["words","net"]`.
  `Tab` completes, `Up`/`Down` walks history, `Esc` closes.

The source of truth is `src/view/commands/builtin.ts`.

| Command | Keys | What it does |
|---|---|---|
| `help(ns?)` | | list commands |
| `file.new()` | Ctrl+N | new untitled document |
| `file.open(...paths?)` | Ctrl+O | open files; no argument shows the system file dialog (Markdown and text files, starting in the active document's folder) |
| `file.save(force?)` | Ctrl+S | save; `true` overwrites a file that changed on disk |
| `file.saveAs(path?)` | Ctrl+Shift+S | save under a new path; asks for a folder when omitted |
| `file.saveAll()` | | save every dirty document that has a path |
| `file.reload()` | | reload from disk, discarding local changes |
| `file.close(discard?)` | Ctrl+W | close the tab; `true` discards unsaved text |
| `file.reveal()` | | show the file in the file manager |
| `file.path()` | | print the active path |
| `goto(line, col?)` | Ctrl+G | move the caret to a line and column as counted in the status bar (list items and hard breaks are lines); the key opens the prompt with `goto ` typed |
| `goto.start()` | Ctrl+Home | caret to the start of the text; pressed again there, to the start of the front-matter |
| `goto.end()` | Ctrl+End | caret to the absolute end of the text |
| `edit.selectAll()` | (Ctrl+A natively) | select the whole document, for scripted runs |
| `task.toggle()` | Ctrl+Enter in the editor, or a click on the marker | list item at the caret: plain → `[ ]` → `[x]` → `[ ]` |
| `task.clear()` | | task item at the caret back to a plain list item |
| `tabs.next()` / `tabs.prev()` | Ctrl+Tab / Ctrl+Shift+Tab | cycle tabs |
| `tabs.go(n)` | Ctrl+1 … Ctrl+9 | activate tab n |
| `tabs.moveLeft()` / `tabs.moveRight()` | Alt+Left / Alt+Right | reorder |
| `tabs.list()` | | table of open tabs |
| `text.lowercase()` / `uppercase()` / `titleCase()` / `sentenceCase()` | | transform the selection (or the word at the caret) |
| `lines.sort(desc?)` / `lines.sortDesc()` | | sort selected blocks (or the lines of one paragraph) |
| `lines.unique()` / `lines.reverse()` / `lines.shuffle()` | | more block operations |
| `theme(name?)` | | set or print the theme (`gruvbox-dark`, `gruvbox-light`, `nord-dark`, `nord-light`) |
| `theme.list()` / `theme.next()` | Ctrl+Shift+T | list / cycle themes |
| `font(family?, size?, leading?)` | | set or print font settings; any installed monospace font works |
| `caret(style?)` | | `block` (default: one hollow character cell, filled with the glyph inverted while overwriting) or `bar` (WebKit's 1 px caret); no argument prints it |
| `overwrite(on?)` | Insert | overwrite mode: typing replaces the character under the caret; no argument toggles |
| `font.measure(ch)` | | text width in characters (default 80, 40 to 140; the column adds 1ch of padding on each side) |
| `autosave(on?)` | | turn autosave on or off; no argument prints the state |
| `stats()` | | statistics table for the active document |
| `stats.wpm(n)` | | words per minute for time-to-read |
| `status.fields([...])` | | choose status cells, in order: `chars words lines paragraphs sentences readtime speaktime headings bytes cursor lang autosave net` (anything else is shown as typed). A middle dot separates the kinds: counts · caret position · state. A saved `words, chars` pair is read as `chars, words` |
| `measure({ label? })` | | DOM coordinates of every block and its line boxes (CSS px, pane- and document-relative); with a label, writes `measure.json` |
| `shot.screen({ label?, caret? })` | | picture of the visible window cropped to the editor pane (Spectacle on KDE, Electrobun screen capture elsewhere); the block caret is left out unless `caret: true` |
| `shot.page({ label?, width?, backend? })` | | the whole document rendered by WebKitGTK through `scripts/te-snap.py`, independent of the window |
| `shot.sections({ level?, height?, label? })` | | one picture per section, each H1 (or `level`) starting a page; `height` makes fixed pages |
| `shot.element(n, { label?, margin? })` | | one block cropped from the document render |
| `shot.verify({ label?, index?, tolerance? })` | | screen vs render: crops every visible block from both pictures and pixel-diffs them; writes `verify.json` |
| `shot.crop(path, x, y, w, h, out?)` / `shot.diff(a, b, out?)` | | work on existing pictures |
| `view.devtools()` | F12 | toggle the WebKit inspector |
| `view.prompt()` | Ctrl+` | open the status-bar prompt |
| `view.zen()` | Ctrl+Shift+Z | hide or show both bars |
| `view.fullscreen()` | F11 | toggle fullscreen |
| `debug.focus()` | | where keyboard focus is: `page` (WebKit widget focus; keys only work when true), `editor`, `activeElement` |
| `debug.blocks()` | | per top-level block: position, height, on screen, whether its text has layout boxes |
| `app.wait(ms)` | | pause, for scripted `--run` sequences |
| `debug.boxes(on?)` | | overlay the block and line boxes `te.measure()` reports on the active document; `{ blocks, lines, labels, from }` picks what to draw or loads a saved `measure.json` |
| `app.info()` / `app.config()` / `app.profile()` | | runtime info / current config / active profile directories |
| `app.quit()` | Ctrl+Q | save session and quit |

## Files on disk

Paths are for the default profile; named profiles add `/profiles/<name>`, path profiles put
everything under the given directory (see README, "Profiles").

| Path | Content |
|---|---|
| `~/.config/TheEditor/config.json` | theme, caret style, font, autosave, status fields, network, spell language |
| `~/.config/TheEditor/session.json` | open tabs, active tab, window size, prompt history, recent files |
| `~/.local/share/TheEditor/recovery/` | copy of a document written just before each save, removed on success |

## Pictures

Everything `te.shot.*` and `te.measure()` produce goes to `<profile cache>/shots/<yyyymmdd-hhmmss>-<label>/`
(`~/.cache/TheEditor/shots/…` for the default profile). The directory holds the raw and cropped screen
shot, the rendered page (`page.png` with its `page.html` and `page.metrics.json`), per-block crops and
diffs, `measure.json`, and `verify.json`.

`measure.json` lists for each block: `type`, `text`, `viewport` (CSS px from the pane's top-left),
`document` (CSS px from the document's top-left), `lines` (line boxes), `visible`; plus `dpr`, the pane
size and scroll offset, and the computed font. Multiply by `dpr` to get pixel coordinates in the pictures.

Every block is always laid out (the page uses no `content-visibility`), so document coordinates are
exact even for blocks that were never scrolled into view, and the render matches.
`shot.screen` and `shot.verify` first move the pane's scroll offset to the nearest whole
device pixel (multiples of 4 CSS px at ratio 1.75) and report it as `aligned: { before, after, step }`;
otherwise the compositor's snapping shifts every crop by a pixel.

`te.debug.boxes()` draws the same rects on the live document: a 1 px line inside every block rect
(theme `debug` colour) and every line box (`accent` colour), with a label `#index type width×height
·lines lead` in the right margin, or in the gap above the block when the column fills the pane. The
overlay follows edits, scrolling and resizes, is part of `te.shot.screen()` and `te.shot.page()`
pictures (not of section pictures), and `te.debug.boxes({ from: ".../measure.json" })` overlays a
saved measurement instead of the live one, to compare two layouts. `te.debug.boxes()` again turns it off.

Rendering needs `python3` with PyGObject (`gi`, WebKit2 4.1) and Pillow; the screen shot needs
`spectacle` (KDE) or a Wayland portal approval for Electrobun's capture. `TE_SHOT_BACKEND` chooses
`spectacle`, `electrobun` or `none`; `TE_SNAP_TOOL` and `TE_PYTHON` override the tool and interpreter.
`TE_SMOKE_SHOTS=1 TE_OPEN=<file> hutch run start` runs `te.shot.verify()` and quits (needs a visible window).

Any command sequence can be scripted the same way: `TE_RUN='[["debug.boxes", true], ["goto", 12, 3],
["shot.screen", {"label": "boxes", "caret": true}]]'` (or `--run <json>`) runs each `[id, ...args]`
through `te.*` once the view is ready, prints one `RUN <id> <json>` line per command and `RUN_DONE`,
then quits unless `TE_KEEP=1` / `--keep` is set. Scripted runs use the `test` profile unless one is named.

## Offline

The app starts offline: the page's Content Security Policy allows only the bundle itself and
loopback. Start with `--online` (or `THEEDITOR_ONLINE=1`) to allow remote images and CSS. The
status bar's last cell shows `OFFLINE` or `ONLINE`.
