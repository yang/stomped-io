import * as Client from './client';

export function main(pool) {
  console.log('This is the admin client!');
  Client.main(pool);
}