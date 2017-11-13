dest="$1"
git archive --format zip -o bounce.zip master
yarn build-prod
rsync -ril bounce.zip $dest:
rsync -ril build/ $dest:bounce/build/
rsync -ril dist/ $dest:bounce/dist/
ssh $dest '
    mkdir -p bounce;
    cd bounce;
    echo A | unzip ../bounce.zip
'