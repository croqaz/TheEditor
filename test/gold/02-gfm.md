---
title: GitHub Flavored Markdown kitchen sink
flavour: gfm
---

# GFM additions

## Tables

| Left                | Center |    Right | Default                     |
| :------------------ | :----: | -------: | --------------------------- |
| a                   |   b    |        c | d                           |
| longer cell content | `code` | **bold** | [link](https://example.com) |
| escaped \| pipe     |   x    |        y | z                           |

Minimal table:

| Name | Value |
| ---- | ----- |
| one  | 1     |
| two  | 2     |

## Task lists

- [ ] Open task
- [x] Done task
- [x] Also done
  - [ ] Nested open task
- Regular item in the same list

1. [ ] Ordered task
2. [x] Ordered done

## Strikethrough

This is ~~struck through~~ and this is ~~also struck~~ with a single tilde.

## Autolinks (extended)

Plain URL: https://example.com/path?query=1&b=2#frag and www.example.com and an
email someone@example.org become links.

## Footnotes

Here is a footnote reference[^1] and another[^long].

[^1]: The first footnote.

[^long]: A longer footnote.

    With an indented second paragraph.

## Disallowed raw HTML (GFM filter)

<title>should be escaped by the tagfilter</title> while <b>bold</b> stays.

## Mixed

| Task                    | Status   |
| ----------------------- | -------- |
| Write ~~draft~~ final   | [x] done |
| Footnote[^1] in a table | pending  |
