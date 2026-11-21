const ORIGIN = 'https://foodhub.on2go.ca';

function isHubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === ORIGIN && !url.username && !url.password;
  } catch {
    return false;
  }
}

module.exports = { ORIGIN, isHubUrl };
