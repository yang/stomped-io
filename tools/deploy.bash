dest="$1"
if [[ ! $no_build ]] ; then
    yarn build-prod
fi
new_bundle="$(basename dist/bundle*)"
git archive --format zip -o bounce.zip master
rsync -ril bounce.zip $dest:
rsync -ril index.html build dist $dest:bounce/
ssh $dest "
    mkdir -p bounce;
    cd bounce;
    mv dist/$new_bundle dist/.$new_bundle
    rm dist/bundle*
    mv dist/.$new_bundle dist/$new_bundle
    echo A | unzip ../bounce.zip
    rm src/dyn-*.ts
    cp src/dyn.ts src/.dyn-tmp.ts
    mv src/.dyn-tmp.ts src/dyn-\$(date +%Y-%m-%d-%H-%M-%S).ts
    . ~/.node/bounce/bin/activate
    yarn install
"
