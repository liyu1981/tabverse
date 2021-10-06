try {
  if('function' === typeof importScripts) {
    importScripts('./assets/background.js');
  }
} catch (e) {
  console.error(e);
}
