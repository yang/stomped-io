import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {Component} from "react";

interface SplashState {
  name: string;
  shown: boolean;
  disabled: boolean;
}

interface SplashProps {
  onSubmit: (name: string) => void;
  shown: boolean;
}

export class Splash extends React.Component {
  state: SplashState;
  props: SplashProps;
  constructor(props) {
    super(props);
    this.state = {
      name: '',
      shown: props.shown,
      disabled: false
    };
  }
  private handleChange = (e) => {
    this.setState({name: e.target.value});
  };
  private handleSubmit = (e) => {
    e.preventDefault();
    this.setState({disabled: true});
    this.props.onSubmit(this.state.name);
  };
  show() {
    this.setState({shown: true, disabled: false});
    document.getElementById('mount-point').style.display = '';
  }
  hide() {
    this.setState({shown: false});
    document.getElementById('mount-point').style.display = 'none';
  }
  render() {
    return <div className='splash' style={{display: this.state.shown ? undefined : 'none'}}>
      <h1>Bounce<span className="io">.io</span></h1>
      <form className='splash-form' onSubmit={this.handleSubmit}>
        <input
          className={'name-input'}
          value={this.state.name}
          onChange={this.handleChange}
          placeholder={'Enter a nickname'}
          autoFocus={true}
          disabled={this.state.disabled}
        />
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