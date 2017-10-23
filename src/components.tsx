import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {Component} from "react";
import * as classnames from 'classnames';

interface SplashState {
  name: string;
  shown: boolean;
  disabled: boolean;
  char: string;
}

interface SplashProps {
  onSubmit: (name: string, char: string) => void;
  shown: boolean;
}

export class Splash extends React.Component {
  state: SplashState;
  props: SplashProps;
  inputEl: HTMLInputElement;
  chars = [
    'white',
    'red',
    'yellow',
    'green'
  ];
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
      char: this.chars[0]
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
    setTimeout(() => this.inputEl.focus(), 100);
  }
  show() {
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
  render() {
    return <div className='splash' style={{display: this.state.shown ? undefined : 'none'}}>
      <h1>Bounce<span className="io">.io</span></h1>
      <form className='splash-form' onSubmit={this.handleSubmit}>
        <input
          className={'name-input'}
          ref={(el) => this.inputEl = el}
          value={this.state.name}
          onChange={this.handleChange}
          placeholder={'Enter a nickname'}
          autoFocus={true}
          disabled={this.state.disabled}
        />
        <br/>
        <div className={'gallery'}>{
          this.chars.map(char =>
            <div className={classnames({
              'gallery-item': true,
              'gallery-item--selected': this.state.char == char
            })}>
              <a href={"#"} onMouseDown={() => this.chooseChar(char)}>
                <img className='gallery-img' src={`dist/assets/player-${char}.png`}/>
              </a>
            </div>
          )
        }</div>
        <br/>
        <button
          className={'submit-btn'}
          type={'submit'}
          disabled={this.state.disabled}>Play!</button>
      </form>
    </div>;
  }
}

export function renderSplash({onSubmit, shown}: SplashProps) {
  return new Promise<Component>((resolve) =>
    ReactDOM.render(
      <Splash onSubmit={onSubmit} shown={shown} ref={resolve}/>,
      document.getElementById('mount-point')
    )
  );
}