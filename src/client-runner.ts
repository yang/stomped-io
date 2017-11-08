import * as Client from './client';
import * as _ from 'lodash';

class GuiMgrStub {
  refresh() {}
}

Client.main(
  null,
  new GuiMgrStub(),
  _.noop,
  _.noop,
  () => ''
);