'use strict';

module.exports = function($done) {
  var path = require('path');

  require(path.resolve(__dirname, 'models/realtime-service.js'))();

  $done();
};
