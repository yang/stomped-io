import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {Component} from "react";
import * as classnames from 'classnames';
import {Chance} from 'chance';
import {clearArray, maxNameLen, playerStyles} from "./common";

interface SplashState {
  name: string;
  shown: boolean;
  disabled: boolean;
  char: string;
  charToVariants: any
}

interface SplashProps {
  onSubmit: (name: string, char: string) => void;
  shown: boolean;
}

export class Splash extends React.Component {
  state: SplashState;
  props: SplashProps;
  inputEl: HTMLInputElement;
  galleryEl: HTMLDivElement;
  galleryItemEls = new Map<string, HTMLDivElement>();
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
      charToVariants: null
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
    setTimeout(() => this.inputEl.focus(), 10);
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
    this.setState({char});
  };
  scrollToChar = () => {
    const item = this.galleryItemEls.get(this.state.char);
    this.galleryEl.scrollLeft = item.offsetLeft - this.galleryEl.offsetLeft - this.galleryEl.clientWidth / 2 + item.clientWidth / 2;
  };
  setImgs(mapping) {
    this.afterUpdates.push(this.scrollToChar);
    this.setState({charToVariants: mapping});
  }
  render() {
    return <div className='splash' style={{display: this.state.shown ? undefined : 'none'}}>
      <h1>Stomped<span className="io">.io</span></h1>
      <p className={'subhead'}>
        Use your mouse to steer your character through the low-gravity arena!
        <br/>
        Collect stars to grow bigger.
        <br/>
        Stomp other players to get their stars.
        <br/>
        Don't get stomped!
      </p>
      <form className='splash-form' onSubmit={this.handleSubmit}>
        <input
          className={'name-input'}
          ref={(el) => this.inputEl = el}
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
            return <div
              key={char}
              ref={el => this.galleryItemEls.set(char, el)}
              className={classnames({
                'gallery-item': true,
                'gallery-item--selected': this.state.char == char
              })}
            >
              <a href={"#"} onMouseDown={() => this.chooseChar(char)}>
                <img className='gallery-img' src={this.state.charToVariants[charBase][+variant][0].src}/>
              </a>
            </div>;
          })
        }</div>
        <br/>
        <button
          className={'submit-btn'}
          type={'submit'}
          disabled={!this.state.charToVariants || this.state.disabled || this.state.name.trim() == ''}>Play!</button>
      </form>
    </div>;
  }
}

export function renderSplash({onSubmit, shown}: SplashProps) {
  return new Promise<Splash>((resolve) =>
    ReactDOM.render(
      <Splash onSubmit={onSubmit} shown={shown} ref={resolve}/>,
      document.getElementById('mount-point')
    )
  );
}