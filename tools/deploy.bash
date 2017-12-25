dest="stomped.io"
if [[ ! $no_build ]] ; then
    yarn build-prod
fi
new_bundle="$(basename dist/bundle*)"
git archive --format zip -o bounce.zip master
rsync -ril bounce.zip $dest:
rsync -ril assets/main.css $dest:bounce/assets/
# Sync index.html last
rsync -ril build dist index.html $dest:bounce/
ssh $dest "
    mkdir -p bounce;
    cd bounce;
    mv dist/$new_bundle dist/.$new_bundle
    rm dist/bundle*
    mv dist/.$new_bundle dist/$new_bundle
    echo A | unzip ../bounce.zip
    if false ; then
        rm src/dyn-*.ts
        cp src/dyn.ts src/.dyn-tmp.ts
        mv src/.dyn-tmp.ts src/dyn-\$(date +%Y-%m-%d-%H-%M-%S).ts
    fi
    . ~/.node/bounce/bin/activate
    yarn install
"

for host in `cat tools/servers.txt` ; do
    host=$host.$dest
    rsync -ril bounce.zip $host:
    ssh $host "
        mkdir -p bounce;
        cd bounce;
        echo A | unzip ../bounce.zip
        . ~/.node/bounce/bin/activate
        yarn install
    "
done