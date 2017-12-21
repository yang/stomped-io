import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as classnames from 'classnames';
import {Chance} from 'chance';
import {charForName, clean, clearArray, isBasicStyle, isHiddenStyle, maxNameLen, playerStyles, Stats} from "./common";
import {charVariants} from './spriter';
import * as Cookies from 'js-cookie';
import * as _ from 'lodash';
import * as Clipboard from 'clipboard';
import * as Popover from 'react-popover';
import * as URLSearchParams from 'url-search-params';

const searchParams = new URLSearchParams(window.location.search);

function checkMobileOrTablet() {
  var check = false;
  (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4))) check = true;})(navigator.userAgent||navigator.vendor||(window as any).opera);
  return check;
}

const isMobileOrTablet = checkMobileOrTablet();

function humanTime(ms: number) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  return `${min}m ${sec < 10 ? '0' : ''}${sec % 60}s`;
}

interface SplashState {
  name: string;
  shown: boolean;
  disabled: boolean;
  char: string;
  charToVariants: any;
  stats: Stats;
  unlocked: boolean;
  hovering: boolean;
  clickedShare: boolean;
  dur: string;
  deaths: number;
  voteDismissed: boolean;
  showStats: boolean;
  pleaseVote: boolean;
  youtuber: Youtuber;
  server: string;
  showRoomModal: boolean;
}

interface SplashProps {
  onSubmit: (name: string, char: string, server: string) => void;
  shown: boolean;
  browserSupported: boolean;
  stats: Stats;
  playerStats: PlayerStats;
}

export function inIframe () {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}

interface StoredState {
  unlocked: boolean;
}

export function servers() {
  if (searchParams.get('server'))
    return [searchParams.get('server')];
  else if (location.origin.indexOf('stomped.io') >= 0)
    return [location.origin];
  else
    return [location.origin.replace(/:\d+$/, ':3000')];
}

interface Youtuber {
  name: string;
  url: string;
}

const youtubers: Youtuber[] = [
  {name: 'Fady', url: 'https://www.youtube.com/watch?v=7qVnNp14SAE'},
  {name: 'Truebizcuit', url: 'https://www.youtube.com/watch?v=oTOY6TgWWuo'},
  {name: 'AG TaNGrA', url: 'https://www.youtube.com/watch?v=hSHyTeHPma8'},
  {name: 'game mas', url: 'https://www.youtube.com/watch?v=BP3_k-po6Kc'},
];
function randYoutuber() {
  return new Chance().pickone(youtubers);
}

export class Splash extends React.Component {
  state: SplashState;
  props: SplashProps;
  inputEl: HTMLInputElement;
  galleryEl: HTMLDivElement;
  galleryItemEls = new Map<string, HTMLElement>();
  chars = playerStyles.filter(char => !isHiddenStyle(char));
  afterUpdates = [];
  showAds = true;
  statsResolver;
  statsLoaded = new Promise<Stats>(resolve => this.statsResolver = resolve);
  server: string;
  roomLinkText;
  constructor(props) {
    super(props);
    (window as any).dbg.doShow = () => this.setState({deaths: this.state.deaths + 1});
    this.state = {
      name: '',
      shown: props.shown,
      disabled: false,
      char: new Chance().pickone(this.chars.filter(char => isBasicStyle(char))),
      charToVariants: null,
      stats: props.stats,
      unlocked: ((Cookies.getJSON('v1') || {}) as StoredState).unlocked,
      hovering: false,
      clickedShare: false,
      dur: 'day',
      deaths: 0,
      voteDismissed: false,
      showStats: false,
      pleaseVote: false,
      youtuber: randYoutuber(),
      server: null,
      showRoomModal: false
    };
  }
  private handleChange = (e) => {
    this.setState({name: e.target.value});
  };
  private handleSubmit = (e) => {
    e.preventDefault();
    this.setState({disabled: true});
    const name = this.state.name;
    const char = charForName(name, this.state.char);
    this.statsLoaded.then(stats => {
      this.props.onSubmit(name, char, this.server);
    });
  };
  componentDidUpdate() {
    // Must do after element is rendered - see
    // https://stackoverflow.com/questions/26556436/react-after-render-code
    if (this.afterUpdates.length > 0) {
      const funcs = this.afterUpdates.slice();
      clearArray(this.afterUpdates);
      setTimeout(() => funcs.forEach(f => f()), 10);
    }
  }
  show() {
    const ad = document.querySelector('.right-ad') as HTMLElement;
    if (ad) {
      ad.style.display = '';
      if ((window as any).aipDisplayTag)
        (window as any).aipDisplayTag.refresh('stomped-io_300x250');
    }
    const ad2 = document.querySelector('.right-ad-default') as HTMLElement;
    if (ad2) ad2.style.display = '';
    if (this.state.deaths >= 1 && !this.state.voteDismissed) {
      setTimeout(
        () => this.setState({pleaseVote: true}),
        100
      );
    }
    this.setState({
      shown: true,
      disabled: false,
      deaths: this.state.deaths + 1,
      showStats: true
    });
    document.getElementById('mount-point').style.display = '';
  }
  hide() {
    const ad = document.querySelector('.right-ad') as HTMLElement;
    if (ad) ad.style.display = 'none';
    const ad2 = document.querySelector('.right-ad-default') as HTMLElement;
    if (ad2) ad2.style.display = 'none';
    this.setState({shown: false, pleaseVote: false});
    document.getElementById('mount-point').style.display = 'none';
  }
  initGalleryItem = (char: string, el: HTMLElement) => {
    if (el) {
      this.galleryItemEls.set(char, el);
    }
  };
  chooseChar = (char: string) => {
    if (this.state.unlocked || isBasicStyle(char)) {
      this.setState({char});
      this.afterUpdates.push(() => this.scrollToChar());
    } else {
      this.inputEl.focus();
    }
  };
  scrollToChar = () => {
    const item = this.galleryItemEls.get(this.state.char);
    if (item)
      this.galleryEl.scrollLeft = item.offsetLeft - this.galleryEl.offsetLeft - this.galleryEl.clientWidth / 2 + item.clientWidth / 2;
  };
  setImgs(mapping) {
    this.afterUpdates.push(this.scrollToChar);
    this.setState({charToVariants: mapping});
  }

  setStats(stats: Stats) {
    const [{host: server}] = _(stats.load)
      .sortBy(({host, weight}) => [Math.max(weight - 60, 0), host.length, host])
      .value();
    let host;
    if (searchParams.get('server')) {
      host = searchParams.get('server');
    } else if (_(server).startsWith('localhost')) {
      // Ignore the server string which is just localhost:
      // A LAN user might be accessing e.g.: http://yangs-big-mbp.local:8080
      // That location.origin is what we should be using (yangs-big-mbp.local:3000)
      const port = server.replace('localhost:', '');
      host = location.origin.replace(/:\d+$/, `:${port}`);
    } else {
      host = server;
    }
    this.server = host;
    this.setState({stats: stats, server: host});
    this.statsResolver(stats);
  }
  share = (url: string) => {
    this.setState({clickedShare: true});
    Cookies.set('v1', {unlocked: true} as StoredState);
    if (inIframe()) {
      window.open(url);
    } else {
      window.location.href = url;
    }
  };
  continue() {
    this.afterUpdates.push(this.scrollToChar);
    this.setState({showStats: false});
  }
  ad(side: string) {
    if (!this.showAds) return [];
    side = '';
    return [
      <div id='stomped-io_300x250'>
        <script type='text/javascript'>
          aipDisplayTag.display('stomped-io_300x250');
          (window as any).aipDisplayTag.refresh('stomped-io_300x250';
        </script>
      </div>
    ];
  }
  render() {
    const isSupported = this.props.browserSupported;
    const ps = this.props.playerStats;
    const psText = {
      'Peak size': 10 * Math.round(ps.topSize),
      'Highest rank': ps.topRank,
      'Alive time': humanTime(ps.aliveTime),
      'Leaderboard time': humanTime(ps.leaderboardTime),
      'Times stomped others': ps.stomped,
      'Times got stomped': ps.gotStomped
    };
    const psTags = _(psText)
      .toPairs()
      .map(([label, value]) =>
        <li>{label}: <strong className={'score'}>{value}</strong></li>
      ).value();
    return <div
      className={classnames({
        'splash': true,
        'splash--ads': this.showAds,
        'splash--iframed': inIframe()
      })}
      style={{display: this.state.shown ? undefined : 'none'}}
    >
      {
        !this.state.showStats ?
          <div className={'main-section'}>
            <h1>Stomped<span className="io">.io</span></h1>
            {/*{this.state.stats && <h2><span className="num">{this.state.stats.players}</span> Players Online</h2>}*/}
            {!isSupported && <p key={'p'} className={'subhead'}>
              Sorry, this game does not work with your browser.
              <br/>
              Please try using a recent version of Chrome (recommended), Firefox, Safari, or Microsoft Edge.
              </p>}
            {isSupported && !isMobileOrTablet && <p key='ppp' className={'subhead'}>
              <strong>Use your mouse or arrow keys</strong> to steer.
              <br/>
              Collect stars to grow.  Stomp other players to take their stars.
              <br/>
              <strong>Click or press down/space</strong> for a smash attack!
            </p>}
            {isSupported && isMobileOrTablet && <p key='ppp' className={'subhead'}>
              <strong>Tap left/right side of screen</strong> to steer.
              <br/>
              Collect stars to grow.  Stomp other players to take their stars.
              <br/>
              <strong>Tap with both thumbs</strong> for a smash attack!
            </p>}
            {isSupported && <form key={'form'} className='splash-form' onSubmit={this.handleSubmit}>
              <input
                className={'name-input'}
                ref={(el) => {if (el) {
                  // For some reason (in Edge) putting this timeout in componentDidUpadte doesn't necessarily work.  Also,
                  // executing immediately rather than timeout doesn't work either.
                  setTimeout(() => el.focus(), 10);
                  this.inputEl = el;
                }}}
                value={this.state.name}
                onChange={this.handleChange}
                placeholder={'Enter a nickname'}
                autoFocus={true}
                disabled={this.state.disabled}
                maxLength={maxNameLen}
              />
              <br/>
              <div className={'gallery'} ref={el => this.galleryEl = el}>{
                this.state.charToVariants && this.chars.map(char => {
                  const [charBase, variant] = char.split('-');
                  const variantSpriteSheet = this.state.charToVariants[charBase][+variant];
                  if (!variantSpriteSheet) return null;
                  const imgSrc = variantSpriteSheet[0].src;
                  const [w,h,x0] = charVariants.find(cv => cv.name == char.slice(0, -2)).bbox;
                  return <a
                    key={char}
                    ref={el => this.initGalleryItem(char, el)}
                    className={classnames({
                      'gallery-item': true,
                      'gallery-item--disabled': !this.state.unlocked && !isBasicStyle(char),
                      'gallery-item--selected': this.state.char == char
                    })}
                    title={!this.state.unlocked && !isBasicStyle(char) ? 'Share to unlock!' : ''}
                    onMouseOver={() => this.setState({hovering: !this.state.unlocked && !isBasicStyle(char)})}
                    onMouseOut={() => this.setState({hovering: false})}
                    onMouseDown={() => this.chooseChar(char)}
                  >
                  <span className={'gallery-img-box'}>
                    {/*No satisfying pure-CSS solution*/}
                    <img className='gallery-img' src={imgSrc} style={{
                      height: .35 * h
                    }}/>
                  </span>
                  </a>;
                })
              }</div>
              <br/>
              <button
                className={'submit-btn'}
                type={'submit'}
                disabled={!this.state.charToVariants || this.state.disabled || this.state.name.trim() == ''}>Play!</button>
            </form>}
          </div>
          :
          <div className='main-section'>
            <div className={'stats-box'}>
              <p className={'stats-title'}>Your stats:</p>
              <ul className={'stats-col'}>
                {psTags.slice(0, 3)}
              </ul>
              <ul className={'stats-col'}>
                {psTags.slice(3)}
              </ul>
              <button className={'share-stats-btn'} onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`I survived for ${humanTime(ps.aliveTime)} and got a score of ${10 * Math.round(ps.topSize)}! Can you beat me? Come and play! https://stomped.io #stompedio`)}`)}>
                <i className={'fa fa-twitter'} aria-hidden={'true'}></i>
                {' '}
                Share
              </button>
              <button className={'share-stats-btn'} onClick={() => window.open("https://www.facebook.com/sharer/sharer.php?u=http%3A%2F%2Fstomped.io")}>
                <i className={'fa fa-facebook-official'} aria-hidden={'true'}></i>
                {' '}
                Share
              </button>
              <button className={'cont-btn'} onClick={() => this.continue()}>
                Continue
              </button>
            </div>
          </div>
    }
      <div
        className={classnames({
          'please-vote': true,
          'please-vote--shown': this.state.pleaseVote,
        })}>
        <div className={classnames({
          'please-vote-container': true,
        })}>
          If you enjoy this game,<br/>
          please give us a
          {' '}
          {
            inIframe() ?
              'thumbs up' :
              <a
                target={'_blank'}
                href="http://iogames.space/stomped-io"
                onClick={() => this.setState({pleaseVote: false, voteDismissed: true})}
              >thumbs up</a>
          }
          !
          <a
            className='dismiss-btn'
            href={'javascript: void 0'}
            onClick={() => this.setState({pleaseVote: false, voteDismissed: true})}
          >
            <i className={'fa fa-times'}/>
          </a>
        </div>
      </div>
      <div className={"more-io-games"}>
        <a href={"http://iogames.space/"} target={"_blank"}>More io Games</a><br/>
        (<a href={"http://io-games.io/"} target={"_blank"}>And Even More</a>!)
      </div>
      <div className={classnames({
        'share-indicator': true,
        'share-indicator--highlighted': this.state.hovering,
      })} style={{display: this.state.unlocked ? 'none' : ''}}>
        { inIframe() && this.state.clickedShare ?
          <span>
            Refresh this page<br/>
            after sharing!
          </span> :
          <span>
            Share to unlock characters!<br/>
            Get your friends to play!
          </span>
        }
      </div>
      {/*<div className={'left-ad'}>{...this.ad('left')}</div>*/}
      {/*<div className={'right-ad'}>{...this.ad('right')}</div>*/}
      <div className={'share-btns'}>
        <button onClick={() => this.share(`https://twitter.com/intent/tweet?text=${encodeURIComponent('Come play this new game! https://stomped.io #stompedio')}`)}>
          <i className={'fa fa-twitter icon'} aria-hidden={'true'}></i>
          Share on Twitter
        </button>
        <br/>
        <button onClick={() => this.share("https://www.facebook.com/sharer/sharer.php?u=http%3A%2F%2Fstomped.io")}>
          <i className={'fa fa-facebook-official icon'} aria-hidden={'true'}></i>
          Share on Facebook
        </button>
      </div>
      <div className={"minor-links"}>
        {inIframe() && <a href={"/"} target={"_blank"}>
          Pop out in new tab
          <i className={'fa fa-external-link icon'} aria-hidden={'true'}></i>
        </a>}
        {inIframe() && <br/>}
        <a href={"updates.txt"} target={"_blank"}>Changelog</a>
        {this.state.server && <br/>}
        {
          this.state.server &&
          <Popover
            isOpen={this.state.showRoomModal}
            target={null}
            onOuterAction={() => this.setState({showRoomModal: false})}
            body={
              <div className='room-link-modal'>
                <p>Share this link with friends so you can play on the same server!</p>
                <input
                  ref={(el) => this.roomLinkText = el}
                  type="text"
                  className='room-link-text'
                  value={`${location.origin}/?server=${encodeURIComponent(this.state.server)}`}
                  onClick={function(ev) { (ev.target as any).select(); }}
                  {...{readonly: true}}
                  />
                <button
                  onClick={() => this.roomLinkText.select()}
                  className='room-link-btn'
                  ref={(btn) => btn && new Clipboard(btn, {
                    text: () => `${location.origin}/?server=${encodeURIComponent(this.state.server)}`
                  })}
                >Copy Link</button>
              </div>
            }
          >
            <a
              onClick={(e) => {
                e.preventDefault();
                this.setState({showRoomModal: true});
              }}
              href={'javascript: void 0'}>
              Copy room link
            </a>
          </Popover>
        }
      </div>
      <div className={'featured-youtubers'}>
        <a className={'youtube-link'} href={this.state.youtuber.url} target={'_blank'}>
          Featured YouTuber:
          <div className={'featured-youtuber-name'}>
            <img className={'youtube-icon'} src={'assets/youtube-icon.png'}/>
            {this.state.youtuber.name}!
          </div>
        </a>
        {
          this.state.stats && this.state.stats.bestOf &&
          <div className={'best-of'}>
            Top of the:<br/>
            {['day','week','month'].map((dur, i) => <span>
              {i > 0 ? ' | ' : ''}
              <a
                className={classnames({
                  'best-of-dur': true,
                  'best-of-dur--selected': dur == this.state.dur
                })}
                href={'javascript: void 0'}
                onClick={() => this.setState({dur})}
              >{dur}</a>
            </span>)}
            <ul className={'best-of-list'}>
              {this.state.stats.bestOf[this.state.dur]
                .filter(rec => rec.name.search(/nigger|(paku|luffy)(..?|.?dot.?)io|\.io$/i) == -1)
                .map(rec => <li key={rec.name}>{rec.size} - {clean(rec.name)}</li>)}
            </ul>
          </div>
        }
      </div>
    </div>;
  }
}

export function renderSplash({onSubmit, shown, browserSupported, stats, playerStats}: SplashProps) {
  return new Promise<Splash>((resolve) =>
    ReactDOM.render(
      <Splash onSubmit={onSubmit} shown={shown} ref={resolve} stats={stats} browserSupported={browserSupported} playerStats={playerStats}/>,
      document.getElementById('mount-point')
    )
  );
}

export class PlayerStats {
  spawnTime = 0;
  aliveTime = 0;
  leaderStreakTime = 0;
  leaderboardTime = 0;
  topRank = 99999;
  topSize = 0;
  stomped = 0;
  gotStomped = 0;
  currLeaderStartTime = 0;
  currLeaderboardStartTime = 0;
}