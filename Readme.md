Stratosphere
------------

Shrink wrap your dynamically generated assets. If you use tools like browserify to build your front-end code, you should consider saving the output to disk as part of your deploy process. This allows you to freeze and entire version of your app inside a container like Docker and test the release with confidence that things will not change in the future because the app was built with a different browserify version, or in a different environment.

## Usage

```js
var stratosphere = require('stratosphere')

// app is your request handler
var app = require('./your-app')

// Stratosphere options
var opts = {
      // The assets you want to freeze are declared here. Required.
      assets: './assets.json'

      // The directory where you want to save the frozen assets to. Required.
    , root: './assets'

      // This is the route that you want to serve your manifest file on. Optional.
    , route: 'manifest.json'

      // When true, will immediately request all your assets and cache them. Default: false.
    , preload: false

      // When true, will disable Stratosphere, passing all requests straight to the app. Default: false.
    , disable: false
    }

// Stratosphere wraps your request handler using the rules in your manifest
// The callback is optional, and will be called if preload == true when preloading is complete
var wrappedApp = stratosphere(app, opts, function (err) {
                    if(err)
                      console.error(err)
                    else
                      console.log('Preloading complete')
                  })

// Create your server as usual. Stratosphere will intercept requests for your assets and serve them from disk.
server = http.createServer(wrappedApp).listen(process.env.PORT)
```

## The Assets File

```js
// If you serve lots of static assets like fonts, it might be helpful to glob for them
var fonts = require('glob').sync('./fonts/*')

// Should export an array of strings that represent routes on the server
module.exports = [
  'app/bundle.js'
].concat(fonts)
```

## The Manifest File

The manifest that Stratosphere serves is [Phonegap Air](https://github.com/ben-ng/phonegap-air#the-app-manifest) compatible.
