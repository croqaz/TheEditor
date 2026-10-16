import { describe, expect, test } from 'bun:test';
import { addBlockStats, countBlock, countText, formatCount, formatMinutes, summarise } from '../src/shared/stats/count';

describe('countBlock', () => {
  test('counts words, graphemes and sentences in English', () => {
    const s = countBlock('The quick brown fox. It jumps over the lazy dog!');
    expect(s.words).toBe(10);
    expect(s.sentences).toBe(2);
    expect(s.chars).toBe(48);
    expect(s.charsNoSpaces).toBe(39);
    expect(s.lines).toBe(1);
  });

  test('handles apostrophes, numbers and combining marks', () => {
    const s = countBlock("Don't count 3 twice; café naïve.");
    expect(s.words).toBe(6);
    expect(s.chars).toBe(32);
  });

  test('segments CJK text into words', () => {
    const s = countBlock('今日は良い天気です。');
    expect(s.words).toBeGreaterThan(1);
    expect(s.sentences).toBe(1);
  });

  test('empty text yields zeros', () => {
    expect(countBlock('')).toEqual({
      chars: 0,
      charsNoSpaces: 0,
      words: 0,
      sentences: 0,
      lines: 0,
    });
  });
});

describe('countText', () => {
  test('splits paragraphs on blank lines and computes read time', () => {
    const text = 'One two three.\n\nFour five six seven.\n\n\nEight.';
    const s = countText(text, { wpm: 60 });
    expect(s.paragraphs).toBe(3);
    expect(s.words).toBe(8);
    expect(s.readMinutes).toBeCloseTo(8 / 60, 5);
    expect(s.bytes).toBe(new TextEncoder().encode(text).byteLength);
  });
});

describe('summarise', () => {
  test('counts every block kind and totals', () => {
    const stats = summarise(
      [
        { kind: 'paragraph', stats: countBlock('One two.') },
        { kind: 'heading', stats: countBlock('Title') },
        { kind: 'list', stats: countBlock('a\nb') },
        { kind: 'code', stats: countBlock('x = 1') },
        { kind: 'quote', stats: countBlock('quoted words') },
        { kind: 'image', stats: countBlock('') },
        { kind: 'other', stats: countBlock('') },
      ],
      123,
      { wpm: 100, speakWpm: 50 }
    );
    expect(stats.paragraphs).toBe(1);
    expect(stats.headings).toBe(1);
    expect(stats.lists).toBe(1);
    expect(stats.codeBlocks).toBe(1);
    expect(stats.quotes).toBe(1);
    expect(stats.images).toBe(1);
    expect(stats.words).toBe(9); // "x = 1" counts two word-like segments
    expect(stats.lines).toBe(6); // empty blocks contribute no lines
    expect(stats.bytes).toBe(123);
    expect(stats.readMinutes).toBeCloseTo(9 / 100, 6);
    expect(stats.speakMinutes).toBeCloseTo(9 / 50, 6);
    expect(stats.selection).toBeUndefined();
  });

  test('addBlockStats and formatCount', () => {
    const sum = addBlockStats(countBlock('a b'), countBlock('c'));
    expect(sum.words).toBe(3);
    expect(formatCount(1234567)).toBe('1,234,567');
  });
});

describe('formatMinutes', () => {
  test('formats seconds, minutes and hours', () => {
    expect(formatMinutes(0.25)).toBe('15 s');
    expect(formatMinutes(12.4)).toBe('12 min');
    expect(formatMinutes(125)).toBe('2 h 5 min');
    expect(formatMinutes(120)).toBe('2 h');
  });
});
