# Chronicle Timeline

Chronicle pages are Markdown files with timeline data in their YAML frontmatter.

## Event example

```yaml
events:
  - id: fall-of-the-citadel
    year: 946
    title: Fall of the Citadel
    color: '#facc15'
    size: lg
    image: https://imgur.com/IMAGE_ID
    imageAlt: The citadel during its final siege
    tags:
      - war
      - drakthar
    description: |
      The defenders held the western wall for **three days**.

      ![The breached western wall](https://i.imgur.com/OTHER_IMAGE_ID.jpg)

    goChapter: era-of-drakthar
    goChapterPart: fall-of-the-citadel
```

`image` adds a lead image to the event. A single-image Imgur page URL such as
`https://imgur.com/IMAGE_ID` is converted to an embeddable `i.imgur.com` URL.
Direct Imgur image links are also accepted. Album links do not identify one
specific image and should not be used as an event image.

`description` supports GitHub-flavored Markdown, including links, lists,
emphasis, blockquotes, and images. Use YAML's `|` block syntax for multiline
descriptions.

## Layout behavior

Events are sorted by year and same-year events are grouped on the same timeline
point. Cards stay in normal document flow, so events with identical or nearby
dates cannot overlap. The spacing between different years grows logarithmically:
long gaps are marked on the dashed axis with labels such as `780 years later`,
but are capped so the timeline never becomes tens of thousands of pixels tall.

Ranges appear as era filters and are matched inclusively: an event belongs to a
range when `range.start <= event.year <= range.end`. Consecutive events in the
same range are also wrapped by a colored era band on the left side of the
timeline, so their historical period remains visible while reading.
