<!-- @format -->

# Design Notes

Can start out with this simple linear lava, but consider adding something wave-y like this:

https://phaser.io/examples/v2/tile-sprites/tile-sprite-from-animated-sprite

# Development

Run 'tools/setup.bash` to get the latest GeoLite2 database.

Run `yarn watch` first, at least once, before using `yarn dev`, so that it creates dist/main.proto. (CopyWebpackPlugin
doesn't work well with the relative `to` path in webpack-dev-server mode.)

Also start `yarn watch-css`.

Run `yarn server-local` to start the server, which listens for a Chrome debugger.

Run `yarn build-prod` for a production build.

# Dev Notes

- May want to consider using simpler [AABB-only physics engine](https://gist.github.com/BonsaiDen/6144232).
- Bot names from https://www.findnicknames.com/cool-gamer-tags/

## Multiplayer Engines

- IGE: only supports interpolation; odd conventions
- Colyseus: focused on administrivia
- Timeline: simple micro library for interpolation
- Lance:
  - requires heavy framework buy-in, I foresee fighting against it
  - extrapolation is over _everything_, not selective player-affected things

Ultimately, just going with home-rolled (maybe with some assistance from
TImeline), but Lance seems like the most promising if things get hairy quickly.

## Misc

- Testing out "display":"standalone" of PWA manifest doesn't work tunneling local servers; use ngrok.
  See https://stackoverflow.com/questions/47266973/pwa-manifest-attribute-display-standalone-not-working-on-android and
  https://developers.google.com/web/tools/chrome-devtools/remote-debugging/local-server
- `moduleResolution: node` is from
  https://github.com/Microsoft/TypeScript/issues/8189

# Checklists

Adding a new character:

- clone player-plain.svg to inherit the correct leg structure, so that spriter can animate them
- save the new svg as designs/player-XXX.svg
- add XXX-0 to src/chars.txt and XXX to Common.playerStyleIndividuals
- add XXX config to Spriter.chars - mind any protrusions, adjust width/height accordingly (or else, clipping!)

# Performance

The first few `runSims` run times when using `deepCloneWorld`:

- 3363.185
- 3166.084999999999
- 2408.605000000003
- 1400.454999999998
- 1011.4200000000019

The first few `runSims` run times when using `manuallyCloneWorld`:

- 1597.4000000000005
- 1660.640000000003
- 869.0249999999978
- 762.75
- 850.2850000000108
- 376.13500000000204

# Deployment

I've been using Linode. The network performance and cost has been good there. (This took its own line of research for me to hone in on.)

Nanode instances are good.

Open ports 80, 3000.

Instructions tested on Ubuntu 16.04.

On the host:

    # One-time setup
    sudo apt install nginx virtualenvwrapper unzip apache2-utils postgresql build-essential
    sudo hostname stomped.io
    echo stomped.io | sudo tee /etc/hostname

    # Database setup
    sudo -u postgres psql
        create user bounce with login;
        \password bounce
        create database bounce owner bounce;
    # Update .pgpass
    psql -h localhost -U bounce bounce
        create table daily_stats (host text, date date, data text, unique (host, date));
        create table load (host text unique, time timestamp, humans int, bots int);

    # Log out and back in
    mkvirtualenv bounce
    pip install nodeenv
    nodeenv -n 6.11.2 ~/.node/bounce/
    . ~/.node/bounce/bin/activate
    npm install -g yarn

    sudo htpasswd -c /etc/apache2/bounce.htpasswd yang

Set up letsencrypt:

    sudo certbot --nginx

Edit the nginx config to look like the one in tools/.

From your client:

    # Start once
    yarn watch
    yarn watch-css

    # Deployment - add new server IPs to deploy.bash
    # You must commit your work before deploying!
    bash -x tools/deploy.bash

Back on the host:

    # One-time host app setup
    cd bounce/
    bash tools/setup.bash # Get the GeoLite2 database.
    mkdir -p web/
    for i in index.html admin.html client.html advertisement.js assets/ build/ designs/ dist/ ads.txt updates.txt myicon.ico upup.sw.min.js offline.html manifest.json privacy.txt ; do
        ln -s ../$i web/
    done
    ls -l web/ # Check that links are working.

    # Each-time
    . ~/.node/bounce/bin/activate
    yarn install
    while true; do TARGETBOTS=40 yarn server; done

## nginx

/etc/nginx/sites-available/default should contain:

    server {
      listen 80;
      root /home/yang/bounce/web;
      index index.html index.htm index.nginx-debian.html;

      location /build/ {
        auth_basic "Admin Area";
        auth_basic_user_file /etc/apache2/bounce.htpasswd;
      }

      location /dist/maps/ {
        auth_basic "Admin Area";
        auth_basic_user_file /etc/apache2/bounce.htpasswd;
      }
    }

Consulted https://yashh.com/scaling-up-with-nginx after seeing a bunch of the following error:

    2018/02/10 22:05:40 [alert] 27085#27085: *57739361 768 worker_connections are not enough while connecting to upstream, client: 172.251.203.222, server: stomped.io, request: "GET /socket.io/?authKey=&clientId=960edb56-afe6-4208-abfa-48fef2024043&EIO=3&transport=polling&t=M61m9lC HTTP/1.1", upstream: "http://[::1]:3000/socket.io/?authKey=&clientId=960edb56-afe6-4208-abfa-48fef2024043&EIO=3&transport=polling&t=M61m9lC", host: "stomped.io", referrer: "https://stomped.io/"
    2018/02/10 22:05:40 [alert] 27085#27085: 768 worker_connections are not enough
    2018/02/10 22:05:40 [alert] 27085#27085: 768 worker_connections are not enough
    2018/02/10 22:05:40 [alert] 27085#27085: *57739368 768 worker_connections are not enough while connecting to upstream, client: 73.231.104.39, server: stomped.io, request: "GET /socket.io/?authKey=&clientId=441aa89b-d2a2-4b7e-a130-39077f3c7274&EIO=3&transport=polling&t=M61m99A HTTP/1.1", upstream: "http://[::1]:3000/socket.io/?authKey=&clientId=441aa89b-d2a2-4b7e-a130-39077f3c7274&EIO=3&transport=polling&t=M61m99A", host: "stomped.io", referrer: "https://stomped.io/"
    2018/02/10 22:05:41 [alert] 27085#27085: 768 worker_connections are not enough
    2018/02/10 22:05:41 [alert] 27085#27085: 768 worker_connections are not enough
    2018/02/10 22:05:41 [alert] 27085#27085: 768 worker_connections are not enough
    2018/02/10 22:05:41 [alert] 27085#27085: 768 worker_connections are not enough
    2018/02/10 22:05:41 [alert] 27085#27085: *57739390 768 worker_connections are not enough while connecting to upstream, client: 172.251.203.222, server: stomped.io, request: "GET /socket.io/?authKey=&clientId=960edb56-afe6-4208-abfa-48fef2024043&EIO=3&transport=polling&t=M61mA5j&sid=bjiHdf7_ZNYvjUoUOXxc HTTP/1.1", upstream: "http://127.0.0.1:3000/socket.io/?authKey=&clientId=960edb56-afe6-4208-abfa-48fef2024043&EIO=3&transport=polling&t=M61mA5j&sid=bjiHdf7_ZNYvjUoUOXxc", host: "stomped.io", referrer: "https://stomped.io/"
    2018/02/10 22:05:42 [alert] 27085#27085: 768 worker_connections are not enough
    2018/02/10 22:05:42 [alert] 27085#27085: *57739404 768 worker_connections are not enough while connecting to upstream, client: 172.88.248.136, server: stomped.io, request: "GET /socket.io/?authKey=&clientId=3a2c52fc-90b7-4e0d-b609-c5d2f1de65fb&EIO=3&transport=polling&t=M61n6te HTTP/1.1", upstream: "http://127.0.0.1:3000/socket.io/?authKey=&clientId=3a2c52fc-90b7-4e0d-b609-c5d2f1de65fb&EIO=3&transport=polling&t=M61n6te", host: "stomped.io", referrer: "https://stomped.io/"
    2018/02/10 22:05:42 [alert] 27085#27085: 768 worker_connections are not enough
    2018/02/10 22:05:42 [alert] 27085#27085: 768 worker_connections are not enough
    2018/02/10 22:06:06 [error] 27085#27085: *57738053 upstream timed out (110: Connection timed out) while reading response header from upstream, client: 172.251.203.222, server: stomped.io, request: "GET /socket.io/?authKey=&clientId=79df8ab0-e124-437f-ac7e-75b960d5fe7b&EIO=3&transport=polling&t=M61m1at&sid=RuLMm-GUrEXknD8cOXu7 HTTP/1.1", upstream: "http://127.0.0.1:3000/socket.io/?authKey=&clientId=79df8ab0-e124-437f-ac7e-75b960d5fe7b&EIO=3&transport=polling&t=M61m1at&sid=RuLMm-GUrEXknD8cOXu7", host: "stomped.io", referrer: "https://stomped.io/"
    2018/02/10 22:06:09 [error] 27085#27085: *57738220 upstream timed out (110: Connection timed out) while reading response header from upstream, client: 73.86.106.124, server: stomped.io, request: "GET /socket.io/?authKey=&clientId=5f23618e-a0d0-436c-a3b3-221dcf26cfa9&EIO=3&transport=polling&t=M61m2Ro&sid=A8WVXYmt-eZFtWtdOXvJ HTTP/1.1", upstream: "http://[::1]:3000/socket.io/?authKey=&clientId=5f23618e-a0d0-436c-a3b3-221dcf26cfa9&EIO=3&transport=polling&t=M61m2Ro&sid=A8WVXYmt-eZFtWtdOXvJ", host: "stomped.io", referrer: "https://stomped.io/"
    2018/02/10 22:06:09 [error] 27085#27085: *57738220 no live upstreams while connecting to upstream, client: 73.86.106.124, server: stomped.io, request: "GET /socket.io/?authKey=&clientId=5f23618e-a0d0-436c-a3b3-221dcf26cfa9&EIO=3&transport=polling&t=M61m2Ro&sid=A8WVXYmt-eZFtWtdOXvJ HTTP/1.1", upstream: "http://localhost/socket.io/?authKey=&clientId=5f23618e-a0d0-436c-a3b3-221dcf26cfa9&EIO=3&transport=polling&t=M61m2Ro&sid=A8WVXYmt-eZFtWtdOXvJ", host: "stomped.io", referrer: "https://stomped.io/"

Suspected this may be the cause of random sprite loading errors I've encountered (and potentially behind many Sentry cross origin access errors due to failed object resource loads).

Below is the same as what that link prescribes.

Add to /etc/security/limits.conf:

    * soft nofile 16384
    * hard nofile 32768

Add to /etc/pam.d/common-session:

    session required pam_limits.so

Edit in /etc/nginx/nginx.conf:

    worker_rlimit_nofile 32768;
    events {
            worker_connections 4096;
            # multi_accept on;
    }

## Alt servers

Clone the primary server.

If you're cloning a running server, you may need to use Linode's web based 'lish' console to log in, run fsck (requiring
you to manually approve fixes), and reboot. There shouldn't be any data loss risk.

Run once, replacing NODE with e.g. us-west-00:

    sudo hostname NODE.stomped.io
    echo NODE.stomped.io | sudo tee /etc/hostname
    ssh-keygen # Make passwordless key
    ssh-copy-id stomped.io

Edit nginx config to use new hostname in server_name (and remove the redirect from www).

Set up letsencrypt:

    sudo certbot --nginx

Run on each boot:

    sudo service postgresql stop
    ssh -fNL5432:localhost:5432 stomped.io
    . ~/.node/bounce/bin/activate
    while true; do TARGETBOTS=30 yarn server; done
