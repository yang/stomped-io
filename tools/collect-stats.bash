#!/usr/bin/env bash
set -o errexit -o nounset
dest=stomped.io
for host in $dest `cat tools/servers.txt`; do
    if [[ $host != $dest ]]
    then host=$host.$dest
    fi
    mkdir -p cli-stats/$host/
    echo now processing $host
    rsync -iz $host:bounce/cli-stats-*.log cli-stats/$host/
    ssh $host "
      python -c \"
import glob, os
for log in sorted(glob.glob('bounce/cli-stats-*.log'))[:-1]:
    print 'removing', log
    os.remove(log)
\""
done
