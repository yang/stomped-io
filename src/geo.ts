import {getLogger, ServerLoad} from "./common";
import * as _ from "lodash";
import * as geolib from "geolib";
import * as geoip2 from 'geoip2';
import * as dns from "dns";

geoip2.init('./GeoLite2-City.mmdb');

export interface Geo {
  latitude: number;
  longitude: number;
}

export interface GeoIpRes {
  location: Geo;
}

export class ServerMatcher {
  serverGeos = new Map<string, GeoIpRes>();

  constructor(private defaultHost: string) {
  }

  bestServer(ip: string, lastLoad: ServerLoad[]): string {
    // Somewhat from https://stackoverflow.com/questions/6458083/get-the-clients-ip-address-in-socket-io
    const geo = geoip2.lookupSimpleSync(ip);
    if (geo) {
      const closestServer = _(lastLoad.map(({host}) => host))
          .minBy(host => geolib.getDistance(geo.location, this.serverGeos.get(host).location)) ||
        this.defaultHost;
      let sgeo;
      getLogger('bestServer').log(
        JSON.stringify(geo.location),
        JSON.stringify(lastLoad.map(({host}) => ({
          host,
          loc: sgeo = this.serverGeos.get(host).location,
          dist: geolib.getDistance(geo.location, sgeo)
        })))
      );
      if (_(closestServer).startsWith('us-west-')) {
        console.log(
          'bestServer',
          JSON.stringify(geo.location),
          JSON.stringify(lastLoad.map(({host}) => ({
            host,
            loc: sgeo = this.serverGeos.get(host).location,
            dist: geolib.getDistance(geo.location, sgeo)
          }))),
        );
      }
      return closestServer;
    } else {
      return this.defaultHost;
    }
  }

  regServer(host: string): Promise<any> {
    return new Promise(resolve => {
      if (!this.serverGeos.has(host)) {
        // geolite2 is failing for Frankfurt!
        if (_(host).startsWith('eu-central-')) {
          this.serverGeos.set(host, {location: {latitude: 50.105888, longitude: 8.605853}});
          resolve()
        } else {
          dns.lookup(host, (err, ip) => {
            if (ip) {
              this.serverGeos.set(host, geoip2.lookupSimpleSync(ip));
            }
            resolve();
          });
        }
      }
    });
  }
}