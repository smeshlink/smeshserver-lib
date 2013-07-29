/*!
 * Misty JavaScript Library v1.0.1
 *
 * Copyright 2009, 2013 SmeshLink Technology Co., Ltd.
 * Released under the MIT license
 *
 * Date: 2013-3-12
 */
var Misty = (function($, WebSocket) {
"use strict";

var
	// Set your own API Key here or by calling setApiKey()
	ApiKey = '',
	
	// Or you may use the username/password authentication
	Username = 'smeshlink',
	Password = 'smeshlink',
	
	// Remote API server
	ApiEndPoint = 'http://www.smeshlink.com/misty/api/',
	WebSocketServer = 'ws://127.0.0.1:9007',
	
	// The default data type
	ApiDataType = 'json',
	
	version = '1.0.1',
	
	// helpers
	
	basicAuth = function(user, pwd) {
		return "Basic " + window.btoa(user + ':' + pwd);
	},
	
	log = function (msg) {
		if (window.console && window.console.log) {
			window.console.log(msg);
		}
	},
	
	execute = function(arr) {
		if (typeof arr === 'function') {
			arr.apply(this, Array.prototype.slice.call(arguments, 1));
		} else if (Object.prototype.toString.apply(arr) === '[object Array]') {
			var x = arr.length;
			while (x--) {
				arr[x].apply(this, Array.prototype.slice.call(arguments, 1));
			}
		}
	},
	
	coerceToLocal = function(date) {
		return new Date(
			date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
			date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(),
			date.getUTCMilliseconds()
		);
	},

	fromDateTime8601 = function(str, utcMode) {
		if (typeof str === 'number')
			return new Date(str * 1000);
		var m = str.match(/^(\d{4})(-(\d{2})(-(\d{2})([T ](\d{2}):(\d{2})(:(\d{2})(\.(\d+))?)?(Z|(([-+])(\d{2})(:?(\d{2}))?))?)?)?)?$/);
		if (m) {
			var d = new Date(Date.UTC(
				m[1],
				m[3] ? m[3] - 1 : 0,
				m[5] || 1,
				m[7] || 0,
				m[8] || 0,
				m[10] || 0,
				m[12] ? Number('0.' + m[12]) * 1000 : 0
			));
			if (m[13]) { // has gmt offset or Z
				if (m[14]) { // has gmt offset
					d.setUTCMinutes(
						d.getUTCMinutes() +
						(m[15] == '-' ? 1 : -1) * (Number(m[16]) * 60 + (m[18] ? Number(m[18]) : 0))
					);
				}
			} else { // no specified timezone
				if (!utcMode) {
					d = coerceToLocal(d);
				}
			}
			return d;
		}
	},
	
	/* formatters */
	
	formatters = {
		'xml': (function() {
			var
				getInnerText = function(node) {
					if ('#text' == node.nodeName)
						return node.nodeValue;
					else if (node.childNodes.length > 0)
						return node.childNodes[0].nodeValue;
				},

				getChildElement = function(node) {
					for (var i = 0; i < node.childNodes.length; i++) {
						if (node.childNodes[i].nodeName != "#text")
							return node.childNodes[i];
					}
					return null;
				},
				
				parseKey = function(node) {
					var at = node.getAttribute('at');
					return at ? fromDateTime8601(at) : node.getAttribute('key');
				},

				parseValue = function(node) {
					var val;
					
					if ('value' == node.tagName || 'array' == node.tagName) {
						val = parseValue(getChildElement(node));
					} else if ('number' == node.tagName || 'integer' == node.tagName) {
						val = Number(node.childNodes[0].nodeValue);
					} else if ('string' == node.tagName) {
						val = node.childNodes.length > 0 ? node.childNodes[0].nodeValue : '';
					} else if ('base64' == node.tagName) {
						// TODO decode bytes
					} else if ('struct' == node.tagName) {
						val = {};
						for (var i = 0; i < node.childNodes.length; i++) {
							var child = node.childNodes[i];
							if ('member' == child.nodeName) {
								var mName, mValue;
								for (var j = 0; j < child.childNodes.length; j++) {
									var n = child.childNodes[j];
									if ('name' == n.nodeName)
										mName = n.childNodes[0].nodeValue;
									else if ('value' == n.nodeName)
										mValue = parseValue(n);
								}
								val[mName] = mValue;
							}
						}
					} else if ('data' == node.tagName) {
						val = [];
						for (var i = 0; i < node.childNodes.length; i++) {
							if (node.childNodes[i].nodeName != "#text") {
								var tmp = parseValue(node.childNodes[i]);
								if (tmp)
									val.push(tmp);
							}
						}
					}
					
					return val;
				},

				parseFeedNode = function(feedNode) {
					if ('feed' != feedNode.tagName)
						return;
					var feed = {};
					for (var i = 0; i < feedNode.childNodes.length; i++) {
						var node = feedNode.childNodes[i];
						if ('name' == node.tagName)
							feed.name = getInnerText(node);
						else if ('created' == node.tagName)
							feed.created = fromDateTime8601(getInnerText(node));
						else if ('updated' == node.tagName)
							feed.updated = fromDateTime8601(getInnerText(node));
						else if ('children' == node.tagName) {
							feed.children = [];
							for (var j = 0; j < node.childNodes.length; j++) {
								var child = parseFeedNode(node.childNodes[j]);
								if (child)
									feed.children.push(child);
							}
						} else if ('current' == node.tagName) {
							feed.current = parseValue(getChildElement(node));
						} else if ('data' == node.tagName) {
							feed.data = [];
							for (var j = 0; j < node.childNodes.length; j++) {
								var entry = node.childNodes[j];
								if ('entry' == entry.tagName) {
									var value = parseValue(getChildElement(entry));
									if (value != undefined)
										feed.data.push({ key: parseKey(entry), value: value });
								}
							}
						}
					}
					return feed;
				},
				
				f = function() {
				};

			f.prototype = {
				parseFeeds: function(doc) {
					var feeds = [];
					var nodes = doc.documentElement.childNodes;
					for (var i = 0; i < nodes.length; i++) {
						if ('feed' == nodes[i].tagName) {
							var feed = parseFeedNode(nodes[i]);
							if (feed)
								feeds.push(feed);
						}
					}
					return feeds;
				},
				parseFeed: function(doc) {
					var feeds = this.parseFeeds(doc);
					return feeds.length > 0 ? feeds[0] : null;
				}
			};
			
			return new f();
		})(),
		'json': {
			parseFeeds: function(data) {
				var ret = data.results || [];
				ret.totalResults = data.totalResults;
				ret.startIndex = data.startIndex;
				ret.itemsPerPage = data.itemsPerPage;
				return ret;
			},
			parseFeed: function(data) {
				return $.isArray(data.results) ? (data.results.length > 0 ? data.results[0] : null) : data;
			}
		}
	},
	
	/* Misty object */
	
	Misty = function(apikey, endpoint, datatype) {
		this.apiKey = apikey || ApiKey;
		this.endpoint = endpoint || ApiEndPoint;
		this.dataType = datatype || ApiDataType;
		this.username = Username;
		this.password = Password;
		
		var misty = this;
		this.feed = {
			list: function(creator, options, done, fail) {
				if (typeof creator === 'function') {
					done = creator;
					fail = options;
					creator = options = undefined;
				} else if (typeof creator === 'object') {
					fail = done;
					done = options;
					options = creator;
					creator = undefined;
				}
				
				misty.ajax({
					url  : misty.endpoint + (creator || 'feeds') + '.' + misty.dataType,
					data : options,
					done : function(data) {
						done && done(formatters[misty.dataType].parseFeeds(data));
					},
					fail : function(jqXHR, textStatus, errorThrown) {
						(404 == jqXHR.status) ? (done && done())
							: (fail && fail(jqXHR, textStatus, errorThrown));
					}
				});
			},
			find: function(creator, feed, options, done, fail) {
				if (typeof feed != 'string') {
					fail = done;
					done = options;
					options = feed;
					feed = creator;
					creator = undefined;
					if (typeof options === 'function') {
						fail = done;
						done = options;
						options = undefined;
					}
				}
				
				misty.ajax({
					url  : misty.endpoint + (creator || 'feeds') + '/' + feed + '.' + misty.dataType,
					data : options,
					done : function(data) {
						done && done(formatters[misty.dataType].parseFeed(data));
					},
					fail : function(jqXHR, textStatus, errorThrown) {
						(404 == jqXHR.status) ? (done && done())
							: (fail && fail(jqXHR, textStatus, errorThrown));
					}
				});
			},
			update: function(feed, data, callback) {
				misty.ajax({
					type   : 'PUT',
					url  : misty.endpoint + 'feeds/' + feed + '.' + misty.dataType,
					data : data,
					always : callback
				});
			},
			'new': function(data, callback) {
				misty.ajax({
					type   : 'POST',
					url    : misty.endpoint + 'feeds',
					data   : data,
					always : callback
				});
			},
			'delete': function(feed, callback) {
				misty.ajax({
					type   : 'DELETE',
					url    : misty.endpoint + 'feeds/' + feed,
					data   : data,
					always : callback
				});
			}
		};
		
		this.entry = {
			find: function() {
			}
		};
		
		this.ws = {
			socket      : false,
			socketReady : false,
			queue       : [],
			resources   : [],
			
			connect: function(callback) {
				var ws = this;
				if (!this.socket && WebSocket) {
					this.socket = new WebSocket(WebSocketServer);
					
					this.socket.onerror = function(e) {
						ws.error && ws.error(e, this);
						ws.connect();
					};
					
					this.socket.onclose = function(e) {
						ws.close && ws.close(e, this);
						ws.connect();
					};
					
					this.socket.onopen = function(e) {
						ws.socketReady = true;
						ws.open && ws.open(e, this);
						ws.queue.length && execute(ws.queue);
						callback && callback(this);
					};
					
					this.socket.onmessage = function(e) {
						var data = e.data;
						//log(data);
					};
				}
			},
			
			observe: function(resource, callback) {
				var ws = this;
				var request = {
					headers  : {},
					method   : 'observe',
					resource : resource
				};
				
				if (!this.resources[resource])
					this.resources.push(resource);
				
				if (this.socketReady) {
					this.socket.send(JSON.stringify(request));
				} else {
					this.connect();
					this.queue.push(function() {
						ws.socket.send(JSON.stringify(request));
					});
				}
				
				callback;
			},
			
			unobserve: function(resource) {
				var request = {
					headers  : {},
					method   : 'unobserve',
					resource : resource
				};
				if (this.socketReady) {
					this.socket.send(JSON.stringify(request));
				}
			}
		};
	};

Misty.prototype = {
	fromDateTime8601: function(str) {
		return fromDateTime8601(str);
	},
	
	setApiKey: function(newKey) {
		this.apiKey = newKey;
	},
	
	setEndPoint: function(newEndPoint) {
		this.endpoint = newEndPoint;
	},
	
	signIn: function(user, pwd, done, fail) {
		if (typeof user === 'function') {
			done = user;
			user = undefined;
		}
		if (typeof pwd === 'function') {
			fail = pwd;
			pwd = undefined;
		}
		
		if (user || pwd) {
			this.username = user;
			this.password = pwd;
		} else {
			// auto login
			this.username = this.password = undefined;
		}
		
		/*this.ajax({
			type: 'GET',
			url: 'http://127.0.0.1:8080/api/user'
		}).done(function(data) {
			
		}).fail(function(jqXHR, textStatus) {
			fail && fail();
		});*/
		done && done();
	},
	
	signOut: function() {
		this.username = this.password = undefined;
	},
	
	ajax: function(options) {
		options = $.extend({
			type: 'GET'
		}, options);
		
		if (!options.url)
			return;
		
		var headers = {};
		if (this.username && this.password)
			headers['Authorization'] = basicAuth(this.username, this.password);
		else if (this.apiKey)
			headers['X-ApiKey'] = this.apiKey;
		else
			return log('(MistyJS) :: WARN :: No API key :: Set your API key first before calling any method.');
		
		// TODO stringify options.data
		
		$.ajax({
			url         : options.url,
			type        : options.type,
			headers     : headers,
			data        : options.data,
			dataType    : options.dataType || this.dataType,
			cache       : false
		})
		.done(options.done)
		.fail(options.fail)
		.always(options.always);
	}
};

return Misty;

})(jQuery, window.WebSocket || window.MozWebSocket);

var misty = new Misty();

if (typeof window.btoa == 'undefined' || typeof window.atob == 'undefined') {
	var Base64 = {
		// private property
		_keyStr : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",
	 
		// public method for encoding
		encode : function (input) {
			var output = "";
			var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
			var i = 0;
	 
			input = Base64._utf8_encode(input);
	 
			while (i < input.length) {
	 
				chr1 = input.charCodeAt(i++);
				chr2 = input.charCodeAt(i++);
				chr3 = input.charCodeAt(i++);
	 
				enc1 = chr1 >> 2;
				enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
				enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
				enc4 = chr3 & 63;
	 
				if (isNaN(chr2)) {
					enc3 = enc4 = 64;
				} else if (isNaN(chr3)) {
					enc4 = 64;
				}
	 
				output = output +
				this._keyStr.charAt(enc1) + this._keyStr.charAt(enc2) +
				this._keyStr.charAt(enc3) + this._keyStr.charAt(enc4);
	 
			}
	 
			return output;
		},
		
		decodeString : function (input) {
			var output = "";
			var out = Base64.decode(input);

			while (out.length > 0) {
				output += String.fromCharCode(out.shift());
			}

			output = Base64._utf8_decode(output);

			return output;
		},
	 
		// public method for decoding
		decode : function (input) {
			var out = Array();
			var chr1, chr2, chr3;
			var enc1, enc2, enc3, enc4;
			var i = 0;
	 
			input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
	 
			while (i < input.length) {
				enc1 = this._keyStr.indexOf(input.charAt(i++));
				enc2 = this._keyStr.indexOf(input.charAt(i++));
				enc3 = this._keyStr.indexOf(input.charAt(i++));
				enc4 = this._keyStr.indexOf(input.charAt(i++));
	 
				chr1 = (enc1 << 2) | (enc2 >> 4);
				chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
				chr3 = ((enc3 & 3) << 6) | enc4;
	 
				out.push(chr1);
				if (enc3 != 64)
					out.push(chr2)
				if (enc4 != 64)
					out.push(chr3);
			}
	 
			return out;
		},
	 
		// private method for UTF-8 encoding
		_utf8_encode : function (string) {
			string = string.replace(/\r\n/g,"\n");
			var utftext = "";
	 
			for (var n = 0; n < string.length; n++) {
	 
				var c = string.charCodeAt(n);
	 
				if (c < 128) {
					utftext += String.fromCharCode(c);
				}
				else if((c > 127) && (c < 2048)) {
					utftext += String.fromCharCode((c >> 6) | 192);
					utftext += String.fromCharCode((c & 63) | 128);
				}
				else {
					utftext += String.fromCharCode((c >> 12) | 224);
					utftext += String.fromCharCode(((c >> 6) & 63) | 128);
					utftext += String.fromCharCode((c & 63) | 128);
				}
	 
			}
	 
			return utftext;
		},
	 
		// private method for UTF-8 decoding
		_utf8_decode : function (utftext) {
			var string = "";
			var i = 0;
			var c = c1 = c2 = 0;
	 
			while ( i < utftext.length ) {
	 
				c = utftext.charCodeAt(i);
	 
				if (c < 128) {
					string += String.fromCharCode(c);
					i++;
				}
				else if((c > 191) && (c < 224)) {
					c2 = utftext.charCodeAt(i+1);
					string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
					i += 2;
				}
				else {
					c2 = utftext.charCodeAt(i+1);
					c3 = utftext.charCodeAt(i+2);
					string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
					i += 3;
				}
	 
			}
	 
			return string;
		}
	};
	window.btoa = function(input) { return Base64.encode(input); };
	window.atob = function(input) { return Base64.decode(input); };
}
