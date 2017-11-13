dest="$1"
if [[ ! $no_build ]] ; then
    yarn build-prod
fi
git archive --format zip -o bounce.zip master
rsync -ril bounce.zip $dest:
rsync -ril build dist $dest:bounce/
ssh $dest '
    mkdir -p bounce;
    cd bounce;
    echo A | unzip ../bounce.zip
'