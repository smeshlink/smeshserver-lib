(function(window) {
var
	_host = '/api/',
	_version = '1.0',
	_dataType = 'xml',
	
	basicAuth = function(username, password) {
		var tok = username + ':' + password;
		var hash = window.btoa(tok);
		return "Basic " + hash;
	},
	
	coerceToLocal = function(date) {
		return new Date(
			date.getUTCFullYear(),
			date.getUTCMonth(),
			date.getUTCDate(),
			date.getUTCHours(),
			date.getUTCMinutes(),
			date.getUTCSeconds(),
			date.getUTCMilliseconds()
		);
	},

	fromDateTime8601 = function(str, utcMode) {
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
	
	smeshserver = function (host, dataType) {
		this.host = host || _host;
		this.dataType = dataType || _dataType;
	};

smeshserver.prototype = {
	version: _version,
	username: undefined,
	password: undefined,
	
	fromDateTime8601: function(str) {
		return fromDateTime8601(str);
	},
	
	ajax: function(url, options) {
		if (typeof url === 'object') {
			options = url;
			url = undefined;
		} else {
			options = options || {};
			options.url = url;
		}
		
		var user = options.username || this.username;
		var pwd = options.password || this.password;
		
		var opt = {};
		opt.type = options.type;
		opt.dataType = options.dataType || this.dataType;
		opt.url = options.url + '.' + opt.dataType;
		opt.data = {};
		opt.data.duration = options.duration;
		opt.data.n = options.n;
		opt.data.p = options.p;
		
		opt.beforeSend= function(xhr) {
			if (user && pwd)
				xhr.setRequestHeader('Authorization', basicAuth(user, pwd));
		};
		return $.ajax(opt);
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
		smeshserver.username = smeshserver.password = undefined;
	},
	
	listFeeds: function(creator, done, fail, options) {
		if (typeof creator === 'object') {
			options = creator;
			creator = options.creator;
		} else {
			options = options || {};
		}
		options.type = 'GET';
		options.url = (options.host || this.host) + 'feeds';
		this.ajax(options)
			.done(function(data) {
				done && done(formatters[options.dataType || this.dataType].parseFeeds(data));
			}).fail(fail);
	},
	
	findFeed: function(path, done, fail, options) {
		if (typeof path === 'object') {
			options = path;
			path = options.path;
		} else {
			options = options || {};
		}
		options.type = 'GET';
		options.url = (options.host || this.host) + (path || 'feeds');
		this.ajax(options)
			.done(function(data) {
				done && done(formatters[options.dataType || this.dataType].parseFeed(data));
			}).fail(function(jqXHR, textStatus, errorThrown) {
				(404 == jqXHR.status) ? (done && done())
					: (fail && fail(jqXHR, textStatus, errorThrown));
			});
	}
};

window.smeshserver = smeshserver;
window.ms = new smeshserver();

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

})(window);