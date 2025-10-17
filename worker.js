export default {
  async fetch(request) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TradingView Crypto Chart</title>
    <script src="https://unpkg.com/tradingview/charting_library/charting_library.standalone.js"></script>
    <style>
        body { margin: 0; background: #808080; color: #B8860B; font-family: Arial, sans-serif; }
        #container { width: 100vw; height: 100vh; }
    </style>
</head>
<body>
    <div id="container"></div>
    <script>
        // API Key: Replace with your free CryptoCompare API key from https://min-api.cryptocompare.com/
        const apiKey = 'YOUR_API_KEY_HERE';

        // Configuration
        const configurationData = {
            supported_resolutions: ['1', '5', '15', '60', '180', '1D', '1W', '1M'],
            exchanges: [
                { value: 'Binance', name: 'Binance', desc: 'Binance' },
                { value: 'Bitfinex', name: 'Bitfinex', desc: 'Bitfinex' },
                { value: 'Kraken', name: 'Kraken', desc: 'Kraken' },
            ],
            symbols_types: [{ name: 'crypto', value: 'crypto' }]
        };

        // Helper functions
        async function makeApiRequest(path) {
            try {
                const url = new URL(\`https://min-api.cryptocompare.com/\${path}\`);
                url.searchParams.append('api_key', apiKey);
                const response = await fetch(url.toString());
                return response.json();
            } catch (error) {
                throw new Error(\`CryptoCompare request error: \${error}\`);
            }
        }

        function generateSymbol(exchange, fromSymbol, toSymbol) {
            const short = \`\${fromSymbol}/\${toSymbol}\`;
            return {
                short,
                full: \`\${exchange}:\${short}\`,
            };
        }

        function parseFullSymbol(fullSymbol) {
            const match = fullSymbol.match(/^(\\w+):(\\w+)\\/(\\w+)$/);
            if (!match) return null;
            return { exchange: match[1], fromSymbol: match[2], toSymbol: match[3] };
        }

        async function getAllSymbols() {
            const data = await makeApiRequest('data/v3/all/exchanges');
            let allSymbols = [];
            for (const exchange of configurationData.exchanges) {
                const pairs = data.Data[exchange.value]?.pairs || {};
                for (const leftPairPart of Object.keys(pairs)) {
                    const symbols = pairs[leftPairPart].map(rightPairPart => {
                        const symbol = generateSymbol(exchange.value, leftPairPart, rightPairPart);
                        return {
                            symbol: symbol.short,
                            ticker: symbol.full,
                            description: symbol.short,
                            exchange: exchange.value,
                            type: 'crypto'
                        };
                    });
                    allSymbols = [...allSymbols, ...symbols];
                }
            }
            return allSymbols;
        }

        // WebSocket for realtime
        const socket = new WebSocket(\`wss://streamer.cryptocompare.com/v2?api_key=\${apiKey}\`);
        const channelToSubscription = new Map();
        const lastBarsCache = new Map();

        socket.addEventListener('open', () => console.log('[socket] Connected'));
        socket.addEventListener('close', (reason) => console.log('[socket] Disconnected:', reason));
        socket.addEventListener('error', (error) => console.log('[socket] Error:', error));

        function getNextBarTime(barTime, resolution) {
            const date = new Date(barTime);
            const interval = parseInt(resolution) || 1; // Default to 1 if not number
            if (resolution.includes('D')) {
                date.setUTCDate(date.getUTCDate() + interval);
                date.setUTCHours(0, 0, 0, 0);
            } else if (resolution.includes('W')) {
                date.setUTCDate(date.getUTCDate() + 7 * interval);
            } else if (resolution.includes('M')) {
                date.setUTCMonth(date.getUTCMonth() + interval);
            } else {
                date.setUTCMinutes(date.getUTCMinutes() + interval);
            }
            return date.getTime();
        }

        socket.addEventListener('message', (event) => {
            const data = JSON.parse(event.data);
            const { TYPE: type, M: exchange, FSYM: fromSymbol, TSYM: toSymbol, TS: tradeTime, P: tradePrice, Q: tradeVolume } = data;
            if (parseInt(type) !== 0) return;
            const channelString = \`0~\${exchange}~\${fromSymbol}~\${toSymbol}\`;
            const subscriptionItem = channelToSubscription.get(channelString);
            if (!subscriptionItem) return;
            const lastBar = subscriptionItem.lastBar;
            const nextBarTime = getNextBarTime(lastBar.time, subscriptionItem.resolution);
            let bar;
            const tradeTimeMs = tradeTime * 1000;
            if (tradeTimeMs >= nextBarTime) {
                bar = { time: tradeTimeMs, open: tradePrice, high: tradePrice, low: tradePrice, close: tradePrice, volume: tradeVolume };
            } else {
                bar = { ...lastBar, high: Math.max(lastBar.high, tradePrice), low: Math.min(lastBar.low, tradePrice), close: tradePrice, volume: lastBar.volume + tradeVolume };
            }
            subscriptionItem.lastBar = bar;
            // Call the onTick callback
            subscriptionItem.handlers.forEach(handler => handler.callback(bar));
        });

        // Datafeed implementation
        const datafeed = {
            onReady: (callback) => {
                console.log('[onReady]: Method call');
                setTimeout(() => callback(configurationData), 0);
            },
            searchSymbols: async (userInput, exchange, symbolType, onResultReadyCallback) => {
                console.log('[searchSymbols]: Method call');
                const symbols = await getAllSymbols();
                const result = symbols.filter(s => {
                    const isExchangeValid = !exchange || s.exchange === exchange;
                    const isFullSymbolContainsInput = s.ticker.toLowerCase().includes(userInput.toLowerCase());
                    return isExchangeValid && isFullSymbolContainsInput && (!symbolType || s.type === symbolType);
                });
                onResultReadyCallback(result);
            },
            resolveSymbol: async (symbolName, onSymbolResolvedCallback, onResolveErrorCallback) => {
                console.log('[resolveSymbol]: Method call', symbolName);
                const symbols = await getAllSymbols();
                const symbolItem = symbols.find(s => s.ticker === symbolName);
                if (!symbolItem) {
                    onResolveErrorCallback('unknown_symbol');
                    return;
                }
                const symbolInfo = {
                    ticker: symbolItem.ticker,
                    name: symbolItem.symbol,
                    description: symbolItem.description,
                    type: symbolItem.type,
                    exchange: symbolItem.exchange,
                    session: '24x7',
                    timezone: 'Etc/UTC',
                    minmov: 1,
                    pricescale: 10000,
                    has_intraday: true,
                    supported_resolutions: configurationData.supported_resolutions,
                    volume_precision: 2,
                    data_status: 'streaming'
                };
                onSymbolResolvedCallback(symbolInfo);
            },
            getBars: async (symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback, firstDataRequest) => {
                console.log('[getBars]: Method call', symbolInfo.ticker, resolution, periodParams);
                const { from, to } = periodParams;
                const parsedSymbol = parseFullSymbol(symbolInfo.ticker);
                let endpoint;
                if (resolution.includes('D') || resolution.includes('W') || resolution.includes('M')) {
                    endpoint = 'histoday';
                } else if (parseInt(resolution) >= 60) {
                    endpoint = 'histohour';
                } else {
                    endpoint = 'histominute';
                }
                const urlParameters = {
                    e: parsedSymbol.exchange,
                    fsym: parsedSymbol.fromSymbol,
                    tsym: parsedSymbol.toSymbol,
                    toTs: to,
                    limit: 2000
                };
                const query = new URLSearchParams(urlParameters).toString();
                try {
                    const data = await makeApiRequest(\`data/v2/\${endpoint}?\${query}\`);
                    if (data.Response === 'Error' || !data.Data?.Data?.length) {
                        onHistoryCallback([], { noData: true });
                        return;
                    }
                    let bars = data.Data.Data.map(bar => ({
                        time: bar.time * 1000,
                        low: bar.low,
                        high: bar.high,
                        open: bar.open,
                        close: bar.close,
                        volume: bar.volumefrom
                    })).filter(bar => bar.time >= from * 1000 && bar.time < to * 1000);
                    if (firstDataRequest && bars.length) {
                        lastBarsCache.set(symbolInfo.ticker, { ...bars[bars.length - 1] });
                    }
                    onHistoryCallback(bars, { noData: bars.length === 0 });
                } catch (error) {
                    onErrorCallback(error);
                }
            },
            subscribeBars: (symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) => {
                console.log('[subscribeBars]: Method call with subscriberUID:', subscriberUID);
                const parsedSymbol = parseFullSymbol(symbolInfo.ticker);
                const channelString = \`0~\${parsedSymbol.exchange}~\${parsedSymbol.fromSymbol}~\${parsedSymbol.toSymbol}\`;
                const handler = {
                    id: subscriberUID,
                    callback: onRealtimeCallback
                };
                let subscriptionItem = channelToSubscription.get(channelString);
                if (subscriptionItem) {
                    subscriptionItem.handlers.push(handler);
                    return;
                }
                subscriptionItem = {
                    subscriberUID,
                    resolution,
                    lastBar: lastBarsCache.get(symbolInfo.ticker) || { time: Date.now(), open: 0, high: 0, low: 0, close: 0, volume: 0 },
                    handlers: [handler]
                };
                channelToSubscription.set(channelString, subscriptionItem);
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ action: 'SubAdd', subs: [channelString] }));
                }
                onResetCacheNeededCallback(() => {
                    // Optional reset logic
                });
            },
            unsubscribeBars: (subscriberUID) => {
                console.log('[unsubscribeBars]: Method call with subscriberUID:', subscriberUID);
                for (const [channelString, subscriptionItem] of channelToSubscription.entries()) {
                    const handlerIndex = subscriptionItem.handlers.findIndex(handler => handler.id === subscriberUID);
                    if (handlerIndex !== -1) {
                        subscriptionItem.handlers.splice(handlerIndex, 1);
                        if (subscriptionItem.handlers.length === 0) {
                            socket.send(JSON.stringify({ action: 'SubRemove', subs: [channelString] }));
                            channelToSubscription.delete(channelString);
                        }
                        break;
                    }
                }
            }
        };

        // Initialize the widget
        new TradingView.widget({
            container: 'container',
            symbol: 'BINANCE:BTCUSDT',
            interval: 'D',
            timezone: 'Etc/UTC',
            theme: 'dark',
            locale: 'en',
            library_path: 'https://unpkg.com/tradingview/charting_library/',
            datafeed: datafeed,
            disabled_features: [],
            enabled_features: ['show_symbol_logos', 'show_exchange_logos'],
            overrides: {
                'paneProperties.background': '#808080',
                'paneProperties.vertGridProperties.color': '#B8860B',
                'paneProperties.horzGridProperties.color': '#B8860B',
                'scalesProperties.textColor': '#B8860B',
            },
            symbol_search_request_delay: 300,
        });
    </script>
</body>
</html>`;
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  },
};
