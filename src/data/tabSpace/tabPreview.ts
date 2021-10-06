import { action, makeObservable, observable } from 'mobx';

import { Map } from 'immutable';

export class TabPreview {
  previews: Map<number, string>;

  constructor() {
    makeObservable(this, {
      previews: observable,

      setPreview: action,
      removePreview: action,
    });
    this.previews = Map();
  }

  setPreview(tabId: number, previewData: string) {
    this.previews = this.previews.set(tabId, previewData);
  }

  removePreview(tabId: number) {
    this.previews = this.previews.remove(tabId);
  }

  getPreview(tabId: number) {
    return this.previews.has(tabId)
      ? this.previews.get(tabId)
      : 'https://dummyimage.com/500x280/ffffff/666666&text=Preview+Not+Yet+Generated';
  }
}
