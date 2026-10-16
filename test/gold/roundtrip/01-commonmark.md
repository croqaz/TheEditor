---
title: CommonMark kitchen sink
flavour: commonmark
---

# Heading level 1

## Heading level 2

### Heading level 3

#### Heading level 4

##### Heading level 5

###### Heading level 6

# Setext heading one

## Setext heading two

# Closing hashes are allowed

Paragraph with _emphasis_, _also emphasis_, **strong**, **also strong**,
_**both**_, `inline code`, ``code with ` backtick``, and a hard line break at
the end of this line\
followed by a backslash break, and two trailing spaces\
followed by a spaces break.

Soft breaks join these two lines into one paragraph.

Intraword emphasis: snake_case_word stays, but *this*is_emphasised_ partially.
Escapes: \*not emphasis\*, # not a heading, \`not code\`, 1. not a list.

Entities: © & < > " # 😀  end.

---

---

---

- Tight bullet one
- Tight bullet two with a continuation line
- Tight bullet three

* Star bullet

- Plus bullet

1. Ordered one
2. Ordered two
3. Ordered three

7) Starts at seven
8) Eight

- Loose list item one

- Loose list item two

  Second paragraph in the item.

  > Quote inside a list item.

  ```
  code inside a list item
  ```

- Loose list item three
  1. Nested ordered
  2. Nested ordered two
     - Deeply nested bullet

> Block quote line one line two of the same paragraph.
>
> Second paragraph in the quote.
>
> > Nested quote.
>
> - List in a quote
> - Second item

> Lazy continuation works here too.

```
Indented code block
second line
```

```
Fenced code without language
```

```js
const fenced = 'with language';
console.log(fenced);
```

```python
def tilde_fence():
    return True
```

````markdown
```
nested fence inside a longer fence
```
````

Links: [inline](https://example.com), [with title](https://example.com 'Title'),
[reference](https://example.com/ref 'Reference title'),
[collapsed](https://example.com/collapsed),
[shortcut](https://example.com/shortcut), <https://autolink.example>,
<mailto:someone@example.com>, [relative](./02-gfm.md),
[anchor](#heading-level-1), [empty](<>).

Images: ![alt text](img/sample.png),
![with title](img/sample.png 'Image title'), ![reference image](img/sample.png),
![](img/no-alt.png).

Raw inline HTML: <kbd>Ctrl</kbd>+<kbd>S</kbd>, a <span class="note">span</span>,
<br> and a comment <!-- hidden -->.

<div class="html-block" style="border: 1px solid currentColor; padding: 0 1ch;">
  <p>An <strong>HTML block</strong> with its own styles.</p>
  <ul><li>one</li><li>two</li></ul>
</div>

<details>
<summary>Collapsible</summary>

Markdown inside the details element.

</details>

<!-- a standalone HTML comment block -->

Final paragraph with unicode: café, naïve, 日本語, emoji 🎉, and a very long
word Pneumonoultramicroscopicsilicovolcanoconiosis to test wrapping on the grid.
