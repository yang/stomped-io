import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as classnames from 'classnames';
import {Chance} from 'chance';
import {clearArray, maxNameLen, playerStyles, Stats} from "./common";
import * as Cookies from 'js-cookie';

interface SplashState {
  name: string;
  shown: boolean;
  disabled: boolean;
  char: string;
  charToVariants: any;
  stats: Stats;
  unlocked: boolean;
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

const basicStyleBases = [
  'plain'
];

function isBasicStyle(char: string) {
  for (let sty of basicStyleBases) {
    if (char.indexOf(sty) == 0) {
      return true;
    }
  }
  return false;
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
  chars = playerStyles;
  afterUpdates = [];
  constructor(props) {
    super(props);
    if (0/1) {
      for (let i = 0; i < 2; i++) {
        this.chars = this.chars.concat(this.chars);
      }
    }
    this.state = {
      name: '',
      shown: props.shown,
      disabled: false,
      char: new Chance().pickone(this.chars.slice(0,3)),
      charToVariants: null,
      stats: props.stats,
      unlocked: ((Cookies.getJSON('v1') || {}) as StoredState).unlocked
    };
  }
  private handleChange = (e) => {
    this.setState({name: e.target.value});
  };
  private handleSubmit = (e) => {
    e.preventDefault();
    this.setState({disabled: true});
    this.props.onSubmit(this.state.name, this.state.char);
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
    this.afterUpdates.push(this.scrollToChar);
    this.setState({shown: true, disabled: false});
    document.getElementById('mount-point').style.display = '';
  }
  hide() {
    this.setState({shown: false});
    document.getElementById('mount-point').style.display = 'none';
  }
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
    Cookies.set('v1', {unlocked: true} as StoredState);
    window.location.href = url;
  };
  render() {
    const isSupported = this.props.browserSupported;
    return <div className='splash' style={{display: this.state.shown ? undefined : 'none'}}>
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
            return <a
              key={char}
              ref={el => this.galleryItemEls.set(char, el)}
              className={classnames({
                'gallery-item': true,
                'gallery-item--disabled': !this.state.unlocked && !isBasicStyle(char),
                'gallery-item--selected': this.state.char == char
              })}
              title={'Share on Facebook or Twitter to unlock - get your friends to play with you!'}
              onMouseDown={() => this.chooseChar(char)}
            >
              {/*<a*/}
                {/*href={"javascript: void 0"}*/}
                {/*className={classnames({*/}
                  {/*'gallery-link--disabled': !this.state.unlocked && !isBasicStyle(char)*/}
                {/*})}*/}
                {/*title={'Share on Facebook or Twitter to unlock - get your friends to play with you!'}*/}
                {/*onMouseDown={() => this.chooseChar(char)}*/}
              {/*>*/}
                <img className='gallery-img' src={imgSrc}/>
              {/*</a>*/}
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
      <div className={"more-io-games"}>
        <a href={"http://iogames.space/"} target={"_blank"}>More io Games</a>&nbsp;
        (<a href={"http://io-games.io/"} target={"_blank"}>And Even More</a>!)
      </div>
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