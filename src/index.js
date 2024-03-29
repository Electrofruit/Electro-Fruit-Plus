import config from './config';
import Bitcoin from './providers/Bitcoin';
import debug from 'debug';
import Ethereum from './providers/Ethereum';
import AgentRestClient from './rest/client';
import { parseSigResponse, getProviderShortCode } from './util';
import NodeCrypto from 'gridplus-node-crypto';
export const providers = {
  Bitcoin,
  Ethereum,
};
import { buildPermissionRequest, buildSigRequest, parsePermissions } from './permissions';
// const tokenList = require('../tokensByAddress.json')
const log = debug('gridplus-sdk');

export default class SdkClient {

  constructor(options) {
    options = options || {};

    options = options || {};
    options.baseUrl = options.baseUrl || config.api.baseUrl;
    options.name = options.name || 'gridplus-sdk';
    options.crypto = options.crypto || NodeCrypto;

    if (!options.privKey) {
      const priv = options.crypto.randomBytes(32);
      if (typeof priv === 'string') options.privKey = priv
      else                          options.privKey = priv.toString('hex');
    } else {
      const priv = typeof options.privKey === 'string' ? options.privKey : options.privKey.toString('hex');
      if (priv.length !== 64) throw new Error('options.privKey must be 32 bytes (hex encoding)');
      options.privKey = priv;
    }

    this.client = new AgentRestClient(options);

    this.providers = {};

    (options.providers || []).map((provider) => {
      this.providers[provider.shortcode] = provider;
    });

    log(`gridplus sdk created with providers [${Object.keys(this.providers)}]`);

  }

  addresses(param, cb) {
    this.client.pairedRequest('addresses', { param }, (err, res) => {
      if (err) return cb(err);  
      if (!res.result || !res.result.data || !res.result.data.addresses) return cb('Incorrect response.');
      return cb(null, res.result.data.addresses);
    });
  }

  addPermission(param, cb) {
    const req = buildPermissionRequest(param);
    if (typeof req === 'string') return cb(req);
    this.client.pairedRequest('addPermission', { param: req }, (err, res) => {
      let success = null;
      try {
        success = res.result.success;
      } catch (e) { 
        console.warn('Error adding permission: ', e); 
      }
      return cb(err, success);
    });
  }

  // Broadcast a transaction and return the result of the mempool
  broadcast(shortcode, payload, cb) {
    if (! this.providers[shortcode]) {
      return cb(new Error(`no provider loaded for shortcode ${shortcode}`));
    }
    return this.providers[shortcode].broadcast(payload, cb);
  }


  // connects to all configured network providers, returning the first of any encountered errors.
  // else continues via supplied callback when done.
  connect(serial, cb) {
    if (typeof serial === 'function') {
      cb = serial;
      serial = null;
    }
    return this.client.request('connect', cb);
  }

  // Delete the pairing
  deletePairing(cb) {
    return this.client.pairedRequest('deletePairing', {}, cb);
  }

  // Delete the permission at index i. This index is the element in the array returned
  // from `permissions`
  deletePermission(i, cb) {
    if (typeof i === 'function') {
      cb = i;
      i = 0;
    }
    return this.client.pairedRequest('deletePermission', { index: i }, cb);
  }

   // Get a balance for an account.
  // @param [shortcode]  {string}  - "ETH", "ERC20", or "BTC"
  // @param [addr]      {string}  - The account we are querying
  // @param [ERC20Addr] {string}  - (optional) Address of the ERC20 token we are asking about
  // @callback                    - err (Error), data (object)
  getBalance(shortcode, options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }

    if (! this.providers[shortcode]) {
      return cb(new Error(`no provider loaded for shortcode ${shortcode}`));
    }

    return this.providers[shortcode].getBalance(options, cb);
  }

  getTokenBalance(options, cb) {
    if (!this.providers['ETH']) {
      return cb(new Error('Cannot request token balance. ETH provider is not set.'))
    }

    return this.providers['ETH'].getTokenBalance(options, cb);
  }

  getTxHistory(shortcode, options, cb) {
    if (! this.providers[shortcode]) {
      return cb(new Error(`no provider loaded for shortcode ${shortcode}`));
    }
    return this.providers[shortcode].getTxHistory(options, cb);
  }

  // Get (one or more) transaction(s) and return (one or more) object(s) that conform to a common schema across currencies
  getTx(shortcode, hashes, opts, cb) {
    if (! this.providers[shortcode]) {
      return cb(new Error(`no provider loaded for shortcode ${shortcode}`));
    }
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    return this.providers[shortcode].getTx(hashes, cb, opts);
  }

  initialize(options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }

    let shortcodes = [];

    if ( ! options.shortcodes && options.shortcode) {
      shortcodes = [ options.shortcode ];
    }
    else if (options.shortcodes) {
      shortcodes = options.shortcodes;
    } else {
      shortcodes = Object.keys(this.providers);
    }

    if ( ! shortcodes.length) return cb(new Error('cannot initialize sdk. no providers specified'));

    const promises = shortcodes.map(shortcode => {
      return new Promise((resolve, reject) => {

        const provider = this.providers[shortcode];

        if ( ! provider) return reject(new Error(`no provider found with shortcode ${shortcode}`));

        log(`initializing provider ${shortcode}`);

        provider.initialize((err, info) => {
          if (err) return reject(err);

          this.providers[shortcode] = provider;

          log(`initialized provider ${shortcode}`);
          resolve(info);
        });

      });
    });

    return Promise.all(promises).then((info) => {
      return cb(null, info);
    }).catch(err => cb(err));
  }

  pair(appSecret, cb) {
    return this.client.pair(appSecret, cb);
  }

  permissions(cb) {
    this.client.pairedRequest('getPermissions', { }, (err, res) => {
      if (err) return cb(err);  
      if (!res.result || !res.result.data) return cb('Incorrect response.');
      if (!res.result.data.permissions) res.result.data.permissions = [];
      return cb(null, parsePermissions(res.result.data.permissions));
    });
  }

  sign(param, cb) {
    const req = buildSigRequest(param);
    if (typeof req === 'string') return cb(req);
    const providerCode = getProviderShortCode(param.schemaCode);
    this._getStatefulParams(providerCode, req, (err, newReq) => {
      if (err) return cb(err);
      this.client.pairedRequest('sign', { param: newReq }, (err, res) => {
        if (err) return cb(err)
        else if (res === null) return cb(null, null)   // User rejects request --> return no error and sigData=null
        else if (!res || res.result === undefined || res.result.data === undefined || res.result.data.sigData === undefined) return cb('Incorrect response');
        
        res.result.data.params = newReq.params;
        
        if (res.result.data.schemaIndex === undefined) res.result.data.schemaIndex = newReq.schemaIndex;
        if (res.result.data.typeIndex === undefined) res.result.data.typeIndex = newReq.typeIndex;
        
        return cb(null, parseSigResponse(res))
      });
    })
  }

  // Add additional parameters and reconfigure the request as needed
  _getStatefulParams(providerCode, req, cb) {
    if (this.providers[providerCode]) {
      return this.providers[providerCode].getStatefulParams(req, cb);
    } else {
      return cb(null, req);
    }
  }

}

export const Client = SdkClient;
export const tokens = require('../tokensBySymbol.json');
export const tokensBySymbol = require('../tokensBySymbol.json');
export const tokensByAddress = require('../tokensByAddress.json');
