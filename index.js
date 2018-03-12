const crypto = require('crypto');
const eccrypto = require('eccrypto');
const internalCrypto = require('./src/internalCrypto.js');
const enums = require('./src/enums.js');
const permissions = require('./src/permissions.js');

class GridPlusSDK {
  constructor(opts) {
    if (opts.key.length != 32) { throw new Error('Wrong key size (must be 32 bytes)'); }
    else {
      this.privKey = Buffer.from(opts.key, 'hex');
      this.pubKey = eccrypto.getPublic(privKey);
    }
    // These are all indexed on the same user-defined id
    this.hosts = {};
    this.ids = {};
    this.tokens = {};
    this.pairings = {};
  }

  //============================================================================
  // COMMS WITH AGENT
  //============================================================================

  // Add a device based on a host
  addDevice(host, id, cb) {
    this.hosts[id] = host;
    // In case this id is re-used, overwrite other instances
    this.ids[id] = null;
    this.tokens[id] = null;
    this.pairings[id] = null;
    // TODO Ping the device and make sure it's a valid Grid+ agent
    cb(null);
  }

  // Look a device up via Grid+ service given a name
  lookupDevice(name, cb) {
    // TODO: Call comms server
    cb(null, 'device');
  }


  request(endpoint, payload, device, cb) {
    const t = this.tokens[device];
    const id = this.ids[device];
    if (t === null || t === undefined || id === null || id === undefined) {
      cb('No token saved for this device. Please call getToken with the device id.');
    } else if (this.headerKey === null || this.headerKey === undefined) {
      cb('No header key saved. Please call getHeaderKey.');
    } else {
      let req = {
        id: this.ids[device],
        pubKey: this.pubKey,
      }
      let body = {
        type: endpoint,
        data: payload,
      }
      internalCrypto.ecsign(payload, this.privKey, (err, sig) => {
        if (err) { cb(err); }
        else {
          body.sig = sig;
          internalCrypto.encrypt(body, t, (err, encBody) => {
            req.body = encBody;
            internalCrypto.encrypt(req, this.headerKey, (err, encReq) => {
              if (err) { cb(err); }
              else {
                // Send the request somewhere
                console.log('sending out request', encReq);
              }
            })
          })
        }
      })
    }
  }

  //============================================================================
  // SYNC REQUESTS
  //
  // These requests are synchronous in that the response is returned with the
  // request (i.e. the request is not queued in the agent)
  //============================================================================

  // Get the public header key to encrypt async requests
  getHeaderKey(cb) {
    this.request('getHeaderKey', {}, (err, key) => {
      if (err) { cb(err); }
      else {
        this.headerKey = key;
        cb(null, key);
      }
    });
  }

  // Get an access token once you are paired
  getToken(device, cb) {
    this.request('getToken', { pubKey: this.pubKey }, (err, encToken) => {
      if (err) { cb(err); }
      else {
        this.ids[device] = this._hashId(encToken);
        // Returns an encrypted token
        internalCrypto.decrypt(encToken, this.privKey, (err, decToken) => {
          if (err) { cb(err); }
          else {
            this.tokens[device] = decToken;
            cb(null, decToken);
          }
        });
      }
    });
  }

  // Get the response of a request given an id
  getResponse(id, device, cb) {
    this.request('getResponse', { id: id }, device, cb);
  }

  //============================================================================
  // ASYNC REQUESTS
  //
  // Each of these requires a token to be generated and then stored (via getToken).
  // The response will contain a request id, which can be used with getResponse
  // to get the return payload once the request passes through the agent's queue.
  //============================================================================

  // Add a pairing
  addPairing(opts, cb) {
    const { appSecret, deviceSecret, name, device } = opts;
    if (!deviceSecret || !appSecret || !name || !device) {
      cb('Missing one or more parameters')
    } else {
      const fullSecret = `${deviceSecret}${appSecret}`;
      internalCrypto.ecsign(fullSecret, privKey, (err, sig) => {
        if (err) { cb(err); }
        else {
          const payload = [name, sig];
          const data = enums.formatArr(payload);
          this.request('addPairing', data, device, cb);
        }
      })
    }
  }

  // Remove a pairing
  deletePairing(device, cb) {
    if (!device) {
      cb('Missing one or more parameters');
    } else {
      this.request('deletePairing', {}, device, cb);
    }
  }

  // Create a permission given a pairing
  addPermission(opts, cb) {
    if (!opts.schema || !opts.type || !opts.rules || !opts.timeLimit || !opts.device) {
      cb('Missing one or more parameters');
    } else {
      const { schema, type, rules, timeLimit, device } = opts;
      // Check all inputs
      const schemaErr = permissions.getSchemaErr(schema, type);
      const rulesErr = permissions.getRulesErr(rules);
      const timeLimitErr = permissions.getTimeLimitErr(timeLimit);
      if (schemaErr != null) { cb(schemaErr); }
      else if (rulesErr != null) { cb(rulesErr); }
      else if (timeLimitErr != null) { cb(timeLimitErr); }
      else {
        // Format the request for the k81
        const parsedRules = permissions.parseRules(rules);
        const schemaIdx = enums.schemas[schema].index;
        const typeIdx = enums.types[type].index;
        const payload = [ schemaIdx, typeIdx, enums.formatArr(parsedRules), timeLimit ];
        // Sign and send payload
        internalCrypto.ecsign(enums.formatArr(payload), privKey, (err, sig) => {
          payload.push(sig);
          const data = enums.formatArr(payload);
          reqFunc('addPermission', data, device, cb);
        })
      }
    }
  }

  // Get the number of permissions associated with your
  getNumPermissions(device, cb) {
    if (!device) {
      cb('Missing one or more parameters');
    } else {
      this.request('getPermissionCount', {}, device, cb);
    }
  }

  // Get a permission given an index
  getPermission(index, device, cb) {
    if (!index || !device) {
      cb('Missing one or more parameters');
    } else {
      this.request('getPermission', { index: index }, device, cb);
    }
  }

  // Get a unique id from an encrypted payload.
  _hashId(token) {
    let id = `${token.iv.toString('hex')}${token.ephemPublicKey.toString('hex')}`;
    id = `${id}${token.ciphertext.toString('hex')}${token.mac.toString('hex')}`;
    return id;
  }

}
