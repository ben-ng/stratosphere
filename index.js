var fs = require('fs')
  , path = require('path')
  , url = require('url')
  , async = require('async')
  , _ = require('lodash')
  , pad = require('pad')
  , crypto = require('crypto')
  , mkdirp = require('mkdirp')
  , rimraf = require('rimraf')
  , http = require('http')
  , zlib = require('zlib')
  , request = require('request')
  , https = require('https')
  , defaults = {
      route: 'manifest.json'
    , noFlush: false
    , disable: false
    , manifestOpts: {}
    }
  , headerLengthLength = 10

function normalize (route) {
  if(route.charAt(0) != '/')
    return '/' + route
  else
    return route
}

function stripLeadingSlash (route) {
  if(route.charAt(0) != '/')
    return route
  else
    return route.slice(1)
}

function hash (route) {
  return crypto.createHash('md5')
                .update(new Buffer(route))
                .digest('hex')
}

function Stratosphere (app, useropts) {
  var opts = _.defaults(useropts, defaults)

  this.opts = opts
  this.app = app
  this.assetCache = {}
  this.assetArray = null
  this.assetMap = null
  this.onAssetsReadWaitlist = []
  this.assetsRead = false // set to true when assetArray is done

  // Do nothing if disabled
  if(!opts.disable) {
    if(!opts.root) { throw new Error('opts.root is required') }
    if(!opts.assets) { throw new Error('opts.assets is required') }

    this._initialize()
  }
}

/*
* Instance methods
*/
Stratosphere.prototype._initialize = function initialize () {
  var self = this
    , opts = this.opts

  async.waterfall([
    // read the assets JSON file
    function (next) {
      fs.readFile(opts.assets, function (err, data) {
        next(null, data)
      })
    }
    // turn the buffer into an array
  , function parseAssetFile (assetData, next) {
      var assetArray
        , parseError

      try {
        assetArray = JSON.parse(assetData.toString())
      }
      catch(e) {
        parseError = e
      }

      if(parseError) {
        try {
          assetArray = require(opts.assets)
        }
        catch(e) {
          return next(new Error('Could neither parse opts.assets as JSON nor require it as JS: ' + e))
        }
      }

      if(!_.isArray(assetArray))
        return next(new Error('opts.assets must export an array'))

      // turn shorthand into verbose
      assetArray = _.map(assetArray, function (asset) {
        if(typeof asset == 'string') {
          return {
            source: normalize(asset)
          , destination: stripLeadingSlash(asset)
          , key: stripLeadingSlash(asset)
          }
        }
        else {
          if(!asset.key) throw new Error('a verbose asset is missing a key')
          if(!asset.source) throw new Error('a verbose asset is missing a source')
          if(!asset.destination) throw new Error('a verbose asset is missing a destination')

          asset = _.clone(asset)
          asset.source = normalize(asset.source)
          return asset
        }
      })

      self.assetArray = assetArray
      self.assetMap = _(assetArray).map(function (asset) {return [asset.source, true]}).object().value()
      self.assetsRead = true

      _.each(self.onAssetsReadWaitlist, function (l) {
        l.apply(self)
      })

      self.onAssetsReadWaitlist = []

      next(null)
    }

  , function prepRoot (next) {
      if(opts.noFlush) {
        mkdirp(opts.root, function () {
          next(null)
        })
      }
      else {
        rimraf(opts.root, function () {
          mkdirp(opts.root, function () {
            next(null)
          })
        })
      }
    }

  ], function (err) {
    if (err)
      throw err
  })
}

Stratosphere.prototype.preload = function preload (cb) {
  var self = this

  this._readAllAssets(function (err, assets) {
    if(err)
      return cb(err)

    self.getManifest(function (err, manifest) {
      cb(err, assets, manifest)
    })
  })
}

Stratosphere.prototype._onAssetsRead = function _onAssetsRead(cb) {
  if(this.assetsRead)
    cb.apply(this)
  else
    this.onAssetsReadWaitlist.push(cb)
}

Stratosphere.prototype._readAllAssets = function readAllAssets (cb) {
  var self = this

  self._onAssetsRead(function () {
    // fetch each asset declared in the array
    async.mapSeries(self.assetArray
      , function (asset, next) {
          self._assetForRoute(asset.source, function (err, data) {
            if(err)
              return next(err)
            else
              return next(null, data)
          })
        }
      , function (err, assetPairs) {
      if(err)
        cb(err)
      else
        cb(null, _.object(assetPairs))
    })
  })
}

Stratosphere.prototype.writeAssets = function writeAssets (cb) {
  var opts = this.opts

  this._readAllAssets(function (err, assets) {
    if(err)
      return cb(err)

    assets = _.map(assets, function (data, route) { return [route, data] })

    function writeAsset (tuple, next) {

      var data = Buffer.isBuffer(tuple[1].data) ? tuple[1].data : new Buffer(tuple[1].data)
        , checksumBuffer = new Buffer(tuple[1].checksum)
        , headers = JSON.stringify(tuple[1].headers)
        , paddedHeaderLength = new Buffer(pad(headerLengthLength, '' + Buffer.byteLength(headers), '0'))
        , headerBuffer = new Buffer(headers)
        , assetData = Buffer.concat([checksumBuffer, paddedHeaderLength, headerBuffer, data])
        , routeHash = hash(normalize(tuple[0]))

      fs.writeFile(path.join(opts.root, routeHash), assetData, next)
    }

    function mapAsset (tuple) {
      return function (next) {
        writeAsset(tuple, next)
      }
    }

    async.series(_.map(assets, mapAsset), function (err) {
      cb(err)
    })
  })
}

// Taken from supertest
Stratosphere.prototype._appAddress = function () {
  var app = this.app
  var port = app.address().port
  var protocol = app instanceof https.Server ? 'https' : 'http'
  return protocol + '://0.0.0.0:' + port
}

Stratosphere.prototype._assetForRoute = function assetForRoute (route, cb) {
  route = normalize(route)

  var assetPath = path.join(this.opts.root, hash(route))
    , app = this.app
    , self = this
    , routeData

  if(this.assetCache[route]) {
    _.defer(function () {
      cb(null, [route, self.assetCache[route]])
    })
  }
  else {
    fs.readFile(assetPath, function (err, data) {
      if(err) {
        var makeRequest = function _makeRequest () {
          // try to get it from the route
          request({
            uri: self._appAddress() + route
          , gzip: true
          , encoding: null
          , headers: {'user-agent': 'stratosphere'}
          }, function (err, res, body) {
            var dataBuffer
              , checksum
              , headers

            if(err) {
              cb(err)
            }
            else {
              headers = _.clone(res.headers)

              if(typeof body == 'string')
                dataBuffer = new Buffer(body)
              else
                dataBuffer = body

              // do checksumming before gzipping the data
              checksum = crypto.createHash('md5')
                              .update(dataBuffer)
                              .digest('hex')

              headers['content-length'] = parseInt(headers['content-length'], 10)

              delete headers['content-encoding']

              routeData = {
                headers: headers
              , data: dataBuffer
              , checksum: checksum
              }

              self.assetCache[route] = routeData

              cb(null, [route, routeData])
            }
          })
        }
        if (!app.address()) {
          app.listen(0, makeRequest)
        }
        else {
          makeRequest()
        }
      }
      else {
        // decode the serialized asset
        var checksum = data.slice(0, 32).toString()
          , headerLength = parseInt(data.slice(32, headerLengthLength + 32).toString(), 10)
          , headers = data.slice(headerLengthLength + 32, headerLengthLength + headerLength + 32).toString()

        try {
          headers = JSON.parse(headers)
        }
        catch(e) {
          return cb(e)
        }

        headers['content-length'] = parseInt(headers['content-length'], 10)

        routeData = {
          headers: headers
        , data: data.slice(headerLengthLength + headerLength + 32)
        , checksum: checksum
        }

        self.assetCache[route] = routeData

        cb(null, [route, routeData])
      }
    })
  }
}

Stratosphere.prototype._hasAssetForRoute = function hasAssetForRoute (route, cb) {
  this._assetForRoute(route, function (err) {
    cb(err == null)
  })
}

Stratosphere.prototype._proxyHandler = function proxyHandler (handler) {
  var self = this
    , manifestRoute = self.opts.route ? normalize(self.opts.route) : false
    , clonedHeaders

  return function (req, res) {
    var href = url.parse(req.url).href

    if(manifestRoute && href == manifestRoute) {
      self._respondWithManifest(res)
    }
    else if(req.headers['user-agent'] && req.headers['user-agent'].indexOf('stratosphere') > -1) {
      handler(req, res)
    }
    else {
      self._onAssetsRead(function () {
        if(!self.assetMap[href]) {
          handler(req, res)
        }
        else {
          self._assetForRoute(href, function (err, asset) {
            if(err) {
              handler(req, res)
            }
            else {
              // if the client can accept gzipped data, do that
              if(req.headers['accept-encoding'] && req.headers['accept-encoding'].indexOf('gzip') > -1) {
                if(!asset[1].compressedData) {
                  zlib.gzip(asset[1].data, function (err, data) {
                    if(err) {
                      res.writeHead(500)
                      res.end('could not compress asset')
                    }
                    else {
                      clonedHeaders = JSON.parse(JSON.stringify(asset[1].headers))
                      clonedHeaders['content-encoding'] = 'gzip'
                      asset[1].compressedHeaders = clonedHeaders
                      asset[1].compressedData = data
                      res.writeHead(200, asset[1].compressedHeaders)
                      res.end(asset[1].compressedData)
                    }
                  })
                }
                else {
                  res.writeHead(200, asset[1].compressedHeaders)
                  res.end(asset[1].compressedData)
                }
              }
              else {
                res.writeHead(200, asset[1].headers)
                res.end(asset[1].data)
              }
            }
          })
        }
      })
    }
  }
}

Stratosphere.prototype.flush = function flush () {
  this.assetCache = {}
  this.defaultManifest = null
}

Stratosphere.prototype.intercept = function intercept () {
  var app = this.app
    , serverOrHandler = app

  if(this.opts.disable)
    return app

  if(serverOrHandler instanceof http.Server) {
    var handlers = serverOrHandler.listeners('request').slice(0)
      , replacementHandler

    replacementHandler = this._proxyHandler(function (req, res) {
      for(var i=0, ii=handlers.length; i<ii; ++i) {
        handlers[i].call(app, req, res)
      }
    })

    serverOrHandler.removeAllListeners('request')
    serverOrHandler.on('request', replacementHandler)

    return serverOrHandler
  }
  else {
    return this._proxyHandler(serverOrHandler)
  }
}

Stratosphere.prototype.getManifest = function getManifest (cb) {
  var opts = this.opts.manifestOpts

  this._getDefaultManifest(function (err, defaultManifest) {
    if(err)
      return cb(err)

    cb(null, _.defaults({}, opts, defaultManifest))
  })
}

Stratosphere.prototype._getDefaultManifest = function getDefaultManifest (cb) {
  var self = this

  if(this.defaultManifest) {
    _.defer(function () {
      cb(null, self.defaultManifest)
    })
  }
  else {
    this._readAllAssets(function (err, assets) {
      if(err)
        return cb(err)

      var fileObject = _(self.assetArray).map(function (asset) {
        return [asset.key, {
          source: asset.source
        , destination: asset.destination
        , checksum: assets[asset.source].checksum
        }]
      }).object().valueOf()

      self.defaultManifest = {
        version: '0.0.0'
      , message: 'Default Manifest'
      , files: fileObject
      , assets: []
      }

      cb(null, self.defaultManifest)
    })
  }
}

Stratosphere.prototype._respondWithManifest = function respondWithManifest (res) {
  this.getManifest(function (err, manifest) {
    var errmsg
      , respJSON

    if(err) {
      console.error('Problem generating manifest:')
      console.error(err)
      console.error(err.stack)
      errmsg = 'There was a problem generating the manifest'
      res.writeHead(400, {
        'content-type': 'text/plain'
      , 'content-length': errmsg.length
      })
      res.end(errmsg)
    }
    else {
      respJSON = JSON.stringify(manifest)
      res.writeHead(200, {
        'content-type': 'application/json'
      , 'content-length': respJSON.length
      })
      res.end(respJSON)
    }
  })
}

function ConstructStratosphere (app, useropts, cb) {
  return new Stratosphere(app, useropts, cb)
}

module.exports = ConstructStratosphere
