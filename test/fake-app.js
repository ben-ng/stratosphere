var url = require('url')
  , fs = require('fs')
  , path = require('path')
  , zlib = require('zlib')

function serveCat (res) {
  fs.readFile(path.join(__dirname, 'cat.jpg'), function (err, data) {
    if(err) {
      res.writeHead(400)
      res.end()
    }
    else {
      zlib.gzip(data, function (err, zipped) {
        if(err) {
          res.writeHead(400)
          res.end()
        }
        else {
          res.writeHead(200, {
            'Content-Type': 'image/jpeg'
          , 'Content-Length': zipped.length
          , 'Content-Encoding': 'gzip'})
          res.end(zipped)
        }
      })
    }
  })
}

function handler (req, res) {
  switch(url.parse(req.url).href) {
    case '/cat':
      module.exports.serveCat(res)
      break
    case '/fish':
      res.writeHead(200, {'Content-Type': 'text/plain', 'Content-Length': 4})
      res.end('fish')
      break
  }
}

module.exports = handler
module.exports.serveCat = serveCat
