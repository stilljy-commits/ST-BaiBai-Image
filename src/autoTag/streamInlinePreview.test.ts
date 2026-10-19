import { describe, expect, it } from 'vitest';
import { inlineAnchorText, inlineStoryText, inlineMarkerOrder } from './streamInlinePreview';

describe('unambiguous inline scene marker ownership', () => {
  it('allows unrelated template and footer markers around the complete scene sequence', () => {
    expect(inlineMarkerOrder(['example', 'station', 'map', 'footer'], ['station', 'map'])).toEqual([1, 2]);
    expect(inlineMarkerOrder(['station', 'footer'], ['station'])).toEqual([0]);
    expect(inlineMarkerOrder(['station', 'example', 'map'], ['station', 'map'])).toEqual([0, 2]);
  });
  it('keeps repeated scene intents in order when each has a unique position', () => {
    expect(inlineMarkerOrder(['same', 'unrelated', 'same'], ['same', 'same'])).toEqual([0, 2]);
    expect(inlineMarkerOrder(['same', 'map', 'footer', 'same'], ['same', 'map'])).toEqual([0, 1]);
  });
  it('refuses extra identical candidates that could place an image in the wrong paragraph', () => {
    expect(inlineMarkerOrder(['same', 'same'], ['same'])).toBeNull();
    expect(inlineMarkerOrder(['same', 'same', 'map'], ['same', 'map'])).toBeNull();
    expect(inlineMarkerOrder(['same', 'same', 'same'], ['same', 'same'])).toBeNull();
  });
  it('refuses a missing, transformed or reordered eligible scene marker', () => {
    expect(inlineMarkerOrder(['changed', 'map'], ['station', 'map'])).toBeNull();
    expect(inlineMarkerOrder(['station'], ['station', 'map'])).toBeNull();
    expect(inlineMarkerOrder(['map', 'station'], ['station', 'map'])).toBeNull();
  });
  it('returns no positions when no scenes are eligible', () => {
    expect(inlineMarkerOrder(['footer'], [])).toEqual([]);
  });
});

describe('display-only prose anchors', () => {
  it('normalizes presentation syntax while retaining the story words', () => {
    expect(inlineAnchorText('<now_plot>**成年旅人**查看[地图](https://example.test)，随后转身。&nbsp;</now_plot>'))
      .toBe('成年旅人查看地图，随后转身。');
    expect(inlineAnchorText('## 她说：&quot;路线 A &amp; B&quot;。&#x8DEF;&#32447;')).toBe('她说："路线A&B"。路线');
  });
  it('never fills missing prose with image descriptions or code samples', () => {
    expect(inlineAnchorText('正文。![描述](https://example.test/image.png)```\n例子\n```')).toBe('正文。');
  });
  it('keeps word boundaries when validating host story ownership', () => {
    expect(inlineStoryText('map  room')).toBe('map room');
    expect(inlineStoryText('map room')).not.toBe(inlineStoryText('maproom'));
  });
});
