/* ─────────────────────────────────────────────────────────────────────────────
   Pluto Capital — Market Data Service
   Live prices via Twelve Data (free tier: 800 req/day, WebSocket)
   Falls back to realistic simulated prices if no API key is set.
   
   Get free key: https://twelvedata.com/register
   Set env: TWELVE_DATA_KEY=your_key
───────────────────────────────────────────────────────────────────────────── */

const EventEmitter = require('events');

class MarketDataService extends EventEmitter {

  constructor() {
    super();
    this.prices   = {};   // { EURUSD: { bid, ask, mid, change, changePct, ts } }
    this.candles  = {};   // { "EURUSD_1min": [...] }
    this.ws       = null;
    this.apiKey   = process.env.TWELVE_DATA_KEY || '';
    this.running  = false;
    this.simTimers = {};

    // ── Instrument definitions ─────────────────────────────────────────────
    this.instruments = {
      // Forex
      'EURUSD': { name:'EUR/USD', type:'forex',  spread:0.00012, pipValue:10,   pip:0.0001, digits:5, basePx:1.0850 },
      'GBPUSD': { name:'GBP/USD', type:'forex',  spread:0.00014, pipValue:10,   pip:0.0001, digits:5, basePx:1.2720 },
      'USDJPY': { name:'USD/JPY', type:'forex',  spread:0.012,   pipValue:9.2,  pip:0.01,   digits:3, basePx:149.50 },
      'AUDUSD': { name:'AUD/USD', type:'forex',  spread:0.00014, pipValue:10,   pip:0.0001, digits:5, basePx:0.6580 },
      'USDCAD': { name:'USD/CAD', type:'forex',  spread:0.00016, pipValue:7.6,  pip:0.0001, digits:5, basePx:1.3610 },
      'USDCHF': { name:'USD/CHF', type:'forex',  spread:0.00014, pipValue:11.2, pip:0.0001, digits:5, basePx:0.8980 },
      'NZDUSD': { name:'NZD/USD', type:'forex',  spread:0.00016, pipValue:10,   pip:0.0001, digits:5, basePx:0.6120 },
      'GBPJPY': { name:'GBP/JPY', type:'forex',  spread:0.018,   pipValue:9.2,  pip:0.01,   digits:3, basePx:190.20 },
      'EURJPY': { name:'EUR/JPY', type:'forex',  spread:0.016,   pipValue:9.2,  pip:0.01,   digits:3, basePx:162.10 },
      // Commodities
      'XAUUSD': { name:'Gold',    type:'commodity', spread:0.35, pipValue:1,    pip:0.01,   digits:2, basePx:2330.0 },
      'XAGUSD': { name:'Silver',  type:'commodity', spread:0.04, pipValue:50,   pip:0.001,  digits:3, basePx:27.50  },
      'USOIL':  { name:'WTI Oil', type:'commodity', spread:0.04, pipValue:10,   pip:0.01,   digits:2, basePx:78.50  },
      // Indices
      'US30':   { name:'Dow Jones', type:'index', spread:2.5,    pipValue:1,    pip:1,      digits:1, basePx:38500  },
      'US500':  { name:'S&P 500',   type:'index', spread:0.6,    pipValue:1,    pip:0.01,   digits:2, basePx:5200   },
      'NAS100': { name:'Nasdaq 100',type:'index', spread:1.0,    pipValue:1,    pip:0.01,   digits:2, basePx:18200  },
      'GER40':  { name:'DAX 40',    type:'index', spread:1.5,    pipValue:1,    pip:0.01,   digits:2, basePx:17800  },
    };

    // Initialize all prices
    Object.entries(this.instruments).forEach(([sym, def]) => {
      this.prices[sym] = {
        bid: def.basePx - def.spread / 2,
        ask: def.basePx + def.spread / 2,
        mid: def.basePx,
        change: 0, changePct: 0,
        open: def.basePx,
        high: def.basePx,
        low:  def.basePx,
        ts: Date.now(),
      };
    });
  }

  // ── Start the service ─────────────────────────────────────────────────────
  async start() {
    if (this.running) return;
    this.running = true;

    if (this.apiKey) {
      console.log('[MarketData] Starting with Twelve Data live feed');
      this._startTwelveData();
    } else {
      console.log('[MarketData] No API key — using realistic simulation');
      this._startSimulation();
    }
    this._startCandleAggregator();
  }

  // ── Twelve Data WebSocket ─────────────────────────────────────────────────
  _startTwelveData() {
    const symbols = Object.keys(this.instruments)
      .map(s => {
        const inst = this.instruments[s];
        if (inst.type === 'forex') return s.slice(0,3) + '/' + s.slice(3);
        if (s === 'XAUUSD') return 'XAU/USD';
        if (s === 'XAGUSD') return 'XAG/USD';
        return s;
      });

    try {
      const WebSocket = require('ws');
      this.ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${this.apiKey}`);

      this.ws.on('open', () => {
        console.log('[MarketData] Twelve Data WebSocket connected');
        this.ws.send(JSON.stringify({ action:'subscribe', params: { symbols: symbols.join(',') } }));
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.event === 'price') this._handleLiveTick(msg);
        } catch(_) {}
      });

      this.ws.on('close', () => {
        console.log('[MarketData] WebSocket closed — switching to simulation');
        this._startSimulation();
      });

      this.ws.on('error', () => {
        console.log('[MarketData] WebSocket error — switching to simulation');
        this._startSimulation();
      });
    } catch(_) {
      this._startSimulation();
    }
  }

  _handleLiveTick(msg) {
    // Map Twelve Data symbol back to our format
    const raw = msg.symbol?.replace('/', '') || '';
    const sym = raw === 'XAUUSD' ? 'XAUUSD' : raw === 'XAGUSD' ? 'XAGUSD' : raw;
    const inst = this.instruments[sym];
    if (!inst) return;

    const mid = parseFloat(msg.price);
    const half = inst.spread / 2;
    const prev = this.prices[sym];

    this.prices[sym] = {
      bid: +(mid - half).toFixed(inst.digits),
      ask: +(mid + half).toFixed(inst.digits),
      mid: +mid.toFixed(inst.digits),
      change: +(mid - prev.open).toFixed(inst.digits),
      changePct: +((mid - prev.open) / prev.open * 100).toFixed(3),
      open: prev.open,
      high: Math.max(prev.high, mid),
      low:  Math.min(prev.low,  mid),
      ts: Date.now(),
    };

    this.emit('tick', { symbol: sym, ...this.prices[sym] });
    this._updateCandle(sym);
  }

  // ── Realistic simulation ─────────────────────────────────────────────────
  _startSimulation() {
    if (Object.keys(this.simTimers).length > 0) return; // already running

    Object.keys(this.instruments).forEach(sym => {
      const inst = this.instruments[sym];
      let trend = 0;
      let trendDur = 0;

      const tick = () => {
        if (!this.running) return;

        // Random walk with trend bias and mean reversion
        if (trendDur <= 0) {
          trend = (Math.random() - 0.5) * 0.4;
          trendDur = Math.floor(Math.random() * 20) + 5;
        }
        trendDur--;

        const volatility = inst.basePx * 0.00015;
        const move = (Math.random() - 0.5 + trend * 0.1) * volatility;
        const prev = this.prices[sym];

        // Mean reversion toward base price
        const reversion = (inst.basePx - prev.mid) * 0.001;
        const newMid = prev.mid + move + reversion;
        const half = inst.spread / 2;

        this.prices[sym] = {
          bid: +(newMid - half).toFixed(inst.digits),
          ask: +(newMid + half).toFixed(inst.digits),
          mid: +newMid.toFixed(inst.digits),
          change: +(newMid - prev.open).toFixed(inst.digits),
          changePct: +((newMid - prev.open) / prev.open * 100).toFixed(3),
          open: prev.open,
          high: Math.max(prev.high, newMid),
          low:  Math.min(prev.low,  newMid),
          ts: Date.now(),
        };

        this.emit('tick', { symbol: sym, ...this.prices[sym] });
        this._updateCandle(sym);

        // Different tick speeds per asset type
        const delay = inst.type === 'index' ? 300 : inst.type === 'commodity' ? 500 : 200;
        this.simTimers[sym] = setTimeout(tick, delay + Math.random() * 200);
      };
      this.simTimers[sym] = setTimeout(tick, Math.random() * 1000);
    });
  }

  // ── Candle aggregation ─────────────────────────────────────────────────────
  _startCandleAggregator() {
    // Reset daily open/high/low at midnight UTC
    const resetDaily = () => {
      Object.keys(this.instruments).forEach(sym => {
        const p = this.prices[sym];
        if (p) { p.open = p.mid; p.high = p.mid; p.low = p.mid; }
      });
    };
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    setTimeout(() => { resetDaily(); setInterval(resetDaily, 86400000); }, midnight - now);
  }

  _updateCandle(sym) {
    const tf = '1min';
    const key = `${sym}_${tf}`;
    if (!this.candles[key]) this.candles[key] = [];

    const price = this.prices[sym];
    const bucketMs = 60 * 1000;
    const bucket = Math.floor(price.ts / bucketMs) * bucketMs;
    const arr = this.candles[key];
    const last = arr[arr.length - 1];

    if (!last || last.time !== bucket / 1000) {
      // New candle
      arr.push({ time: bucket / 1000, open: price.mid, high: price.mid, low: price.mid, close: price.mid, volume: 1 });
      if (arr.length > 500) arr.shift();
    } else {
      // Update current candle
      last.high  = Math.max(last.high, price.mid);
      last.low   = Math.min(last.low,  price.mid);
      last.close = price.mid;
      last.volume++;
    }
    this.emit('candle', { symbol: sym, timeframe: tf, candle: arr[arr.length - 1] });
  }

  // ── Historical candles (generated or fetched) ─────────────────────────────
  async getCandles(symbol, timeframe = '1min', count = 200) {
    const inst = this.instruments[symbol];
    if (!inst) return [];

    // Try fetching from Twelve Data REST
    if (this.apiKey) {
      try {
        const tdSym = inst.type === 'forex'
          ? symbol.slice(0,3) + '/' + symbol.slice(3)
          : symbol === 'XAUUSD' ? 'XAU/USD'
          : symbol === 'XAGUSD' ? 'XAG/USD' : symbol;

        const tfMap = { '1min':'1min','5min':'5min','15min':'15min','1h':'1h','4h':'4h','1day':'1day' };
        const url = `https://api.twelvedata.com/time_series?symbol=${tdSym}&interval=${tfMap[timeframe]||'1min'}&outputsize=${count}&apikey=${this.apiKey}&format=JSON`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.values) {
          return data.values.reverse().map(v => ({
            time:   Math.floor(new Date(v.datetime).getTime() / 1000),
            open:   parseFloat(v.open),
            high:   parseFloat(v.high),
            low:    parseFloat(v.low),
            close:  parseFloat(v.close),
            volume: parseFloat(v.volume || 0),
          }));
        }
      } catch(_) {}
    }

    // Generate synthetic candles
    return this._generateCandles(symbol, timeframe, count);
  }

  _generateCandles(symbol, timeframe, count) {
    const inst = this.instruments[symbol];
    const tfSeconds = { '1min':60,'5min':300,'15min':900,'1h':3600,'4h':14400,'1day':86400 };
    const secs = tfSeconds[timeframe] || 60;
    const now = Math.floor(Date.now() / 1000);
    const volatility = inst.basePx * 0.0008;
    const candles = [];
    let price = inst.basePx;
    let trend = 0, trendDur = 0;

    for (let i = count - 1; i >= 0; i--) {
      if (trendDur <= 0) { trend = (Math.random() - 0.5) * 0.3; trendDur = Math.floor(Math.random() * 15) + 3; }
      trendDur--;

      const revert = (inst.basePx - price) * 0.005;
      const open   = price;
      const ticks  = Math.max(4, Math.floor(secs / 60 * 10));
      let hi = open, lo = open, close = open;

      for (let j = 0; j < ticks; j++) {
        const m = (Math.random() - 0.5 + trend * 0.1) * volatility / Math.sqrt(ticks);
        close += m + revert / ticks;
        hi = Math.max(hi, close);
        lo = Math.min(lo, close);
      }
      close += revert;
      price = close;

      candles.unshift({
        time:   now - i * secs,
        open:   +open.toFixed(inst.digits),
        high:   +hi.toFixed(inst.digits),
        low:    +lo.toFixed(inst.digits),
        close:  +close.toFixed(inst.digits),
        volume: Math.floor(Math.random() * 500 + 100),
      });
    }
    return candles;
  }

  // ── Public getters ────────────────────────────────────────────────────────
  getPrice(symbol)    { return this.prices[symbol] || null; }
  getAllPrices()       { return this.prices; }
  getInstruments()    { return this.instruments; }
  getInstrument(sym)  { return this.instruments[sym] || null; }

  stop() {
    this.running = false;
    Object.values(this.simTimers).forEach(clearTimeout);
    this.simTimers = {};
    if (this.ws) { try { this.ws.close(); } catch(_) {} }
  }
}

module.exports = new MarketDataService();
