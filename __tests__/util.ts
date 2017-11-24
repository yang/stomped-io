import * as Common from '../src/common';

describe('objDiff', () => {
  const d = Common.objDiff;
  it('should return null for no differences', () => {
    expect(d({a:0,b:0}, {a:0,b:0})).toEqual(null);
  })
  it('should return the RHS for only the fields that differ', () => {
    expect(d({a:0,b:0}, {a:0,b:1})).toEqual({b:1});
  });
  it('should work on sub-objects but not go deep, only return top-level diffs for any fields that are not equal', () => {
    expect(d({a:{a:0,b:0}}, {a:{a:0,b:1}})).toEqual({a:{a:0,b:1}});
  });
  it('should work for arrays', () => {
    expect(d({a:[0]}, {a:[0]})).toEqual(null);
    expect(d({a:[0]}, {a:[1]})).toEqual({a:[1]});
    expect(d({a:[0]}, {a:[]})).toEqual({a:[]});
  });
});