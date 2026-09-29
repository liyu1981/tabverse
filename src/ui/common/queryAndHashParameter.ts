export function getQueryParameters(): { [k: string]: string } {
  const result = {};
  const locationSearch: string = window.location.search;
  locationSearch
    .substr(1)
    .split('&')
    .forEach((item: string) => {
      const tmp = item.split('=');
      result[tmp[0]] = tmp[1];
    });
  return result;
}
