var test = require('tape')
  , stratosphere = require('../')
  , handler = require('./fake-app')
  , request = require('supertest')
  , path = require('path')
  , http = require('http')
  , rimraf = require('rimraf')
  , fs = require('fs')
  , bufferEqual = require('buffer-equal')

test('[start] should clean up the tmp directory', function (t) {
  t.plan(1)
  rimraf(path.join(__dirname, 'tmp'), function (err) {
    t.ifError(err, 'tests cleaned up')
  })
})

test('should do nothing when disabled', function (t) {
  t.plan(6)

  var server = http.createServer(handler)
    , instance = stratosphere(server, {disable: true})
    , wrapped = instance.intercept()

  t.strictEqual(wrapped, server, 'should be exactly equal')

  // assert that our test fixtures are working
  request(wrapped).get('/cat')
                  .expect(200)
                  .expect('Content-Length', 24462)
                  .expect('Content-Type', 'image/jpeg')
                  .end(function (err, res) {
                    t.ifErr(err, 'no cat request error')

                    fs.readFile(path.join(__dirname, 'cat.jpg'), function (err, data) {
                      t.ifError(err, 'no cat image read error')

                      t.ok(bufferEqual(res.body, data), 'cat image data should match')
                    })
                  })

  request(wrapped).get('/fish')
                  .expect(200)
                  .expect('Content-Length', 4)
                  .expect('Content-Type', 'text/plain')
                  .end(function (err, res) {
                    t.ifErr(err, 'no fish request error')
                    t.equal(res.text, 'fish', 'fish data in text')
                  })
})

test('should preload assets and save them to disk', function (t) {
  t.plan(25)

  function afterPreload (err, assets) {
    t.ifError(err, 'no preload error')

    if(!err) {
      // assert on the assets returned in the callback
      fs.readFile(path.join(__dirname, 'cat.jpg'), function (err, data) {
        t.ifError(err, 'no cat image read error')

        t.ok(bufferEqual(assets['/cat'].data, data), 'cat asset data should match')

        t.equal(assets['/cat'].header['content-type'], 'image/jpeg', 'cat content-type should be image/jpeg')
        t.equal(assets['/cat'].header['content-length'], '24462', 'cat content-length should be 24462')

        // assert on the filesystem
        instance._hasAssetForRoute('/cat', function (exists) {
          t.ok(exists, '[fs] cat asset should exist on filesystem')

          instance._assetForRoute('/cat', function (err, asset) {
            t.ifError(err, '[fs] no cat image read error')
            t.ok(bufferEqual(asset[1].data, data), '[fs] cat asset data should match')
            t.equal(asset[1].header['content-type'], 'image/jpeg', '[fs] cat content-type should be image/jpeg')
            t.equal(asset[1].header['content-length'], '24462', '[fs] cat content-length should be 24462')
          })
        })
      })

      t.equal(assets['/fish'].data.toString(), 'fish', 'fish asset should have data "fish"')
      t.equal(assets['/fish'].header['content-type'], 'text/plain', 'fish content-type should be text/plain')
      t.equal(assets['/fish'].header['content-length'], '4', 'fish content-length should be four')
    }
  }

  var instance = stratosphere(http.createServer(handler), {
                  assets: path.join(__dirname, 'fake-assets.js')
                , root: path.join(__dirname, 'tmp')
                , preload: true
                }, afterPreload)

  instance.writeAssets(function (err) {
    t.ifError(err, 'no writeAssets error')

    fs.readFile(path.join(__dirname, 'cat.jpg'), function (err, data) {
      // assert on the filesystem
      instance._hasAssetForRoute('/cat', function (exists) {
        t.ok(exists, '[fs] cat asset should exist on filesystem')

        instance._assetForRoute('/cat', function (err, asset) {
          t.ifError(err, '[fs] no cat image read error')
          t.ok(bufferEqual(asset[1].data, data), '[fs] cat asset data should match')
          t.equal(asset[1].header['content-type'], 'image/jpeg', '[fs] cat content-type should be image/jpeg')
          t.equal(asset[1].header['content-length'], '24462', '[fs] cat content-length should be 24462')
        })
      })
    })

    instance._hasAssetForRoute('/fish', function (exists) {
      t.ok(exists, '[fs] fish asset should exist on filesystem')

      instance._assetForRoute('/fish', function (err, asset) {
        t.ifError(err, '[fs] no fish asset read error')
        t.ok(Buffer.isBuffer(asset[1].data), '[fs] fish asset should have a data buffer')
        t.equal(asset[1].data.toString(), 'fish', '[fs] fish asset should have data "fish"')
        t.equal(asset[1].header['content-type'], 'text/plain', '[fs] fish content-type should be text/plain')
        t.equal(asset[1].header['content-length'], '4', '[fs] fish content-length should be four')
      })
    })
  })
})

function runServeFromDiskTestWithAppArgument (t, appArgument) {
  t.plan(8)

  /**
  * To test if we are serving from disk or not, we punch out the server
  * method to make sure it doesn't get called
  */
  var instance = stratosphere(appArgument, {
                  assets: path.join(__dirname, 'fake-assets.json')
                , root: path.join(__dirname, 'tmp')
                , preload: false
                , noFlush: true
                , manifestOpts: {message: 'Override'}
                })
    , oldServeCat = handler.serveCat
    , interception

  handler.serveCat = function proxiedServeCat (res) {
    res.writeHead(400)
    res.end()
    t.fail('should not have called the handler method')
  }

  instance.writeAssets(function (err) {
    t.ifError(err)

    interception = instance.intercept()

    request(interception)
      .get('/cat')
      .set('user-agent', 'Test-Agent')
      .expect(200)
      .end(function (err, res) {
        t.ifError(err, 'no cat route error')
        t.equal(res.header['content-type'], 'image/jpeg', 'cat content-type should be image/jpeg')
        t.equal(res.header['content-length'], '24462', 'cat content-length should be 24462')


        fs.readFile(path.join(__dirname, 'cat.jpg'), function (err, data) {
          t.ifError(err, 'no cat image read error')
          t.ok(bufferEqual(res.body, data), 'cat asset data should match')

          // restore the old method before leaving
          handler.serveCat = oldServeCat
          t.pass('restored old function')
        })
      })

    request(interception)
      .get('/manifest.json')
      .expect(200)
      .expect('Content-Type', 'application/json')
      .end(function (err, res) {
        t.deepEqual(res.body, {
            version: "0.0.0"
          , message: 'Override'
          , files: {
            cat: {
              source: '/cat'
            , destination: 'cat'
            , checksum: '6db41b6f103fea20eb29ba09345f17ca'
            }
            , fish: {
              source: '/fish'
            , destination: 'ocean'
            , checksum: '83e4a96aed96436c621b9809e258b309'
            }
          }
          , assets:[]})
        })
  })
}

test('[app instanceof http.Server] should serve assets from disk when available', function (t) {
  runServeFromDiskTestWithAppArgument(t, http.createServer(handler))
})

test.skip('[typeof app == \'function\'] should serve assets from disk when available', function (t) {
  runServeFromDiskTestWithAppArgument(t, handler)
})

test('[end] should clean up the tmp directory', function (t) {
  t.plan(1)
  rimraf(path.join(__dirname, 'tmp'), function (err) {
    t.ifError(err, 'tests cleaned up')
  })
})

