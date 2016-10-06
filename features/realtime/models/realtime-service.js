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
          _url = null;

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

          var UserModel = DependencyInjection.injector.service.get('UserModel');

          UserModel.fromSocket($socket, function(err, user) {
            if (err) {
              return;
            }

            _flushSocketPermissions($socket, user, function() {
              $socket.emit('read(real-time/events)', {
                success: true
              });

              if (args.directCalls) {
                if (!Array.isArray(args.directCalls)) {
                  args.directCalls = [args.directCalls];
                }

                args.directCalls.forEach(function(directCall) {
                  directCall = _formatEventFromString(directCall);

                  Object.keys(_events).forEach(function(eventName) {
                    if (directCall.origin == eventName && _events[eventName].call) {
                      _events[eventName].call($socket, directCall.name, directCall.args);
                    }
                  });
                });
              }
            });
          });
        }
      );

      function _flushSocketPermissions(socket, user, callback) {
        socket.realTimeEvents = socket.realTimeEvents || [];

        if (!user) {
          var GroupModel = DependencyInjection.injector.service.get('GroupModel');

          GroupModel.unknownPermissions(function(permissions) {
            socket.realTimeEvents.forEach(function(event) {
              event.hasPermission = true;

              if (event.permissions) {
                for (var i = 0; i < event.permissions.length; i++) {
                  if (permissions.permissions.indexOf(event.permissions[i]) < 0) {
                    event.hasPermission = false;

                    break;
                  }
                }
              }
            });

            callback();
          });

          return;
        }

        socket.realTimeEvents.forEach(function(event) {
          event.hasPermission = !event.permissions || user.hasPermissions(event.permissions) || false;
        });

        callback();
      }

      this.registerEvents = function(events) {
        extend(true, _events, events);
      };

      function _eventsFromSocket(type, eventName, socket, events) {
        for (var i = 0; i < socket.realTimeEvents.length; i++) {
          if (socket.realTimeEvents[i][type] == eventName) {
            events.push(extend(true, {
              socket: socket
            }, socket.realTimeEvents[i]));

            break;
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

      this.fire = function(eventName, args, $socket) {
        var $SocketsService = DependencyInjection.injector.service.get('$SocketsService'),
            isMultipartArgs = Array.isArray(args);

        if ($socket) {
          _fireSocket($socket, eventName, args, isMultipartArgs);
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
