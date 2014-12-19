var app = require('./fake-app')
  , path = require('path')
  , http = require('http')
  , sp = require('../')
  , instance

instance = sp(http.createServer(app), {
  root: path.join(__dirname, 'tmp')
, assets: path.join(__dirname, 'fake-assets.json')
})

instance.writeAssets(function () {
  var server = http.createServer(app).listen(8080)

  instance2 = sp(server, {
    root: path.join(__dirname, 'tmp')
  , assets: path.join(__dirname, 'fake-assets.json')
  , noFlush: true
  })

  instance2.preload(function (err) {
    if(err)
      console.log(err)
    else
      console.log('Preloaded and listening on 8080')
  })
})
