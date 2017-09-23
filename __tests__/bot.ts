import {clearArray} from '../src/common';
test('addition', () => {
  const xs = [1];
  clearArray(xs);
  expect(xs).toEqual([]);
});
