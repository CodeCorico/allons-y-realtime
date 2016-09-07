'use strict';

var path = require('path');

require(path.resolve(__dirname, 'models/realtime-service.js'))();

module.exports = function($done) {
  $done();
};
