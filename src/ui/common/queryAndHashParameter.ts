export function getHashParameters(): { [k: string]: string } {
  const result = {};
  const locationHash: string = window.location.hash;
  locationHash
    .substr(1)
    .split('&')
    .forEach((item: string) => {
      const tmp = item.split('=');
      result[tmp[0]] = tmp[1];
    });
  return result;
}

export function getQueryParameters(): { [k: string]: string } {
  const result = {};
  const locationHash: string = window.location.search;
  locationHash
    .substr(1)
    .split('&')
    .forEach((item: string) => {
      const tmp = item.split('=');
      result[tmp[0]] = tmp[1];
    });
  return result;
}
