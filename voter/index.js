const Nightmare = require('nightmare');
const nightmare = Nightmare({ height: 1300 });
const fs = require('fs');
async function go() {
  const start = await nightmare
    .useragent(`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/63.0.3239.84 Safari/537.36`)
    .goto('http://iogames.space/stomped-io')
    .click('#like')
    .evaluate(() => ['numberCircle','likesCount','dislikesCount'].map(x => ({[x]: document.getElementById(x).innerText})))
  const end = await nightmare
    .wait('#like.text_positive')
    .evaluate(() => ['numberCircle','likesCount','dislikesCount'].map(x => ({[x]: document.getElementById(x).innerText})))
  await nightmare
    .screenshot()
    .end()
  function show(data) { return JSON.stringify(Object.assign(...data)); }
  fs.appendFileSync('out.log', `${new Date()}: ${show(start)} -> ${show(end)}\n`);
}
go();
