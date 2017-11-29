dest="$1"
if [[ ! $no_build ]] ; then
    yarn build-prod
fi
git archive --format zip -o bounce.zip master
ssh $dest 'rm bounce/dist/bundle*'
rsync -ril bounce.zip $dest:
rsync -ril index.html updates.txt build dist $dest:bounce/
ssh $dest '
    mkdir -p bounce;
    cd bounce;
    echo A | unzip ../bounce.zip
    rm src/dyn-*.ts
    cp src/dyn.ts src/.dyn-tmp.ts
    mv src/.dyn-tmp.ts src/dyn-$(date +%Y-%m-%d-%H-%M-%S).ts
    . ~/.node/bounce/bin/activate
    yarn install
'
