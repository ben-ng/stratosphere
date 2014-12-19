var test = require('tape')
  , stratosphere = require('../')
  , handler = require('./fake-app')
  , request = require('request')
  , path = require('path')
  , http = require('http')
  , rimraf = require('rimraf')
  , fs = require('fs')
  , zlib = require('zlib')
  , bufferEqual = require('buffer-equal')
  , after = require('lodash.after')
  , port = 9876
  , addr = function (route) {
            return 'http://127.0.0.1:' + port + '/' + route
          }

test('[start] should clean up the tmp directory', function (t) {
  t.plan(1)
  rimraf(path.join(__dirname, 'tmp'), function (err) {
    t.ifError(err, 'tests cleaned up')
  })
})

test('should do nothing when disabled', function (t) {
  t.plan(13)

  var server = http.createServer(handler)
    , instance = stratosphere(server, {disable: true})
    , wrapped = instance.intercept()
    , finish = after(2, function () {
        server.close(function () {
          t.ok(true, 'server closed')
        })
      })

  t.strictEqual(wrapped, server, 'should be exactly equal')

  server.listen(port, function () {
    // assert that our test fixtures are working
    request({uri: addr('cat'), gzip: true, encoding: null}, function (err, res, body) {
      t.ifErr(err, 'no cat request error')
      t.equal(res.statusCode, 200)
      t.equal(res.headers['content-length'], '24462')
      t.equal(res.headers['content-type'], 'image/jpeg')

      fs.readFile(path.join(__dirname, 'cat.jpg'), function (err, data) {
        t.ifError(err, 'no cat image read error')
        t.ok(bufferEqual(body, data), 'cat image data should match')
        finish()
      })
    })

    request({uri: addr('fish'), gzip: true, encoding: null}, function (err, res, body) {
      t.ifErr(err, 'no fish request error')
      t.equal(res.statusCode, 200)
      t.equal(res.headers['content-length'], '4')
      t.equal(res.headers['content-type'], 'text/plain')
      t.equal(body.toString(), 'fish', 'fish data in body')
      finish()
    })
  })
})

test('should preload assets', function (t) {
  t.plan(14)

  var server = http.createServer(handler)
    , instance = stratosphere(server, {
                  assets: path.join(__dirname, 'fake-assets.js')
                , root: path.join(__dirname, 'tmp')
                })
    , finish = after(2, function () {
        server.close(function () {
          t.ok(true, 'server closed')
        })
      })

  server.listen(port, function () {
    instance.preload(function (err, assets) {
      t.ifError(err, 'no preload error')

      if(!err) {
        // assert on the assets returned in the callback
        fs.readFile(path.join(__dirname, 'cat.jpg'), function (err, data) {
          t.ifError(err, 'no cat image read error')

          zlib.gzip(data, function (err, min) {
            t.ok(bufferEqual(assets['/cat'].data, min), 'cat asset data should match')

            // assert on the filesystem
            instance._hasAssetForRoute('/cat', function (exists) {
              t.ok(exists, '[fs] cat asset should exist on filesystem')

              instance._assetForRoute('/cat', function (err, asset) {
                t.ifError(err, '[fs] no cat image read error')
                t.ok(bufferEqual(asset[1].data, min), 'cat asset data should match')
                t.equal(asset[1].headers['content-type'], 'image/jpeg', 'cat content-type should be image/jpeg')
                t.equal(asset[1].headers['content-length'], 24462, 'cat content-length should be 24462')

                finish()
              })
            })
          })

          t.equal(assets['/cat'].headers['content-type'], 'image/jpeg', 'cat content-type should be image/jpeg')
          t.equal(assets['/cat'].headers['content-length'], 24462, 'cat content-length should be 24462')
        })

        t.equal(assets['/fish'].data.toString(), 'fish', 'fish asset should have data "fish"')
        t.equal(assets['/fish'].headers['content-type'], 'text/plain', 'fish content-type should be text/plain')
        t.equal(assets['/fish'].headers['content-length'], 4, 'fish content-length should be four')
        finish()
      }
    })
  })
})

test('[app instanceof http.Server] should serve assets from disk when available', function (t) {
  t.plan(9)

  /**
  * To test if we are serving from disk or not, we punch out the server
  * method to make sure it doesn't get called
  */
  var server = http.createServer(handler)
    , instance = stratosphere(server, {
                  assets: path.join(__dirname, 'fake-assets.json')
                , root: path.join(__dirname, 'tmp')
                , manifestOpts: {message: 'Override'}
                , route: 'version.json'
                })
    , oldServeCat = handler.serveCat
    , interception
    , finish = after(2, function () {
        server.close(function () {
          t.ok(true, 'server closed')
        })
      })

  server.listen(port, function () {
    instance.writeAssets(function (err) {
      t.ifError(err)

      handler.serveCat = function proxiedServeCat (res) {
        res.writeHead(400)
        res.end()
        t.fail('should not have called the handler method')
        t.end()
      }

      interception = instance.intercept()
      interception.listen(port)

      request({uri: addr('cat'), gzip: true, encoding: null}, function (err, res, body) {
          t.ifError(err, 'no cat route error')
          t.equal(res.headers['content-type'], 'image/jpeg', 'cat content-type should be image/jpeg')
          t.equal(res.headers['content-length'], '24462', 'cat content-length should be 24462')

          fs.readFile(path.join(__dirname, 'cat.jpg'), function (err, data) {
            t.ifError(err, 'no cat image read error')
            t.ok(bufferEqual(res.body, data), 'cat asset data should match')

            // restore the old method before leaving
            handler.serveCat = oldServeCat
            t.pass('restored old function')
            finish()
          })
        })

        request({uri: addr('version.json'), gzip: true, encoding: null}, function (err, res, body) {
          t.deepEqual(JSON.parse(res.body.toString()), {
              version: "0.0.0"
            , message: 'Override'
            , files: {
              cat: {
                source: '/cat'
              , destination: 'cat'
              , checksum: '0ed846a2fb283a2b31e54f68769145a0'
              }
              , fish: {
                source: '/fish'
              , destination: 'ocean'
              , checksum: '83e4a96aed96436c621b9809e258b309'
              }
            }
            , assets:[]})
            finish()
          })
    })
  })
})

test('[end] should clean up the tmp directory', function (t) {
  t.plan(1)
  rimraf(path.join(__dirname, 'tmp'), function (err) {
    t.ifError(err, 'tests cleaned up')
  })
})

