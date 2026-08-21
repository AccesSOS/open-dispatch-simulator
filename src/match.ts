/**
 * Keyword matching on word boundaries, Unicode-aware: the keyword "no" matches
 * "no, he isn't" but never "not" or "know", and a phrase like "not breathing"
 * matches as a whole-word sequence.
 */
export const normalize = (s: string): string =>
  ' ' + s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';

export const containsKeyword = (text: string, keyword: string): boolean =>
  normalize(text).includes(normalize(keyword));
