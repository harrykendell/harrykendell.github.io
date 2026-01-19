# Style Test Page

This page demonstrates all the styles and formatting available on the site.

## Headings (1)

### Heading 2

#### Heading 3

##### Heading 4

###### Heading 5

## Text Formatting

This is a paragraph with **bold text**, *italic text*, and ***bold italic text***.

You can also use `inline code` for technical terms or code snippets.

## Links

Here's a [link to an external site](https://www.example.com).

And here's a [link with a reference][ref-link].

[ref-link]: https://www.example.com/reference

## Lists

### Unordered List

- First item
- Second item
  - Nested item 1
  - Nested item 2
- Third item

### Ordered List

1. First step
2. Second step
   1. Sub-step A
   2. Sub-step B
3. Third step

## Code Blocks

```javascript
function greet(name) {
    console.log(`Hello, ${name}!`);
}

greet('World');
```

```python
def greet(name):
    print(f"Hello, {name}!")

greet('World')
```

## Blockquotes

> This is a blockquote example.
> It can span multiple lines.
>
> And even multiple paragraphs.

## Images

### Single Image

![Sample image alt text](../imgs/sample-image.jpg)

### Figure Grid

<div class="figure-grid">
  <figure class="figure-grid-item">
    <img src="../imgs/image1.jpg" alt="First example image" />
    <div class="figure-body">
      <p class="figure-caption">Caption for the first image.</p>
    </div>
  </figure>
  <figure class="figure-grid-item">
    <img src="../imgs/image2.jpg" alt="Second example image" />
    <div class="figure-body">
      <p class="figure-caption">Caption for the second image.</p>
    </div>
  </figure>
</div>

## Tables

| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 |
| Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 |
| Row 3, Col 1 | Row 3, Col 2 | Row 3, Col 3 |

## Horizontal Rule

This is a standalone rule below text
---

## Callouts

### Info Callout

> [!INFO] INFO
> This is an informational callout. Use it to highlight helpful tips or important information.

### Warning Callout

> [!WARNING] WARNING
> This is a warning callout. Use it to alert users to potential issues or things to be careful about.

### Danger Callout

> [!DANGER] DANGER
> This is a danger callout. Use it for critical warnings or dangerous operations.

## Special HTML Elements

### Highlighted Text

<mark>This text is highlighted.</mark>

### Custom Divs

<div class="subtle">
This is a custom div with a &ltsubtle> class.
</div>

## Mixed Content

You can mix **different** *formatting* with [links](https://example.com) and `code` in the same paragraph. This is useful for creating rich, informative content.

### Nested Lists with Code

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run the development server:

   ```bash
   npm run dev
   ```

3. Build for production:
   - Run the build command
   - Check the output
   - Deploy to server

## Abbreviations and Definitions

CSS
: Cascading Style Sheets

HTML
: HyperText Markup Language

## Task Lists

- [x] Completed task
- [ ] Incomplete task
- [ ] Another incomplete task
