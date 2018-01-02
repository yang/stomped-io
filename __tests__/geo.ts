import {ServerMatcher} from "../src/geo";
import {extractRegion} from "../src/common";

describe('bestServer', () => {
  it('should work', async () => {
    const m = new ServerMatcher('stomped.io');
    await m.regServer('us-west-hte.stomped.io', '50.116.14.9');
    await m.regServer('us-west-nwt.stomped.io', '50.116.14.9');
    await m.regServer('eu-central-jzv.stomped.io', '139.162.130.8');
    await m.regServer('eu-central-sh5.stomped.io', '139.162.130.8');
    await m.regServer('ap-northeast-po7.stomped.io', '139.162.65.37');
    await m.regServer('ap-northeast-hkx.stomped.io', '139.162.65.37');
    await m.regServer('us-east-oz9.stomped.io', '172.104.28.36');

    const queries = {
      '45.79.94.70': 'us-west',
      '45.79.106.88': 'us-west',
      '50.116.57.237': 'us-east',
      '176.58.107.39': 'eu-central',
      '139.162.23.4': 'ap-northeast',
      '172.104.28.36': 'us-east',
    };

    for (let ip of Object.keys(queries)) {
      const expectedRegion = queries[ip];
      const best = m.bestServer(ip, Array.from(m.serverGeos.keys()).map(x => ({host: x, weight: 0})))
      expect(extractRegion(best)).toBe(expectedRegion);
    }
  });
});