import { describe, expect, it } from 'vitest';
import { getTimelineYearGap, normalizeImgurImageUrl } from './TimelinePage';

describe('timeline image URLs', () => {
  it('converts an Imgur page link into an embeddable image URL', () => {
    expect(normalizeImgurImageUrl('https://imgur.com/abc123')).toBe('https://i.imgur.com/abc123.png');
    expect(normalizeImgurImageUrl('https://www.imgur.com/abc123.jpg')).toBe('https://i.imgur.com/abc123.jpg');
  });

  it('preserves direct and non-Imgur image URLs', () => {
    expect(normalizeImgurImageUrl('https://i.imgur.com/abc123.webp')).toBe('https://i.imgur.com/abc123.webp');
    expect(normalizeImgurImageUrl('https://example.com/image.png')).toBe('https://example.com/image.png');
  });

  it('does not pretend an Imgur album is a single image', () => {
    expect(normalizeImgurImageUrl('https://imgur.com/a/album123')).toBe('https://imgur.com/a/album123');
  });
});

describe('timeline spacing', () => {
  it('adds progressively more space without making long gaps enormous', () => {
    expect(getTimelineYearGap(1)).toBeLessThan(getTimelineYearGap(10));
    expect(getTimelineYearGap(10)).toBeLessThan(getTimelineYearGap(100));
    expect(getTimelineYearGap(100)).toBeLessThan(getTimelineYearGap(1000));
    expect(getTimelineYearGap(1000)).toBeLessThanOrEqual(116);
  });
});
