module.exports = function() {
  'use strict';

  DependencyInjection.service('$RealTimeService', ['$AbstractService', function($AbstractService) {

    return new (function $RealTimeService() {

      $AbstractService.call(this);

      var extend = this.isNode() ? require('extend') : null,
          $socket = !this.isNode() ? DependencyInjection.injector.service.get('$socket') : null,
          _this = this,
          _components = {},
          _eventsComponents = {},
          _events = [],
          _networkOn = true,
          _lastEvents = null,
          _url = null,
          _hooks = {};

      function _formatEventFromString(eventString) {
        var event = {
          origin: null,
          name: eventString,
          args: eventString.split(':')
        };

        event.origin = event.args.shift();

        return event;
      }

      function _fireUrl(events) {
        if (!events) {
          return;
        }

        if (events && !Array.isArray(events)) {
          events = [events];
        }

        events.forEach(function(event) {
          if (!event.url) {
            return;
          }

          event.url(_url);
        });
      }

      this.url = function(newUrl) {
        newUrl = newUrl || '/';
        if (newUrl.length > 1 && newUrl.substr(newUrl.length - 1, 1) == '/') {
          newUrl = newUrl.substr(0, newUrl.length - 1);
        }

        if (_url == newUrl) {
          return;
        }

        _url = newUrl;

        Object.keys(_eventsComponents).forEach(function(componentName) {
          _eventsComponents[componentName].forEach(function(actions) {
            if (!actions.url) {
              return;
            }

            actions.url(_url);
          });
        });
      };

      this.realtimeComponent = function(componentName, events, directCalls, callback) {
        if (!componentName) {
          return;
        }

        if (events && !Array.isArray(events)) {
          events = [events];
        }

        _components[componentName] = events || [];

        _this.updateEvents(directCalls, callback);

        _fireUrl(events);
      };

      this.unregisterComponent = function(componentName, callback) {
        if (!componentName || !_components[componentName]) {
          return;
        }

        delete _components[componentName];

        _this.updateEvents(null, callback);
      };

      function _callEvents($socket, events) {
        if (!Array.isArray(events)) {
          events = [events];
        }

        events.forEach(function(event) {
          event = _formatEventFromString(event);

          Object.keys(_events).forEach(function(eventName) {
            if (event.origin == eventName && _events[eventName].call) {
              _events[eventName].call($socket, event.name, event.args, function() {});
            }
          });
        });
      }

      this.fireEvent = function(eventOrigin, eventName, $socket, args, callback) {
        eventName = eventName || eventOrigin;

        if (!_events[eventOrigin] || !_events[eventOrigin].call) {
          return;
        }

        callback = callback || function() {};

        _events[eventOrigin].call($socket, eventName, args, callback);
      };

      this.callEvents = this.methodFrontBack(

        // front
        function(events) {
          if (!events) {
            return;
          }

          $socket.emit('update(real-time/events.call)', {
            events: events
          });
        },

        // back
        function($socket, args) {
          if (!args || typeof args != 'object' || !args.events) {
            return;
          }

          _callEvents($socket, args.events);
        }
      );

      this.updateEvents = this.methodFrontBack(

        // front
        function(directCalls, callback) {
          _eventsComponents = {};

          var events = [];

          Object.keys(_components).forEach(function(componentName) {
            _components[componentName].forEach(function(event) {
              if (event.name) {
                event.names = [event.name];
              }

              event.names.forEach(function(eventName) {
                _eventsComponents[eventName] = _eventsComponents[eventName] || [];
                _eventsComponents[eventName].push({
                  update: event.update || null,
                  network: event.network || null,
                  url: event.url || null
                });

                if (events.indexOf(eventName) < 0) {
                  events.push(eventName);
                }
              });
            });
          });

          if (callback) {
            $socket.once('read(real-time/events)', function(args) {
              callback(args);
            });
          }

          var eventsStringified = JSON.stringify(events);

          if (eventsStringified == _lastEvents) {
            return;
          }

          _lastEvents = eventsStringified;

          $socket.emit('update(real-time/events)', {
            directCalls: directCalls || null,
            events: events
          });
        },

        // back
        function($socket, args) {
          if (!args || typeof args != 'object' || !args.events || !Array.isArray(args.events)) {
            return;
          }

          $socket.realTimeEvents = [];

          args.events.forEach(function(event) {
            if (!event || typeof event != 'string') {
              return;
            }

            event = _formatEventFromString(event);

            if (!event.origin || !_events[event.origin]) {
              return;
            }

            var permissions = _events[event.origin].permissions ?
              _events[event.origin].permissions.map(function(permission) {
                if (!event.args || !event.args.length) {
                  return permission;
                }

                event.args.forEach(function(arg, index) {
                  permission = permission.replace('{{args' + index + '}}', arg);
                });

                return permission;
              }) : null;

            $socket.realTimeEvents.push({
              origin: event.origin,
              name: event.name,
              args: event.args,
              permissions: permissions,
              hasPermission: true
            });
          });

          _this.hooks.fire('updateEvents', {
            socket: $socket
          }, function() {
            $socket.emit('read(real-time/events)', {
              success: true
            });

            if (args.directCalls) {
              _callEvents($socket, args.directCalls);
            }
          });
        }
      );

      this.hooks = {
        add: function(eventName, func) {
          _hooks[eventName] = _hooks[eventName] || [];
          _hooks[eventName].push(func);
        },

        remove: function(eventName, func) {
          _hooks[eventName] = _hooks[eventName] || [];

          for (var i = _hooks[eventName].length - 1; i >= 0; i--) {
            if (_hooks[eventName][i] == func) {
              _hooks[eventName].splice(i, 1);
            }
          }

          if (!_hooks[eventName].length) {
            delete _hooks[eventName];
          }
        },

        fire: function(eventName, args, callback, i) {
          i = i || 0;

          if (!_hooks[eventName] || !_hooks[eventName].length || _hooks[eventName].length >= i) {
            return callback();
          }

          _hooks[eventName](args, function() {
            _this.hooks.fire(eventName, args, callback, i++);
          });
        }
      };

      this.registerModelEvents = function(model, events) {
        Object.keys(events).forEach(function(eventName) {
          if (events[eventName].call) {
            var call = events[eventName].call;

            events[eventName].call = function() {
              model[call].apply(model, arguments);
            };
          }
        });

        _this.registerEvents(events);
      },

      this.registerEvents = function(events) {
        extend(true, _events, events);
      };

      function _eventsFromSocket(type, eventName, socket, events) {
        for (var i = 0; i < socket.realTimeEvents.length; i++) {
          if (socket.realTimeEvents[i][type] == eventName) {
            events.push(extend(true, {
              socket: socket
            }, socket.realTimeEvents[i]));
          }
        }
      }

      function _eventsFrom(type, eventName, $socket) {
        var $SocketsService = DependencyInjection.injector.service.get('$SocketsService'),
            events = [];

        if ($socket) {
          _eventsFromSocket(type, eventName, $socket, events);
        }
        else {
          $SocketsService.each(function(socket) {
            if (!socket || !socket.user || !socket.realTimeEvents || !socket.realTimeEvents.length) {
              return;
            }

            _eventsFromSocket(type, eventName, socket, events);
          });
        }

        return events;
      }

      function _socketsFrom(type, eventName, args) {
        var $SocketsService = DependencyInjection.injector.service.get('$SocketsService'),
            sockets = [];

        $SocketsService.each(function(socket) {
          if (!socket || !socket.user || !socket.realTimeEvents || !socket.realTimeEvents.length) {
            return;
          }

          for (var i = 0; i < socket.realTimeEvents.length; i++) {
            if (socket.realTimeEvents[i][type] == eventName) {
              var push = true;

              if (args && socket.realTimeEvents[i].args) {
                for (var j = 0; j < args.length; j++) {
                  if (args[j] && args[j] != socket.realTimeEvents[i].args[j]) {
                    push = false;

                    break;
                  }
                }
              }

              if (push) {
                sockets.push(socket);

                break;
              }
            }
          }
        });

        return sockets;
      }

      this.eventsFromName = function(eventName, $socket) {
        return _eventsFrom('name', eventName, $socket);
      };

      this.eventsFromOrigin = function(eventName, $socket) {
        return _eventsFrom('origin', eventName, $socket);
      };

      this.socketsFromName = function(eventName) {
        return _socketsFrom('name', eventName);
      };

      this.socketsFromOrigin = function(eventName, args) {
        return _socketsFrom('origin', eventName, args);
      };

      this.eventNamesFromCount = function(eventOrigin, argsIndex, $socket, argsConditions) {
        if ($socket) {
          return null;
        }

        var result = {
              maxCount: 0,
              eventNames: {}
            },
            events = this.eventsFromOrigin(eventOrigin);

        if (!$socket && (!events || !events.length)) {
          return false;
        }

        events.forEach(function(event) {
          if (argsConditions) {
            for (var i = 0; i < argsConditions.length; i++) {
              if (argsConditions[i] !== null) {
                if (event.args[i] != argsConditions[i]) {
                  return;
                }
              }
            }
          }

          if (result.maxCount != 'all') {
            if (event.args[argsIndex] == 'all') {
              result.maxCount = 'all';
            }
            else {
              result.maxCount = event.args[argsIndex] > result.maxCount ? event.args[argsIndex] : result.maxCount;
            }
          }

          var eventName = eventOrigin;

          for (var i = 0; i < event.args.length; i++) {
            eventName += ':' + event.args[i];
          }

          if (!result.eventNames[eventName]) {
            result.eventNames[eventName] = {
              count: event.args[argsIndex],
              args: event.args,
              sockets: [event.socket]
            };
          }
          else {
            result.eventNames[eventName].sockets.push(event.socket);
          }
        });

        result.maxCount = result.maxCount == 'all' ? null : result.maxCount;

        return result;
      };

      function _fireSocket(socket, eventName, args, isMultipartArgs) {
        socket.realTimeEvents = socket.realTimeEvents || [];

        for (var i = 0; i < socket.realTimeEvents.length; i++) {
          if (socket.realTimeEvents[i].name == eventName) {
            if (socket.realTimeEvents[i].hasPermission) {
              var eventArgs = {
                realTimeEvent: eventName,
                realTimeArgs: isMultipartArgs ? {} : args || null
              };

              if (isMultipartArgs) {
                for (var j = 0; j < args.length; j++) {
                  if (!args[j].permissions || socket.user.hasPermissions(args[j].permissions)) {
                    extend(true, eventArgs.realTimeArgs, args[j].data);
                  }
                }
              }

              socket.emit('read(real-time/event)', eventArgs);
            }

            break;
          }
        }
      }

      this.socketHasEvent = function(socket, eventName) {
        socket.realTimeEvents = socket.realTimeEvents || [];

        for (var i = 0; i < socket.realTimeEvents.length; i++) {
          if (socket.realTimeEvents[i].name == eventName) {
            return true;
          }
        }

        return false;
      };

      this.userSocketsWithEvent = function(userId, eventName) {
        var $SocketsService = DependencyInjection.injector.service.get('$SocketsService', true),
            sockets = [];

        if (!$SocketsService) {
          return sockets;
        }

        $SocketsService.each(function(socket) {
          if (socket && socket.user && socket.user.id == userId && _this.socketHasEvent(socket, eventName)) {
            sockets.push(socket);
          }
        });

        return sockets;
      };

      this.fire = function(eventName, args, sockets) {
        var $SocketsService = DependencyInjection.injector.service.get('$SocketsService', true),
            isMultipartArgs = Array.isArray(args);

        if (!$SocketsService) {
          return;
        }

        if (sockets) {
          sockets = Array.isArray(sockets) ? sockets : [sockets];

          sockets.forEach(function(socket) {
            _fireSocket(socket, eventName, args, isMultipartArgs);
          });
        }
        else {
          $SocketsService.each(function(socket) {
            if (!socket || !socket.user || !socket.realTimeEvents || !socket.realTimeEvents.length) {
              return;
            }

            _fireSocket(socket, eventName, args, isMultipartArgs);
          });
        }
      };

      function _updateNetwork(reload) {
        Object.keys(_eventsComponents).forEach(function(componentName) {
          _eventsComponents[componentName].forEach(function(actions) {
            if (!actions.network) {
              return;
            }

            actions.network(_networkOn);
          });
        });

        if (reload) {
          var directCalls = [];

          Object.keys(_components).forEach(function(componentName) {
            _components[componentName].forEach(function(event) {
              if (event.name) {
                event.names = [event.name];
              }

              event.names.forEach(function(name) {
                if (directCalls.indexOf(name) < 0) {
                  directCalls.push(name);
                }
              });
            });
          });

          _lastEvents = null;

          _this.updateEvents(directCalls);
        }
      }

      if (!this.isNode()) {
        $socket.on('read(real-time/event)', function(args) {
          if (!args || !args.realTimeEvent || !_eventsComponents[args.realTimeEvent]) {
            return;
          }

          _eventsComponents[args.realTimeEvent].forEach(function(actions) {
            if (!actions.update) {
              return;
            }

            actions.update(args.realTimeEvent, args.realTimeArgs);
          });
        });

        $socket.on('disconnect', function() {
          _networkOn = false;

          _updateNetwork();
        });

        $socket.on('reconnectSigned', function() {
          _networkOn = true;

          _updateNetwork(true);
        });
      }

    })();

  }]);

};
