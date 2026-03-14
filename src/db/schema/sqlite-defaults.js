const SQLITE_DEFAULTS = {
  epochSeconds: "(strftime('%s', 'now'))",
  epochMilliseconds: "(strftime('%s','now')*1000)",
  oneHourFromNowMilliseconds: "((strftime('%s','now')*1000) + 3600000)"
};

module.exports = {
  SQLITE_DEFAULTS
};
