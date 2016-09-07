'use strict';

var path = require('path');

require(path.resolve(__dirname, '../models/realtime-service.js'))();

module.exports = [{
  event: 'update(real-time/events)',
  controller: function($RealTimeService, $socket, $message) {
    $RealTimeService.updateEvents($socket, $message);
  }
}];
