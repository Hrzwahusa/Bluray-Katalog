'use strict'

// React Native provides a global WebSocket implementation.
// This shim prevents Metro from pulling in Node's `ws` package and core modules.
const WS = global.WebSocket

if (!WS) {
  throw new Error('WebSocket is not available in this runtime')
}

module.exports = WS
module.exports.default = WS
