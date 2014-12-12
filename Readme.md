Stratosphere
------------

[![Build Status](https://travis-ci.org/ben-ng/stratosphere.png?branch=master)](https://travis-ci.org/ben-ng/stratosphere)

Shrink wrap your dynamically generated assets. If you use tools like browserify to build your front-end code, you should consider saving the output to disk as part of your deploy process. This allows you to freeze an entire version of your app inside a container like Docker and test the release with confidence that things will not change in the future because the app was built with a different browserify version, or in a different environment.

## Quick Usage

```js

// See Full Usage for all options
var instance = stratosphere(app, {assets: 'assets.json', root: 'cachedir'})

// Save assets to disk
instance.writeAssets(function () {
  // Intercept requests for assets and serve from memory
  instance.intercept().listen(8080)
})

```

## Full Usage

```js
var stratosphere = require('stratosphere')

// app is your request handler OR a http server. your choice!
var app = require('./your-app')

// Stratosphere options
var opts = {
      // The assets you want to freeze are declared here.
      // Required.
      assets: './assets.json'

      // The directory where you want to save the frozen assets to.
      // Required.
    , root: './assets'

      // This is the route that you want to serve your manifest file on.
      // Optional.
    , route: 'manifest.json'

      // When true, will immediately request all your assets and cache them.
      // Default: false.
    , preload: false

      // When true, will disable Stratosphere, passing all requests
      // straight to the app.
      // Default: false.
    , disable: false

      // When true, will not empty the root asset directory on initialization.
      // Default: false.
    , noFlush: false

      // Used to override manifest defaults. Default: {}.
    , manifestOpts: {version: '1.0.0'}
    }

// Stratosphere wraps your request handler using the rules in your manifest
// The callback is optional, and will be called if preload == true
// when preloading is complete
var instance = stratosphere(app, opts, function (err, assets) {
                    if(err)
                      console.error(err)
                    else
                      console.log('Preloading complete')

                    // assets is an object containing the preloaded assets
                    // note the leading slashes -- routes are normalized
                    // {'/route/1': 'asset data', '/route/2': 'dat'} etc...
                  })

// If your `app` argument was a server, the `intercept` method will modify
// its `request` listeners to respond with cached data from the filesystem
// when possible, and return the same server
instance.intercept().listen(8080)

// If your `app` argument was a request handler, the `intercept` method
// will create a new handler function and return it.
http.createServer(instance.intercept()).listen(8080)

// If you want to write your assets to disk:
instance.writeAssets(function (err) {
  // Handle the error
})

// To flush the asset cache that is in memory (not the one on disk!)
instance.flush()
```

## The Assets File

You can either use a JSON file, or a `.js` file that exports an array.

```js
// If you serve lots of static assets like fonts, it might be helpful
// to glob for them
var fonts = require('glob').sync('./fonts/*')

// Should export an array of strings that represent routes on the server
// Routes without a leading slash will be have one added to them
module.exports = [
  // shorthand syntax is just a string
  'app/bundle.js'

  // shorthand is expanded into the equivalent verbose syntax
  // which is useful when fine control over the manifest is desired
, {
    source: '/app/bundle.js'
  , destination: 'app/bundle.js'
  , key: 'app/bundle.js'
  }
].concat(fonts)
```

## The Manifest File

The manifest that Stratosphere serves is [Phonegap Air](https://github.com/ben-ng/phonegap-air#the-app-manifest) compatible.
