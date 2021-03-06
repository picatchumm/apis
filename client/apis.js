;(function(e,t,n,r){function i(r){if(!n[r]){if(!t[r]){if(e)return e(r);throw new Error("Cannot find module '"+r+"'")}var s=n[r]={exports:{}};t[r][0](function(e){var n=t[r][1][e];return i(n?n:e)},s,s.exports)}return n[r].exports}for(var s=0;s<r.length;s++)i(r[s]);return i})(typeof require!=="undefined"&&require,{1:[function(require,module,exports){
"use strict";
var apis = require('../../lib/client');


var parentRequire = window.require;
window.require = function (id) {
	return id == 'apis' ? apis : parentRequire(id);
};

},{"../../lib/client":2}],2:[function(require,module,exports){
"use strict";
var errors = require('./errors');
var Http = require('./http');
var HttpRequest = require('./http_request');
var JsonpRequest = require('./jsonp_request');
var Socket = require('./socket');


module.exports = {
	errors: errors,
	Http: Http,
	HttpRequest: HttpRequest,
	JsonpRequest: JsonpRequest,
	Socket: Socket
};

},{"./errors":3,"./http":4,"./http_request":5,"./jsonp_request":6,"./socket":7}],4:[function(require,module,exports){
"use strict";
var HttpAdapter = require('../node_client/http_adapter');
var WebError = require('./errors').WebError;
var HttpRequest = require('./http_request');
var JsonpRequest = require('./jsonp_request');
var errors = require('./errors');


var Http = function (opt_baseUri, opt_options) {
	this.baseUri = opt_baseUri;
	this.options = opt_options || {};
	this.adapter = null;
};

Http.prototype.setAdapter = function (adapter) {
	this.adapter = adapter;
};

Http.prototype.send = function (path, method, headers, data, options, cb) {
	this.ensureAdapter();
	var result;
	if (options == null || options.crossDomain == null) {
		result = this.sendHttp(path, method, headers, data, options, cb);
	}
	else {
		switch (options.crossDomain) {
			case 'jsonp':
				result = this.sendJsonp(path, method, headers, data, options, cb);
				break;
			default:
				throw new Error('Unsupported crossDomain option ' + options.crossDomain);
		}
	}
	return result;
};

// internal

Http.prototype.ensureAdapter = function () {
	if (this.adapter == null) {
		this.adapter = this.createAdapter(this.options.adapter);
	}
};

Http.prototype.createAdapter = function (opt_options) {
	return new HttpAdapter(opt_options);
};

Http.prototype.sendHttp = function (path, method, headers, data, options, cb) {
	var req = this.adapter.createRequestData(this.baseUri, path, method, headers, data, options);
	var self = this;
	return HttpRequest.send(req, options, function (err, result) {
		self.handleHttpResult(err, result, options, cb);
	});
};

Http.prototype.sendJsonp = function (path, method, headers, data, options, cb) {
	var url = this.adapter.createRequestUrl(this.baseUri, path, method, headers, data, options);
	var self = this;
	return JsonpRequest.send(url, options, function (err, result) {
		self.handleResult(err, result, options, cb);
	});
};

Http.prototype.handleHttpResult = function (err, httpResult, options, cb) {
	var result;
	if (err == null) {
		result = this.adapter.parseResponseData(httpResult.status, httpResult.headers, httpResult.body, options);
	}
	this.handleResult(err, result, options, cb);
};

Http.prototype.handleResult = function (err, result, options, cb) {
	if (err == null) {
		err = WebError.extract(result);
	}
	if (err != null) {
		cb(err);
	}
	else {
		cb(err, result);
	}
};


module.exports = Http;

},{"../node_client/http_adapter":8,"./errors":3,"./http_request":5,"./jsonp_request":6}],5:[function(require,module,exports){
"use strict";
var NetworkError = require('./errors').NetworkError;


var HttpRequest = function (opt_options) {
	this.isAborted = false;
	this.xhr = null;
	this.cb = null;
};

HttpRequest.prototype.send = function (req, cb) {
	this.cb = cb;
	var xhr = new XMLHttpRequest();
	this.xhr = xhr;
	var self = this;
	xhr.onreadystatechange = function() {
		if(xhr.readyState == 4) {
			xhr.onreadystatechange = null;
			if (!self.isAborted) {
				self.handleResult();
			}
		}
	};
	xhr.open(req.method, req.url);
	for (var k in req.headers) {
		xhr.setRequestHeader(k, req.headers[k]);
	}
	xhr.send(req.body);
};

HttpRequest.prototype.abort = function () {
	this.isAborted = true;
	this.xhr.onreadystatechange = null;
	this.xhr.abort();
};

HttpRequest.prototype.handleResult = function () {
	var xhr = this.xhr;
	if (!xhr.status) {
		this.cb(new NetworkError());
	}
	else {
		this.cb(null, {
			status: xhr.status,
			headers: {
				get: function (k) {
					return xhr.getResponseHeader(k);
				}
			},
			body: xhr.responseText
		});
	}
};

HttpRequest.send = function (req, options, cb) {
	var instance = new HttpRequest(options);
	instance.send(req, cb);
	return instance;
};


module.exports = HttpRequest;

},{"./errors":3}],6:[function(require,module,exports){
"use strict";
var NetworkError = require('./errors').NetworkError;


var JsonpRequest = function (opt_options) {
	var options = opt_options || {};
	this.callbackUrlKey = options.callbackUrlKey || this.defaultCallbackUrlKey;

	this.callbacks = this.getCallbacks();

	this.cb = null;
	this.scriptEl = null;
	this.callbackId = null;
};

JsonpRequest.prototype.callbacksGlobalPath = 'apis.jsonp.callbacks';
JsonpRequest.prototype.defaultCallbackUrlKey = 'callback';

JsonpRequest.prototype.getCallbacks = function () {
	if (JsonpRequest.callbacks == null) {
		var parts = this.callbacksGlobalPath.split('.');
		var curr = window;
		for (var i = 0; i < parts.length; i++) {
			var part = parts[i];
			var next = curr[part] || {};
			curr[part] = next;
			curr = next;
		}
		JsonpRequest.callbacks = curr;
	}
	return JsonpRequest.callbacks;
};

JsonpRequest.prototype.send = function (url, cb) {
	this.cb = cb;
	this.initCallback();
	url = this.addCallbackToUrl(url);
	this.injectScript(url);
};

JsonpRequest.prototype.initCallback = function () {
	var self = this;
	this.callbackId = this.createCallbackId();
	this.callbacks[this.callbackId] = function (result) {
		if (!self.isAborted) {
			self.cleanup();
			self.handleResult(result);
		}
	};
};

JsonpRequest.prototype.createCallbackId = function () {
	var base = 'cb' + (new Date().getTime());
	var i = 0;
	var result = base;
	while (result in this.callbacks) {
		result = base + '_' + (i++);
	}
	return result;
};

JsonpRequest.prototype.addCallbackToUrl = function (url) {
	var pos = url.indexOf('?');
	var result;
	if (pos < 0) {
		result = [
			url, '?',
			this.callbackUrlKey, '=', this.createCallbackName()
		].join('');
	}
	else {
		result = [
			url.substr(0, pos + 1),
			this.callbackUrlKey, '=', this.createCallbackName(),
			'&', url.substr(pos + 1)
		].join('');
	}
	return result;
};

JsonpRequest.prototype.createCallbackName = function () {
	return [this.callbacksGlobalPath, '.', this.callbackId].join('');
};

JsonpRequest.prototype.createScript = function () {
	var el = document.createElement('script');
	el.async = true;
	var self = this;
	el.onerror = function (ev) {
		self.handleScriptErrorEvent(ev);
	};
	return el;
};

JsonpRequest.prototype.injectScript = function (url) {
	var scriptEl = this.createScript();
	this.scriptEl = scriptEl;

	var head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
	var firstChild = head.firstChild;
	if (firstChild) {
		head.insertBefore(scriptEl, head.firstChild);
	}
	else {
		head.appendChild(scriptEl);
	}

	scriptEl.src = url;
};

JsonpRequest.prototype.handleScriptErrorEvent = function (ev) {
	if (!this.isAborted) {
		this.cleanup();
		this.cb(new NetworkError());
	}
};

JsonpRequest.prototype.abort = function () {
	this.isAborted = true;
	this.cleanup();
};

JsonpRequest.prototype.cleanup = function () {
	this.removeCallback();
	this.removeScripEl();
};

JsonpRequest.prototype.removeCallback = function () {
	delete this.callbacks[this.callbackId];
};

JsonpRequest.prototype.removeScripEl = function () {
	var scriptEl = this.scriptEl;
	if (scriptEl != null && scriptEl.parentNode) {
		scriptEl.parentNode.removeChild(scriptEl);
		this.scriptEl = null;
	}
};

JsonpRequest.prototype.handleResult = function (result) {
	var headers = result.headers || {};
	result.headers = headers;
	result.status = headers.status;
	this.cb(null, result);
};

JsonpRequest.send = function (url, options, cb) {
	var instance = new JsonpRequest(options);
	instance.send(url, cb);
	return instance;
};


module.exports = JsonpRequest;

},{"./errors":3}],7:[function(require,module,exports){
"use strict";
var errors = require('./errors');


var Socket = function (opt_basePath, opt_socketUri, opt_protocols) {
	this.basePath = opt_basePath;
	this.socketUri = opt_socketUri || this.defaultSocketUri;
	this.protocols = opt_protocols;

	this.onSocketCreated = null;
	this.onMessage = null;

	this.webSocketClass = WebSocket;

	this.socket = null;
	this.requests = {};

	this.abortFunc = this.createAbortFunc();
};

Socket.prototype.defaultSocketUri = '/socket';
Socket.prototype.headerSeparator = '\n\n';
Socket.prototype.defaultTimeout = null;

Socket.prototype.setWebSocketClass = function (c) {
	this.webSocketClass = c;
};

Socket.prototype.createAbortFunc = function () {
	var self = this;
	return function () {
		self.handleAbort(this);
	};
};

Socket.prototype.createSocket = function () {
	var WebSocketClass = this.webSocketClass;
	return new WebSocketClass(this.socketUri, this.protocols);
};

Socket.prototype.connect = function (opt_cb) {
	if (this.socket != null) {
		switch (this.socket.readyState) {
			case 0: // connecting
				if (opt_cb) {
					this.socket.addEventListener('open', function () {
						opt_cb();
					});
				}
				break;
			case 1: // open
				if (opt_cb) {
					opt_cb();
				}
				break;
			default: // closing or closed
				this.socket = null;
		}
	}
	if (this.socket == null) {
		this.socket = this.createSocket();

		if (this.onSocketCreated) {
			this.onSocketCreated(this.socket);
		}

		if (opt_cb) {
			this.socket.addEventListener('open', function () {
				opt_cb();
			});
		}

		var self = this;
		this.socket.addEventListener('message', function (ev) {
			self.handleMessage(ev);
		});

		this.socket.addEventListener('close', function (ev) {
			self.handleClose(ev);
		});
	}
};

Socket.prototype.handleMessage = function (ev) {
	var result = this.parse(ev.data);
	var requestId = (result.headers != null ? result.headers.requestId : null);
	if (requestId != null) {
		var request = this.requests[requestId];
		if (request) {
			var cb = request.cb;
			this.clearRequest(request, requestId);
			var err = errors.WebError.extract(result);
			if (err != null) {
				cb(err);
			}
			else {
				cb(null, result);
			}
		}
	}
	else if (this.onMessage != null) {
		this.onMessage(result);
	}
};

Socket.prototype.createRequestId = function () {
	var base = '' + (new Date().getTime());
	var i = 0;
	var result = base;
	while (result in this.requests) {
		result = base + '_' + (i++);
	}
	return result;
};

Socket.prototype.clearRequest = function (request) {
	delete this.requests[request.id];
	var timeout = request.timeout;
	if (timeout != null) {
		clearTimeout(timeout);
	}
};

Socket.prototype.close = function () {
	if (this.socket != null) {
		this.socket.close();
	}
};

Socket.prototype.send = function (path, method, headers, data, opt_options, opt_cb) {
	var self = this;
	this.connect(function () {
		self.sendInternal(path, method, headers, data, opt_options, opt_cb);
	});
};

Socket.prototype.sendInternal = function (path, method, headers, data, opt_options, opt_cb) {
	headers = headers || {};

	headers.method = method;
	headers.path = this.getEffectivePath(path);

	var request;
	if (opt_cb) {
		request = this.createRequest(opt_options, opt_cb);
		headers.requestId = request.id;
	}

	var body;
	if (data === undefined) {
		body = '';
	}
	else {
		body = JSON.stringify(data);
	}

	var msg = [
		JSON.stringify(headers),
		body
	].join(this.headerSeparator);

	this.socket.send(msg);
	return request;
};

Socket.prototype.getEffectivePath = function (path) {
	var result = path;
	if (this.basePath) {
		result = this.basePath + path;
	}
	return result;
};

Socket.prototype.createRequest = function (options, cb) {
	var requestId = this.createRequestId();
	var request = {
		id: requestId,
		cb: cb,
		options: options,
		abort: this.abortFunc
	};
	request.timeout = this.createTimeout(request);
	this.requests[requestId] = request;
	return request;
};

Socket.prototype.createTimeout = function (request) {
	var options = request.options;
	var result = null;
	var timeout = (options != null && options.timeout != null ? options.timeout : this.defaultTimeout);
	if (timeout != null) {
		var self = this;
		result = setTimeout(function () {
			self.handleTimeout(request);
		}, timeout);
	}
	return result;
};

Socket.prototype.handleTimeout = function (request) {
	var cb = request.cb;
	this.clearRequest(request);
	cb(new errors.TimeoutError());
};

Socket.prototype.handleAbort = function (request) {
	this.clearRequest(request);
};

Socket.prototype.handleClose = function (ev) {
	for (var k in this.requests) {
		var request = this.requests[k];
		var cb = request.cb;
		this.clearRequest(request);
		cb(new errors.ConnectionCloseError(ev));
	}
};

Socket.prototype.parse = function (message) {
	var sepPos = message.indexOf(this.headerSeparator);
	var headersStr = message.substring(0, sepPos);
	var body = message.substring(sepPos + this.headerSeparator.length);

	var headers = JSON.parse(headersStr);

	var result = {
		headers: headers,
		data: this.parseBody(body)
	};

	if (headers.status != null) {
		result.status = headers.status;
	}

	return result;
};

Socket.prototype.parseBody = function (body) {
	var result;
	if (body) {
		result = JSON.parse(body);
	}
	return result;
};


module.exports = Socket;

},{"./errors":3}],3:[function(require,module,exports){
"use strict";
var inherits = require('inh');
var ErrorBase = require('nerr/lib/error_base');
var WebError = require('../node_client/web_error');


var NetworkError = function () {
	ErrorBase.call(this);
};
inherits(NetworkError, ErrorBase);

NetworkError.prototype.name = 'NetworkError';


var TimeoutError = function () {
	ErrorBase.call(this);
};
inherits(TimeoutError, ErrorBase);

TimeoutError.prototype.name = 'TimeoutError';


var ConnectionCloseError = function (closeEvent) {
	ErrorBase.call(this);
	this.closeEvent = closeEvent;
};
inherits(ConnectionCloseError, ErrorBase);

ConnectionCloseError.prototype.name = 'ConnectionCloseError';

ConnectionCloseError.prototype.getMessage = function () {
	return this.closeEvent.reason;
};


module.exports = {
	WebError: WebError,
	NetworkError: NetworkError,
	TimeoutError: TimeoutError,
	ConnectionCloseError: ConnectionCloseError
};

},{"../node_client/web_error":9,"nerr/lib/error_base":10,"inh":11}],11:[function(require,module,exports){
"use strict";
var inherits;

if (typeof Object.create === 'function') {
	// implementation from standard node.js 'util' module
	inherits = function(ctor, superCtor) {
		ctor.super_ = superCtor;
		ctor.prototype = Object.create(superCtor.prototype, {
			constructor: {
				value: ctor,
				enumerable: false,
				writable: true,
				configurable: true
			}
		});
	};
}
else {
	// old school shim for old browsers
	inherits = function(ctor, superCtor) {
		ctor.super_ = superCtor;
		var TempCtor = function () {};
		TempCtor.prototype = superCtor.prototype;
		ctor.prototype = new TempCtor();
		ctor.prototype.constructor = ctor;
	};
}

module.exports = inherits;

},{}],9:[function(require,module,exports){
"use strict";
var inherits = require('inh');
var ErrorBase = require('nerr/lib/error_base');


var WebError = function (response) {
	this.response = response;

	this.status = response.status;
	var data = response.data || {};
	this._message = data.message;
	this.status = response.status;
	this.code = data.code;
};
inherits(WebError, ErrorBase);

WebError.prototype.name = 'WebError';

WebError.prototype.getMessage = function () {
	return this._message;
};

WebError.extract = function (result) {
	var status = result.status;
	var err = null;
	if (status != 200 && status != 204) {
		err = new WebError(result);
	}
	return err;
};


module.exports = WebError;

},{"nerr/lib/error_base":10,"inh":11}],8:[function(require,module,exports){
"use strict";
var ops = require('ops');


var HttpAdapter = function (opt_options) {
	this.options = ops.cloneWithDefaults(opt_options, this.getDefaultOptions());
};

HttpAdapter.prototype.getDefaultOptions = function () {
	return {
		transform: {
			headers: {
				req: {
					method: 'X-Method',
					contentType: 'Content-type',
					auth: {
						token: 'X-Auth',
						expected: 'X-AuthExpected'
					}
				},
				res: {
					renewal: {
						token: 'X-AuthRenewal',
						issued: 'X-AuthRenewalIssued',
						maxAge: 'X-AuthRenewalMaxAge'
					}
				}
			},
			url: {
				headers: 'headers',
				body: 'body'
			}
		},
		defaultContentType: 'application/json'
	};
};

HttpAdapter.prototype.createRequestData = function (base, path, method, headers, data, options) {
	var httpMethod = this.createMethod(method, options);
	var body = this.createBody(data, options);

	var hasBody = body && this.canHaveBody(httpMethod, options);
	var httpHeaders = this.createHeaders(method, headers, hasBody, options);

	var urlParts = null;
	if (!hasBody && body) {
		urlParts = {
			body: body
		};
		body = null;
	}

	var url = this.createUrl(base, path, urlParts, options);

	return {
		url: url,
		method: httpMethod,
		headers: httpHeaders,
		body: body
	};
};

HttpAdapter.prototype.createRequestUrl = function (base, path, method, headers, data, options) {
	if (method != 'get') {
		headers = headers || {};
		headers.method = method;
	}
	return this.createUrl(base, path, {
		headers: this.stringifyHeaders(headers, options),
		body: this.createBody(data, options)
	}, options);
};

HttpAdapter.prototype.parseResponseData = function (status, headers, body, options) {
	if (headers.constructor === Object) {
		headers = {
			get: function (k) {
				return headers[k];
			}
		};
	}
	return {
		status: status,
		headers: this.parseHeaders(headers, options),
		data: this.parseBody(body, options)
	};
};

// internal

// create

HttpAdapter.prototype.canHaveBody = function (httpMethod, options) {
	return httpMethod != 'GET' && httpMethod != 'HEAD';
};

HttpAdapter.prototype.createUrl = function (base, path, urlParts, options) {
	var result = [base, path];
	if (urlParts != null) {
		var query = this.createQuery(urlParts, options);
		if (query) {
			result.push('?', query);
		}
	}
	return result.join('');
};

HttpAdapter.prototype.createMethod = function (method, options) {
	return ({
		get: 'GET',
		head: 'HEAD',
		options: 'OPTIONS'
	}[method]) || 'POST';
};

HttpAdapter.prototype.createQuery = function (urlParts, options) {
	var result = [];
	var urlKeys = this.options.transform.url;
	for (var k in urlParts) {
		var part = urlParts[k];
		if (part) {
			var urlKey = urlKeys[k];
			if (urlKey) {
				result.push(this.createQueryItem(urlKeys[k], part));
			}
		}
	}
	return result.length > 0 ? result.join('&') : null;
};

HttpAdapter.prototype.createQueryItem = function (k, v) {
	return [k, encodeURIComponent(v)].join('=');
};

HttpAdapter.prototype.createHeaders = function (method, headers, hasBody, options) {
	headers = headers || {};
	var result = {};
	if (headers.http) {
		for (var k in headers.http) {
			result[k] = headers.http[k];
		}
	}
	var keys = this.options.transform.headers.req;
	if (method != 'get' && method != 'head' && method != 'create' && method != 'options') {
		result[keys.method] = method;
	}
	this.applyHeaders(keys, result, headers, options);
	if (hasBody && !headers[keys.contentType]) {
		result[keys.contentType] = this.options.defaultContentType;
	}
	return result;
};

HttpAdapter.prototype.applyHeaders = function (keys, httpHeaders, headers, options) {
	if (headers.contentType) {
		httpHeaders[keys.contentType] = headers.contentType;
	}
	if (headers.auth != null) {
		this.applyAuthHeaders(keys.auth, httpHeaders, headers.auth, options);
	}
};

HttpAdapter.prototype.applyAuthHeaders = function (keys, httpHeaders, authHeaders, options) {
	if (authHeaders.token) {
		httpHeaders[keys.token] = authHeaders.token;
		if (authHeaders.expected) {
			httpHeaders[keys.expected] = authHeaders.expected;
		}
	}
};

HttpAdapter.prototype.stringifyHeaders = function (headers, options) {
	var result = null;
	if (headers != null) {
		var http = headers.http;
		if (http) {
			delete headers.http;
		}
		result = JSON.stringify(headers);
		if (http) {
			headers.http = http;
		}
	}
	return result;
};

HttpAdapter.prototype.createBody = function (data, options) {
	var result;
	if (data !== undefined) {
		result = JSON.stringify(data);
	}
	return result;
};

// parse

HttpAdapter.prototype.parseHeaders = function (headers, options) {
	var result = {};
	var keys = this.options.transform.headers.res;
	var renewal = this.parseRenewalHeaders(keys.renewal, headers, options);
	if (renewal) {
		result.renewal = renewal;
	}
	return result;
};

HttpAdapter.prototype.parseRenewalHeaders = function (keys, headers, options) {
	var result = null;
	var token = headers.get(keys.token);
	if (token) {
		result = {
			token: token
		};
		var issued = parseInt(headers.get(keys.issued), 10);
		if (!isNaN(issued)) {
			result.issued = issued;
		}
		var maxAge = parseInt(headers.get(keys.maxAge), 10);
		if (!isNaN(maxAge)) {
			result.maxAge = maxAge;
		}
	}
	return result;
};

HttpAdapter.prototype.parseBody = function (body) {
	return body ? JSON.parse(body) : undefined;
};


module.exports = HttpAdapter;

},{"ops":12}],12:[function(require,module,exports){
"use strict";
var Ops = function () {
};

Ops.prototype.isDict = function (v) {
	return v != null && v.constructor === Object;
};

Ops.prototype.defines = function (v, k) {
	return v[k] !== undefined;
};

Ops.prototype.applyDefaults = function (options, defaults, opt_cloneDefaults) {
	var result;
	if (options == null) {
		if (opt_cloneDefaults) {
			defaults = this.clone(defaults);
		}
		result = defaults;
	}
	else {
		result = options;
		if (defaults != null) {
			for(var k in defaults) {
				var defaultsValue = defaults[k];
				if (this.defines(options, k)) {
					if (this.isDict(defaultsValue)) {
						var optionsValue = options[k];
						if (this.isDict(optionsValue)) {
							this.applyDefaults(optionsValue, defaultsValue);
						}
					}
				}
				else {
					if (opt_cloneDefaults) {
						defaultsValue = this.clone(defaultsValue);
					}
					options[k] = defaultsValue;
				}
			}
		}
	}
	return result;
};

Ops.prototype.clone = function (v) {
	return this.cloneValueWithDefaults(v);
};

Ops.prototype.cloneWithDefaults = function (options, defaults, opt_cloneDefaults) {
	var result;
	if (options == null) {
		if (opt_cloneDefaults) {
			result = this.clone(defaults);
		}
		else {
			result = defaults;
		}
	}
	else {
		result = this.cloneValueWithDefaults(options, defaults, opt_cloneDefaults);
	}
	return result;
};

Ops.prototype.cloneValueWithDefaults = function (v, defaults, opt_cloneDefaults) {
	if (v != null) {
		if (this.isDict(v)) {
			v = this.cloneDictWithDefaults(v, defaults, opt_cloneDefaults);
		} else if (Array.isArray(v)) {
			v = this.cloneArray(v);
		}
		// WARN assuming no user types can be here
	}
	return v;
};

Ops.prototype.cloneDict = function (v) {
	return this.cloneDictWithDefaults(v);
};

Ops.prototype.cloneDictWithDefaults = function (v, defaults, opt_cloneDefaults) {
	var result = {};
	var k;
	if (!this.isDict(defaults)) {
		defaults = null;
	}
	for (k in v) {
		var defaultsValue;
		if (defaults != null && k in defaults) {
			defaultsValue = defaults[k];
		}
		result[k] = this.cloneValueWithDefaults(v[k], defaultsValue, opt_cloneDefaults);
	}
	if (defaults != null) {
		for (k in defaults) {
			if (!this.defines(v, k)) {
				result[k] = opt_cloneDefaults ? this.clone(defaults[k]) : defaults[k];
			}
		}
	}
	return result;
};

Ops.prototype.cloneArray = function (v) {
	var result = [];
	for (var i = 0; i < v.length; i++) {
		result.push(this.clone(v[i]));
	}
	return result;
};

var ops = new Ops();
ops.Ops = Ops;

var result = {
	applyDefaults: function (options, defaults, opt_cloneDefaults) {
		return ops.applyDefaults(options, defaults, opt_cloneDefaults);
	},
	cloneWithDefaults: function (options, defaults, opt_cloneDefaults) {
		return ops.cloneWithDefaults(options, defaults, opt_cloneDefaults);
	},
	clone: function (v) {
		return ops.clone(v);
	}
};


module.exports = result;

},{}],10:[function(require,module,exports){
"use strict";
var inherits = require('inh');


var ErrorBase = function () {
	Error.call(this);
	this.captureStackTrace();
};
inherits(ErrorBase, Error);

ErrorBase.prototype.name = 'ErrorBase';

ErrorBase.prototype.captureStackTrace = function () {
	if (Error.captureStackTrace) {
		Error.captureStackTrace(this, this.constructor);
	}
	else {
		var stackKeeper = new Error();
		var self = this;
		stackKeeper.toString = function () { return self.toString(); };
		var getStackTrace = function () {
			return stackKeeper.stack;
		};

		if (Object.defineProperties) {
			Object.defineProperties({
				stack: getStackTrace
			});
		}
		else {
			this.getStackTrace = getStackTrace;
		}
	}
};

ErrorBase.prototype.toString = function () {
	var result = this.name;
	var message = this.getMessage();
	if (message) {
		result = [result, message].join(': ');
	}
	return result;
};

ErrorBase.prototype.getMessage = function () {
	return null;
};

ErrorBase.prototype.getStackTrace = function () {
	return this.stack;
};

if (Object.defineProperties) {
	Object.defineProperties(ErrorBase.prototype, {
		message: {
			get: function () {
				return this.getMessage();
			}
		}
	});
}


module.exports = ErrorBase;

},{"inh":13}],13:[function(require,module,exports){
"use strict";
var inherits;

if (typeof Object.create === 'function') {
	// implementation from standard node.js 'util' module
	inherits = function(ctor, superCtor) {
		ctor.super_ = superCtor;
		ctor.prototype = Object.create(superCtor.prototype, {
			constructor: {
				value: ctor,
				enumerable: false,
				writable: true,
				configurable: true
			}
		});
	};
}
else {
	// old school shim for old browsers
	inherits = function(ctor, superCtor) {
		ctor.super_ = superCtor;
		var TempCtor = function () {};
		TempCtor.prototype = superCtor.prototype;
		ctor.prototype = new TempCtor();
		ctor.prototype.constructor = ctor;
	};
}

module.exports = inherits;

},{}]},{},[1])
;