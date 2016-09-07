'use strict';

module.exports = [{
  event: 'update(real-time/events)',
  controller: function($RealTimeService, $socket, $message) {
    $RealTimeService.updateEvents($socket, $message);
  }
}];
