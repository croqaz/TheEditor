---
title: Markdown Extended kitchen sink
flavour: extended
keywords: [extra, multimarkdown, pandoc]
---

# Markdown Extended

Constructs from the Markdown Extra, MultiMarkdown and Pandoc families. Milkdown
parses the CommonMark and GFM parts natively; the rest round-trips as text until
a remark plugin is added (see `PROPOSAL-v2.md` §15).

## Definition lists

Term one : Definition of term one.

Term two : First definition. : Second definition with _emphasis_.

## Abbreviations

The HTML specification is maintained by the W3C.

*[HTML]: Hyper Text Markup Language *[W3C]: World Wide Web Consortium

## Attributes

### A heading with an id {#custom-id}

A paragraph with a class. {.lead}

[Link with attributes](https://example.com){target=_blank .external}

![Image with size](img/sample.png){width=50%}

## Math

Inline math $E = mc^2$ and display math:

$$
\int_0^\infty e^{-x^2} \, dx = \frac{\sqrt{\pi}}{2}
$$

## Highlight, superscript, subscript, insert

==highlighted text==, x^2^ and H~2~O, ++inserted++.

## Admonitions and directives

::: note A note container (Pandoc / remark-directive style). :::

!!! warning "Watch out" Markdown Extra style admonition body.

:::spoiler Click to reveal Hidden text. :::

## Fenced div and code attributes

```{.python .numberLines startFrom="10"}
def f():
    return 42
```

## Footnotes with multiple paragraphs

Text with a footnote.[^multi]

[^multi]: First paragraph of the footnote.

    Second paragraph, indented.

## Emoji shortcodes and smart punctuation

:tada: :books: -- an en dash, --- an em dash, "smart quotes" and 'single
quotes'...

## Tables with captions and multiline cells

| Column A   | Column B |
| ---------- | -------- |
| line one \ |          |
| line two   | single   |

Table: A caption for the table above.

## Line blocks (Pandoc)

| The limerick packs laughs anatomical | In space that is quite economical.

## Metadata blocks (MultiMarkdown)

Title: Ignored because the YAML front-matter wins Author: Someone
