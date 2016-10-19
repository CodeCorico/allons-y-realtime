'use strict';

module.exports = [{
  event: 'update(real-time/events)',
  controller: function($RealTimeService, $socket, $message) {
    $RealTimeService.updateEvents($socket, $message);
  }
}, {
  event: 'update(real-time/events.call)',
  controller: function($RealTimeService, $socket, $message) {
    $RealTimeService.callEvents($socket, $message);
  }
}];
