var fs = require('fs')
  , path = require('path')
  , url = require('url')
  , async = require('async')
  , supertest = require('supertest')
  , _ = require('lodash')
  , pad = require('pad')
  , crypto = require('crypto')
  , mkdirp = require('mkdirp')
  , rimraf = require('rimraf')
  , http = require('http')
  , defaults = {
      route: 'manifest.json'
    , preload: false
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

function Stratosphere (app, useropts, cb) {
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

    this._initialize(cb)
  }
}

/*
* Instance methods
*/
Stratosphere.prototype._initialize = function initialize (cb) {
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

  , function preload (next) {
      if(!opts.preload)
        return next(null)

      self._readAllAssets(next)
    }

  ], function (err, assets) {
    if(cb)
      cb(err, assets)
    else if (err)
      throw err
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
    async.mapLimit(self.assetArray
      , 4
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

      var headers = JSON.stringify(tuple[1].header)
        , paddedHeaderLength = new Buffer(pad(headerLengthLength, '' + Buffer.byteLength(headers), '0'))
        , headerBuffer = new Buffer(headers)
        , data = Buffer.isBuffer(tuple[1].data) ? tuple[1].data : new Buffer(tuple[1].data)
        , assetData = Buffer.concat([paddedHeaderLength, headerBuffer, data])
        , routeHash = hash(normalize(tuple[0]))

      fs.writeFile(path.join(opts.root, routeHash), assetData, next)
    }

    function mapAsset (tuple) {
      return function (next) {
        writeAsset(tuple, next)
      }
    }

    async.parallelLimit(_.map(assets, mapAsset), 5, function (err) {
      cb(err)
    })
  })
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
        // try to get it from the route
        supertest(app)
                .get(route)
                .timeout(10 * 60 * 1000)
                .expect(200)
                .end(function (err, res) {
                  var dataBuffer

                  if(err) {
                    cb(err)
                  }
                  else {
                    dataBuffer = _.isEmpty(res.body) ? res.text : res.body

                    if(!Buffer.isBuffer(dataBuffer))
                      dataBuffer = new Buffer(dataBuffer)

                    routeData = {
                      header: _.clone(res.header)
                    , data: dataBuffer
                    }

                    self.assetCache[route] = routeData

                    cb(null, [route, routeData])
                  }
                })
      }
      else {
        // decode the serialized asset
        var headerLength = parseInt(data.slice(0, headerLengthLength).toString(), 10)
          , header = data.slice(headerLengthLength, headerLengthLength + headerLength).toString()

        try {
          header = JSON.parse(header)
        }
        catch(e) {
          return cb(e)
        }

        routeData = {
          header: header
        , data: data.slice(headerLengthLength + headerLength)
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

Stratosphere.prototype.intercept = function intercept () {
  var serverOrHandler = this.app

  if(this.opts.disable)
    return this.app

  if(serverOrHandler instanceof http.Server) {
    var handlers = serverOrHandler.listeners('request')
      , i
      , ii

    for(i=0, ii=handlers.length; i<ii; ++i) {
      handlers[i] = this._proxyHandler(handlers[i])
    }

    serverOrHandler.removeAllListeners('request')

    for(i=0, ii=handlers.length; i<ii; ++i) {
      serverOrHandler.addListener('request', handlers[i])
    }

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
        var checksum = crypto.createHash('md5')
                              .update(assets[asset.source].data)
                              .digest('hex')

        return [asset.key, {
          source: asset.source
        , destination: asset.destination
        , checksum: checksum
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

Stratosphere.prototype._proxyHandler = function proxyHandler (handler) {
  var self = this
    , manifestRoute = self.opts.route ? normalize(self.opts.route) : false

  return function (req, res) {
    var href = url.parse(req.url).href

    if(manifestRoute && href == manifestRoute) {
      self._respondWithManifest(res)
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
              res.writeHead(200, asset[1].header)
              res.end(asset[1].data)
            }
          })
        }
      })
    }
  }
}

function ConstructStratosphere (app, useropts, cb) {
  return new Stratosphere(app, useropts, cb)
}

module.exports = ConstructStratosphere
