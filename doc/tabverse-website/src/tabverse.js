module.exports = {
  GITHUB_URL_PREFIX:
    global.process &&
    global.process.env &&
    global.process.env.NODE_ENV === 'production'
      ? '/tabverse/'
      : '/',
};
