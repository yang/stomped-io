origdir="$PWD"
mkdir -p /tmp/geolite
cd /tmp/geolite
curl -O 'http://geolite.maxmind.com/download/geoip/database/GeoLite2-City.tar.gz'
tar xzf GeoLite2*.tar.gz
cd GeoLite2*/
cp GeoLite2*.mmdb "$origdir"