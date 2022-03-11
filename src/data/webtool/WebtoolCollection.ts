import { Base, IBase } from '../common';

import { List } from 'immutable';

interface IWebTool extends IBase {
  name: string;
  description: string;
  url: string;
  favIconUrl: string;
}

export class WebToolCollection extends Base {
  tools: List<IWebTool>;

  constructor() {
    super();
    this.tools = List();
  }
}
