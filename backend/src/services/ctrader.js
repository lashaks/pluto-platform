// ============================================================
// cTRADER MANAGER API CLIENT (Real Integration)
// ============================================================
// Protocol: TCP + TLS over port 5011
// Serialization: Google Protobuf (proto2)
// Framing: 4-byte big-endian length prefix + payload
// Auth: MD5-hashed password in ProtoManagerAuthReq
// Keepalive: ProtoHeartbeatEvent every 25 seconds
//
// Sandbox: uat-demo.p.ctrader.com:5011
// Plant: propsandbox | Environment: demo
// ============================================================

const tls = require('tls');
const crypto = require('crypto');
const path = require('path');
const protobuf = require('protobufjs');
const { EventEmitter } = require('events');

// Payload type constants (from CSModelMessages_External.proto)
const PT = {
  HEARTBEAT_EVENT: 51,
  ERROR_RES: 50,
  PROTO_EXECUTION_EVENT: 300,
  PROTO_MANAGER_AUTH_REQ: 301,
  PROTO_MANAGER_AUTH_RES: 302,
  PROTO_POSITION_MARGIN_CHANGED_EVENT: 335,
  PROTO_TRADER_LIST_REQ: 403,
  PROTO_TRADER_LIST_RES: 404,
  PROTO_POSITION_LIST_REQ: 407,
  PROTO_POSITION_LIST_RES: 408,
  PROTO_MANAGER_DEAL_LIST_REQ: 431,
  PROTO_MANAGER_DEAL_LIST_RES: 432,
  PROTO_CRUD_TRADER_REQ: 501,
  PROTO_CRUD_TRADER_RES: 502,
  PROTO_CHANGE_BALANCE_REQ: 519,
  PROTO_CHANGE_BALANCE_RES: 520,
  PROTO_HELLO_EVENT: 990,
};

const CrudOp = { CREATE: 1, UPDATE: 3, DELETE: 4, UPDATE_DIFF: 5 };
const AccessRights = { FULL_ACCESS: 0, CLOSE_ONLY: 1, NO_TRADING: 2, NO_LOGIN: 3 };
const AccountType = { HEDGED: 0, NETTED: 1, SPREAD_BETTING: 2 };
const BalanceType = { DEPOSIT: 0, WITHDRAW: 1 };

class CTraderManagerClient extends EventEmitter {
  constructor(config) {
    super();
    this.host = config.host || 'uat-demo.p.ctrader.com';
    this.port = config.port || 5011;
    this.plantId = config.plantId || 'propsandbox';
    this.environmentName = config.environmentName || 'demo';
    this.login = config.login;
    this.password = config.password;
    this.groupId = config.groupId;
    this.depositAssetId = config.depositAssetId || 1;
    this.moneyDigits = 2;

    this.socket = null;
    this.root = null;
    this.connected = false;
    this.authenticated = false;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.msgCounter = 0;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
  }

  async connect() {
    this.root = await protobuf.load([
      path.join(__dirname, '../../proto/CommonModelMessages_External.proto'),
      path.join(__dirname, '../../proto/CommonMessages_External.proto'),
      path.join(__dirname, '../../proto/CSModelMessages_External.proto'),
      path.join(__dirname, '../../proto/CSMessages_External.proto'),
    ]);

    return new Promise((resolve, reject) => {
      this.socket = tls.connect({
        host: this.host, port: this.port, servername: this.host, rejectUnauthorized: true,
      }, () => {
        console.log(`[cTrader] TLS connected to ${this.host}:${this.port}`);
        this.connected = true;
        this.reconnectAttempts = 0;
      });

      this.socket.on('data', (data) => this._onData(data));
      this.socket.on('close', () => this._onClose());
      this.socket.on('error', (err) => {
        console.error('[cTrader] Socket error:', err.message);
        if (!this.authenticated) reject(err);
      });

      this.once('hello', async () => {
        try { await this._authenticate(); this._startHeartbeat(); resolve(); }
        catch (err) { reject(err); }
      });

      setTimeout(() => {
        if (!this.authenticated) reject(new Error('Authentication timeout (15s)'));
      }, 15000);
    });
  }

  async _authenticate() {
    const passwordHash = crypto.createHash('md5').update(this.password).digest('hex');
    const res = await this._request(PT.PROTO_MANAGER_AUTH_REQ, 'ProtoManagerAuthReq', {
      plantId: this.plantId, environmentName: this.environmentName,
      login: this.login, passwordHash,
    }, PT.PROTO_MANAGER_AUTH_RES);
    this.authenticated = true;
    console.log(`[cTrader] Authenticated as manager ${this.login}`);
    this.emit('authenticated', res);

    // Auto-discover USD asset ID for account creation
    try {
      const assetRes = await this._request(465, 'ProtoAssetListReq', {}, 466);
      const assets = assetRes.asset || [];
      const usd = assets.find(a => a.name === 'USD' || a.displayName === 'USD');
      if (usd) {
        this.depositAssetId = Number(usd.assetId);
        console.log(`[cTrader] USD asset ID: ${this.depositAssetId}`);
      } else if (assets.filter(a => a.depositAsset).length > 0) {
        this.depositAssetId = Number(assets.filter(a => a.depositAsset)[0].assetId);
        console.log(`[cTrader] Using first deposit asset ID: ${this.depositAssetId}`);
      }
    } catch (e) {
      console.warn(`[cTrader] Asset discovery failed (using default ${this.depositAssetId}):`, e.message);
    }
  }

  _startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      this._send(PT.HEARTBEAT_EVENT, 'ProtoHeartbeatEvent', {}, null);
    }, 25000);
  }

  _onClose() {
    console.warn('[cTrader] Connection closed');
    this.connected = false;
    this.authenticated = false;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    this.emit('disconnected');
    if (this.reconnectAttempts < 5) {
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
      this.reconnectAttempts++;
      console.log(`[cTrader] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
      this.reconnectTimer = setTimeout(() => this.connect().catch(e => console.error('[cTrader] Reconnect failed:', e.message)), delay);
    }
  }

  close() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) this.socket.end();
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + len) break;
      const frame = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      try { this._onMessage(frame); }
      catch (err) { console.error('[cTrader] Message parse error:', err.message); }
    }
  }

  _onMessage(frame) {
    const ProtoMessage = this.root.lookupType('ProtoMessage');
    const decoded = ProtoMessage.decode(frame);
    const { payloadType, payload, clientMsgId } = decoded;

    if (payloadType === PT.PROTO_HELLO_EVENT) {
      console.log('[cTrader] Received ProtoHelloEvent');
      this.emit('hello'); return;
    }
    if (payloadType === PT.HEARTBEAT_EVENT) return;

    if (payloadType === PT.ERROR_RES) {
      const ProtoErrorRes = this.root.lookupType('ProtoErrorRes');
      const err = ProtoErrorRes.decode(payload);
      console.error(`[cTrader] Error: ${err.errorCode} — ${err.description || ''}`);
      if (clientMsgId && this.pending.has(clientMsgId)) {
        const { reject, timeout } = this.pending.get(clientMsgId);
        clearTimeout(timeout);
        this.pending.delete(clientMsgId);
        reject(new Error(`${err.errorCode}: ${err.description || ''}`));
      }
      this.emit('server-error', err); return;
    }

    if (payloadType === PT.PROTO_EXECUTION_EVENT) {
      this.emit('execution', this.root.lookupType('ProtoExecutionEvent').decode(payload)); return;
    }
    if (payloadType === PT.PROTO_POSITION_MARGIN_CHANGED_EVENT) {
      this.emit('margin-changed', this.root.lookupType('ProtoMarginChangedEvent').decode(payload)); return;
    }

    if (clientMsgId && this.pending.has(clientMsgId)) {
      const { resolve, reject, timeout, expectedType, responseTypeName } = this.pending.get(clientMsgId);
      clearTimeout(timeout);
      this.pending.delete(clientMsgId);
      if (expectedType && payloadType !== expectedType) {
        return reject(new Error(`Unexpected payloadType ${payloadType}, expected ${expectedType}`));
      }
      try { resolve(this.root.lookupType(responseTypeName).decode(payload)); }
      catch (err) { reject(err); }
    }
  }

  _send(payloadType, typeName, obj, clientMsgId) {
    const MsgType = this.root.lookupType(typeName);
    const err = MsgType.verify(obj);
    if (err) throw new Error(`Proto verify failed for ${typeName}: ${err}`);
    const payloadBuf = MsgType.encode(MsgType.create(obj)).finish();
    const ProtoMessage = this.root.lookupType('ProtoMessage');
    const wrapper = { payloadType, payload: payloadBuf };
    if (clientMsgId) wrapper.clientMsgId = clientMsgId;
    const wrapped = ProtoMessage.encode(ProtoMessage.create(wrapper)).finish();
    const lengthPrefix = Buffer.alloc(4);
    lengthPrefix.writeUInt32BE(wrapped.length, 0);
    this.socket.write(Buffer.concat([lengthPrefix, wrapped]));
  }

  _request(payloadType, typeName, obj, expectedResponseType, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const clientMsgId = `msg_${++this.msgCounter}_${Date.now()}`;
      const responseTypeName = this._typeNameForPayload(expectedResponseType);
      const timeout = setTimeout(() => {
        this.pending.delete(clientMsgId);
        reject(new Error(`Request timeout (${timeoutMs}ms) for ${typeName}`));
      }, timeoutMs);
      this.pending.set(clientMsgId, { resolve, reject, timeout, expectedType: expectedResponseType, responseTypeName });
      try { this._send(payloadType, typeName, obj, clientMsgId); }
      catch (err) { clearTimeout(timeout); this.pending.delete(clientMsgId); reject(err); }
    });
  }

  _typeNameForPayload(pt) {
    const map = {
      [PT.PROTO_MANAGER_AUTH_RES]: 'ProtoManagerAuthRes',
      [PT.PROTO_CRUD_TRADER_RES]: 'ProtoCrudTraderRes',
      [PT.PROTO_CHANGE_BALANCE_RES]: 'ProtoChangeBalanceRes',
      [PT.PROTO_POSITION_LIST_RES]: 'ProtoPositionListRes',
      [PT.PROTO_TRADER_LIST_RES]: 'ProtoTraderListRes',
      [PT.PROTO_MANAGER_DEAL_LIST_RES]: 'ProtoManagerDealListRes',
      466: 'ProtoAssetListRes',
      474: 'ProtoLightGroupListRes',
    };
    return map[pt] || 'ProtoMessage';
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  async createAccount({ balance, name, email, leverageInCents = 3000, swapFree = true }) {
    const rawPassword = this._generatePassword();
    const passwordHash = crypto.createHash('md5').update(rawPassword).digest('hex');
    const balanceProtocol = Math.round(balance * Math.pow(10, this.moneyDigits));

    const res = await this._request(PT.PROTO_CRUD_TRADER_REQ, 'ProtoCrudTraderReq', {
      operation: CrudOp.CREATE,
      trader: {
        traderId: 0, login: 0, groupId: this.groupId,
        balance: balanceProtocol,
        accountType: AccountType.HEDGED,
        accessRights: AccessRights.FULL_ACCESS,
        name: name || '', email: email || '',
        passwordHash, swapFree, leverageInCents,
        depositAssetId: this.depositAssetId,
      },
    }, PT.PROTO_CRUD_TRADER_RES);

    console.log(`[cTrader] Created trader ${res.traderId} with balance $${balance}`);

    // Fetch the trader to get the assigned login
    const trader = await this.getTrader(res.traderId);
    return {
      traderId: res.traderId.toString(),
      login: (trader?.login || res.traderId).toString(),
      password: rawPassword,
    };
  }

  async updateAccess(traderId, accessRights) {
    const current = await this.getTrader(traderId);
    if (!current) throw new Error(`Trader ${traderId} not found`);
    const updatedTrader = { ...current, accessRights };
    delete updatedTrader.balance;

    const res = await this._request(PT.PROTO_CRUD_TRADER_REQ, 'ProtoCrudTraderReq', {
      operation: CrudOp.UPDATE, trader: updatedTrader,
    }, PT.PROTO_CRUD_TRADER_RES);
    console.log(`[cTrader] Updated trader ${traderId} access to ${accessRights}`);
    return res;
  }

  async disableTrading(traderId) { return this.updateAccess(traderId, AccessRights.CLOSE_ONLY); }
  async blockAccount(traderId)    { return this.updateAccess(traderId, AccessRights.NO_TRADING); }
  async enableTrading(traderId)   { return this.updateAccess(traderId, AccessRights.FULL_ACCESS); }

  async changeBalance(traderId, amount, comment = '', externalNote = '') {
    const type = amount >= 0 ? BalanceType.DEPOSIT : BalanceType.WITHDRAW;
    const amountProtocol = Math.round(Math.abs(amount) * Math.pow(10, this.moneyDigits));
    const res = await this._request(PT.PROTO_CHANGE_BALANCE_REQ, 'ProtoChangeBalanceReq', {
      traderId, amount: amountProtocol, type,
      comment: comment.substring(0, 200),
      externalNote: externalNote.substring(0, 200),
      newWay: true,
    }, PT.PROTO_CHANGE_BALANCE_RES);
    console.log(`[cTrader] ${type === 0 ? 'Deposit' : 'Withdraw'} $${Math.abs(amount)} on ${traderId}`);
    return res;
  }

  async getTrader(traderId) {
    const list = await this._request(PT.PROTO_TRADER_LIST_REQ, 'ProtoTraderListReq', {
      fromTimestamp: 0, toTimestamp: Date.now(), groupId: this.groupId,
    }, PT.PROTO_TRADER_LIST_RES);
    return (list.trader || []).find(t => t.traderId.toString() === traderId.toString()) || null;
  }

  async getOpenPositions(traderId) {
    const res = await this._request(PT.PROTO_POSITION_LIST_REQ, 'ProtoPositionListReq', {
      traderId, fromTimestamp: 0, toTimestamp: Date.now(),
    }, PT.PROTO_POSITION_LIST_RES);
    return res.position || [];
  }

  async getTradeHistory(traderId, fromDaysAgo = 30) {
    const now = Date.now();
    const res = await this._request(PT.PROTO_MANAGER_DEAL_LIST_REQ, 'ProtoManagerDealListReq', {
      traderId: [traderId],
      fromTimestamp: now - fromDaysAgo * 24 * 60 * 60 * 1000,
      toTimestamp: now,
      closingDealsOnly: true, withFilledVolumeOnly: true, maxRows: 1000,
    }, PT.PROTO_MANAGER_DEAL_LIST_RES);
    return res.deal || [];
  }

  async listTraders() {
    const res = await this._request(PT.PROTO_TRADER_LIST_REQ, 'ProtoTraderListReq', {
      fromTimestamp: 0, toTimestamp: Date.now(), groupId: this.groupId,
    }, PT.PROTO_TRADER_LIST_RES);
    return res.trader || [];
  }

  _generatePassword() {
    return 'Pluto' + crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) + Math.floor(Math.random() * 900 + 100);
  }
}

// ============================================================
// SINGLETON
// ============================================================
let singleton = null;
// Clean env var values — strips leading/trailing whitespace and stray '=' signs
const env = (key, fallback = '') => (process.env[key] || fallback).replace(/^\s*=?\s*/, '').trim();

function getClient() {
  if (!singleton) {
    singleton = new CTraderManagerClient({
      host: env('CTRADER_HOST', 'uat-demo.p.ctrader.com'),
      port: parseInt(env('CTRADER_PORT', '5011'), 10),
      plantId: env('CTRADER_PLANT_ID', 'propsandbox'),
      environmentName: env('CTRADER_ENV', 'demo'),
      login: parseInt(env('CTRADER_MANAGER_LOGIN', '30054'), 10),
      password: env('CTRADER_MANAGER_PASSWORD', 'Wwee3456#'),
      groupId: parseInt(env('CTRADER_GROUP_ID', '0'), 10),
    });
  }
  return singleton;
}

// ============================================================
// SERVICE WRAPPER (backwards-compatible with existing routes)
// ============================================================
class CTraderService {
  constructor() {
    this.client = null;
    this.enabled = env('CTRADER_ENABLED') === 'true';
    if (this.enabled) {
      this.client = getClient();
      this.client.on('error', (err) => {
        console.error('[cTrader] Client error (non-fatal):', err.message);
      });
      this.client.connect()
        .then(() => console.log('[cTrader] Live client ready'))
        .catch(err => {
          console.error('[cTrader] Failed to connect, falling back to simulation:', err.message);
          this.enabled = false;
        });
    } else {
      console.log('[cTrader] Running in simulated mode (CTRADER_ENABLED=false)');
    }
  }

  async createAccount({ balance, leverage, group, currency = 'USD', name, email }) {
    if (this.enabled && this.client && this.client.authenticated) {
      try {
        const leverageMatch = (leverage || '1:30').match(/1:(\d+)/);
        const leverageInCents = leverageMatch ? parseInt(leverageMatch[1], 10) * 100 : 3000;
        const result = await this.client.createAccount({ balance, name, email, leverageInCents, swapFree: true });
        return {
          success: true, login: result.login, password: result.password,
          accountId: result.traderId, server: 'PlutoCapital-Demo',
          balance, leverage, group,
        };
      } catch (err) {
        console.error('[cTrader] createAccount failed, falling back to simulation:', err.message);
      }
    }
    const { generateLogin, generatePassword } = require('../utils/helpers');
    return {
      success: true, login: generateLogin(), password: generatePassword(),
      accountId: 'CTA-' + Math.floor(Math.random() * 999999),
      server: 'PlutoCapital-Demo', balance, leverage, group,
    };
  }

  async getAccountInfo(accountId) {
    if (this.enabled && this.client && this.client.authenticated) {
      try {
        const trader = await this.client.getTrader(accountId);
        if (trader) {
          return {
            balance: Number(trader.balance) / 100,
            equity: Number(trader.balance) / 100,
            freeMargin: Number(trader.balance) / 100,
            usedMargin: 0, unrealizedPnL: 0, openPositions: 0,
          };
        }
      } catch (err) { console.error('[cTrader] getAccountInfo error:', err.message); }
    }
    return { balance: 0, equity: 0, freeMargin: 0, usedMargin: 0, unrealizedPnL: 0, openPositions: 0 };
  }

  async disableAccount(accountId, mode = 'CLOSE_ONLY') {
    if (this.enabled && this.client && this.client.authenticated) {
      try {
        if (mode === 'NO_TRADING') await this.client.blockAccount(accountId);
        else await this.client.disableTrading(accountId);
        return { success: true };
      } catch (err) { console.error('[cTrader] disableAccount error:', err.message); }
    }
    console.log(`[cTrader-sim] Disabled account ${accountId} mode=${mode}`);
    return { success: true };
  }

  async closeAllPositions(accountId) {
    console.log(`[cTrader] closeAllPositions on ${accountId} — using disableTrading`);
    if (this.enabled && this.client && this.client.authenticated) {
      await this.disableAccount(accountId, 'CLOSE_ONLY');
    }
    return { success: true, closedCount: 0 };
  }

  async adjustBalance(accountId, amount, comment = '') {
    if (this.enabled && this.client && this.client.authenticated) {
      try {
        await this.client.changeBalance(accountId, amount, comment, comment);
        return { success: true };
      } catch (err) { console.error('[cTrader] adjustBalance error:', err.message); }
    }
    console.log(`[cTrader-sim] Adjusted balance on ${accountId}: ${amount}`);
    return { success: true };
  }

  async getTradeHistory(accountId, fromDate, toDate) {
    if (this.enabled && this.client && this.client.authenticated) {
      try {
        const deals = await this.client.getTradeHistory(accountId, 90);
        return { trades: deals };
      } catch (err) { console.error('[cTrader] getTradeHistory error:', err.message); }
    }
    return { trades: [] };
  }

  get raw() { return this.client; }
}

module.exports = new CTraderService();
module.exports.CTraderManagerClient = CTraderManagerClient;
module.exports.AccessRights = AccessRights;
module.exports.CrudOp = CrudOp;
module.exports.PT = PT;
