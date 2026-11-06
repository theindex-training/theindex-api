import { containsPattern, escapeLike } from './like.util';

describe('like.util', () => {
  it('escapes the LIKE wildcards and the escape character', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('C:\\dir')).toBe('C:\\\\dir');
    expect(escapeLike('клек')).toBe('клек');
  });

  it('builds a "contains" pattern', () => {
    expect(containsPattern('5_%')).toBe('%5\\_\\%%');
  });
});
