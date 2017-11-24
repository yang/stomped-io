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
'
