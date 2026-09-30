import { describe, expect, it } from 'vitest';
import { getTimelineConfig, parseMarkdownContent } from './markdownContent';

describe('timeline frontmatter parsing', () => {
  it('keeps close and same-year events as independent entries', () => {
    const parsed = parseMarkdownContent(`---
pageType: timeline
startYear: 0
endYear: 20
events:
  - id: first
    year: 10
    title: First
  - id: second
    year: 10
    title: Second
  - id: third
    year: 11
    title: Third
---
Body`);

    const config = getTimelineConfig(parsed.frontmatter);
    expect(config?.events.map(event => [event.id, event.year])).toEqual([
      ['first', 10],
      ['second', 10],
      ['third', 11],
    ]);
  });

  it('normalizes malformed ranges, duplicate ids, markdown, and image fields', () => {
    const config = getTimelineConfig({
      pageType: 'timeline',
      events: [
        {
          id: 'arrival',
          year: '12',
          title: 'Arrival',
          description: '**Witnessed** by everyone.\n\n![Scene](https://imgur.com/example)',
          image: 'https://i.imgur.com/example.png',
          imageAlt: 'The arrival',
          tags: ['war', 'war', 7],
        },
        { id: 'arrival', year: 13, title: 'Aftermath' },
        { id: 'ignored', year: 'not-a-year', title: 'Invalid' },
      ],
      ranges: [
        { id: 'era', label: 'Reversed era', start: 20, end: 5 },
      ],
    });

    expect(config?.events).toHaveLength(2);
    expect(config?.events[0]).toMatchObject({
      id: 'arrival',
      year: 12,
      image: 'https://i.imgur.com/example.png',
      imageAlt: 'The arrival',
      tags: ['war'],
    });
    expect(config?.events[1].id).toBe('arrival-2');
    expect(config?.ranges[0]).toMatchObject({ start: 5, end: 20 });
    expect(config?.endYear).toBe(20);
  });
});
