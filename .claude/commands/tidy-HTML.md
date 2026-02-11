Tidy the HTML provided below by applying these transformation rules in order:

## Rules

1. **Remove all `style` attributes** from every element (e.g. `style="font-weight: 400;"`, `style="color:red"`, etc.)

2. **Unwrap `<span>` tags that have no remaining attributes** after rule 1. Keep the inner content (including child elements like `<br />`). If a `<span>` still has attributes after style removal (e.g. `class`, `id`, `data-*`), leave it intact.

3. **Remove elements that contain only `&nbsp;` and/or whitespace** (e.g. `<h4>&nbsp;</h4>`). Do NOT remove elements that contain child elements (e.g. `<h4><br /><br /></h4>` is kept). Do NOT remove `<td>`, `<th>`, `<script>`, `<style>`, `<iframe>`, `<canvas>`, `<video>`, or `<audio>` elements, even if they appear empty.

## Important

- Preserve all other attributes (`href`, `aria-level`, `class`, `id`, etc.) unless they are `style`.
- Preserve `<strong>`, `<em>`, `<a>`, `<br />`, and all other non-span tags.
- Preserve HTML entities like `&rsquo;`, `&nbsp;` (when inline within text content, not the sole content of a tag).
- Do NOT change tag casing, whitespace structure, or indentation.
- Do NOT add or remove line breaks.
- Return ONLY the tidied HTML inside a code block, with no commentary.

## Input HTML

$ARGUMENTS
