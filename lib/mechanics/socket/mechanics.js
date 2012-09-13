"use strict";
var inherits = require('util').inherits;
var EventEmitter = require('events').EventEmitter;
var Ctx = require('../../ctx');
var Transport = require('./transport');
var Request = require('./request');
var Response = require('../core/response');


var Mechanics = function(lib) {
	EventEmitter.call(this);

	this.lib = lib; // expecting sockjs

	this.units = null;

	this.server = null;
	this.handler = null;

	this.prefix = null;

	this.transport = this.createTransport();
};
inherits(Mechanics, EventEmitter);

Mechanics.prototype.isHttp = false;
Mechanics.prototype.isWebSocket = true;

Mechanics.prototype.unitInit = function (units) {
	this.units = units;

	var settings = units.require('core.settings');
	var coreSettings = settings.core;
	this.handler = units.require('core.handler');

	if (coreSettings.socket && !coreSettings.socket.disable) {
		var web = units.requireInited('core.mechanics.web');
		var logging = units.require('core.logging');

		this.server = this.lib.createServer();
		this.configure(web, logging, this.getSocketPrefix(coreSettings));
	}
};

Mechanics.prototype.getSocketPrefix = function (coreSettings) {
	var prefix = coreSettings.prefix;
	var socketPrefix = coreSettings.socket.prefix;
	return prefix ? prefix + socketPrefix : socketPrefix;
};

Mechanics.prototype.configure = function(web, logging, socketPrefix) {
	var server = this.server;

	var options = this.server.options;
	options.prefix = socketPrefix;

	var logger = logging.getLogger('sockjs');
	options.log = function (severity, msg) {
		logger.log(severity, msg);
	};

	var self = this;
	server.on('connection', function (connection) {
		self.onConnect(connection);

		connection.on('data', function (message) {
			self.onMessage(connection, message);
		});

		connection.on('close', function () {
			self.onDisconnect(connection);
		});
	});

	server.installHandlers(web.server);
};

Mechanics.prototype.createTransport = function() {
	return new Transport();
};

Mechanics.prototype.onConnect = function(connection) {
	this.emit('connect', connection);
};

Mechanics.prototype.onDisconnect = function(connection) {
	this.emit('disconnect', connection);
};

Mechanics.prototype.onMessage = function(connection, message) {
	this.emit('message', connection, message);

	if (this.handler == null) {
		throw new Error('No handler set for socket mechanics');
	}

	var req = new Request(connection, this.transport.decode(message));
	var res = new Response(this);

	var ctx = new Ctx(this, req, res);

	if (ctx.subPath(this.prefix)) {
		this.handler.handle(ctx);
	}
};

Mechanics.prototype.sendResult = function(ctx, result) {
	this.transport.sendResult(ctx.req, ctx.res, result);
};


module.exports = Mechanics;