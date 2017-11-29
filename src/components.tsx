import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as classnames from 'classnames';
import {Chance} from 'chance';
import {BestOf, clearArray, isBasicStyle, isHiddenStyle, maxNameLen, playerStyles, Stats} from "./common";
import {charVariants} from './spriter';
import * as Cookies from 'js-cookie';

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
}

interface SplashProps {
  onSubmit: (name: string, char: string) => void;
  shown: boolean;
  browserSupported: boolean;
  stats: Stats;
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

export class Splash extends React.Component {
  state: SplashState;
  props: SplashProps;
  inputEl: HTMLInputElement;
  galleryEl: HTMLDivElement;
  galleryItemEls = new Map<string, HTMLElement>();
  chars = playerStyles.filter(char => !isHiddenStyle(char));
  afterUpdates = [];
  showAds = location.pathname.substring(location.pathname.lastIndexOf("/") + 1) == 'client.html';
  constructor(props) {
    super(props);
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
    };
  }
  private handleChange = (e) => {
    this.setState({name: e.target.value});
  };
  private handleSubmit = (e) => {
    e.preventDefault();
    this.setState({disabled: true});
    const name = this.state.name;
    const char = name.toLowerCase().trim() == 'fady' ? 'fady-0' :
      name.toLowerCase().trim() == 'santa' ? 'santa-0' :
        this.state.char;
    this.props.onSubmit(name, char);
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
    (document.querySelector('.right-ad') as HTMLElement).style.display = '';
    (window as any).aipDisplayTag.refresh('stomped-io_300x250');
    this.afterUpdates.push(this.scrollToChar);
    this.setState({shown: true, disabled: false});
    document.getElementById('mount-point').style.display = '';
  }
  hide() {
    (document.querySelector('.right-ad') as HTMLElement).style.display = 'none';
    this.setState({shown: false});
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
    this.setState({stats: stats});
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
    return <div
      className={classnames({
        'splash': true,
        'splash--ads': this.showAds
      })}
      style={{display: this.state.shown ? undefined : 'none'}}
    >
      <div className={'main-section'}>
      <h1>Stomped<span className="io">.io</span></h1>
      {/*{this.state.stats && <h2><span className="num">{this.state.stats.players}</span> Players Online</h2>}*/}
      {!isSupported && <p key={'p'} className={'subhead'}>
        Sorry, this game does not work with your browser.
        <br/>
        Please try using a recent version of Chrome (recommended), Firefox, Safari, or Microsoft Edge.
      </p>}
      {isSupported && <p key='ppp' className={'subhead'}>
        <strong>Use your mouse or arrow keys</strong> to steer.
        <br/>
        Collect stars to grow.  Stomp other players to take their stars.
        <br/>
        <strong>Click or press down/space</strong> for a smash attack!
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
      </form>
      }
      </div>
      <div className={"more-io-games"}>
        <a href={"http://iogames.space/"} target={"_blank"}>More io Games</a>&nbsp;
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
      </div>
      <div className={'featured-youtubers'}>
        <a className={'youtube-link'} href={'https://www.youtube.com/watch?v=7qVnNp14SAE'} target={'_blank'}>
          Featured YouTuber:
          <div className={'featured-youtuber-name'}>
            <img className={'youtube-icon'} src={'assets/youtube-icon.png'}/>
            Fady!
          </div>
        </a>
        {
          this.state.stats && this.state.stats.bestOf &&
          <div className={'best-of'}>
            Top of the day:
            {/*Top of the:{' '}*/}
            {/*{['day','week','month'].map((dur, i) => <span>*/}
              {/*{i > 0 ? ' | ' : ''}*/}
              {/*<a*/}
                {/*className={classnames({*/}
                  {/*'best-of-dur': true,*/}
                  {/*'best-of-dur--selected': dur == this.state.dur*/}
                {/*})}*/}
                {/*href={'javascript: void 0'}*/}
                {/*onClick={() => this.setState({dur})}*/}
              {/*>{dur}</a>*/}
            {/*</span>)}*/}
            <ul className={'best-of-list'}>
              {this.state.stats.bestOf[this.state.dur].map(rec => <li>{rec.size} - {rec.name}</li>)}
            </ul>
          </div>
        }
      </div>
    </div>;
  }
}

export function renderSplash({onSubmit, shown, browserSupported, stats}: SplashProps) {
  return new Promise<Splash>((resolve) =>
    ReactDOM.render(
      <Splash onSubmit={onSubmit} shown={shown} ref={resolve} stats={stats} browserSupported={browserSupported}/>,
      document.getElementById('mount-point')
    )
  );
}