const COINGECKO_API = 'https://api.coingecko.com/api/v3';

self.addEventListener('message', async (e) => {
    const { method, args } = e.data;
    if (method === 'onReady') {
        postMessage({
            type: 'datafeedReady',
            supported_resolutions: ['1', '5', '15', '30', '60', 'D', 'W', 'M'],
            exchanges: [{ value: '', name: 'All Exchanges', desc: '' }, { value: 'BINANCE', name: 'Binance', desc: 'Binance' }],
            symbols_types: [{ name: 'crypto', value: 'crypto' }]
        });
    } else if (method === 'searchSymbols') {
        const [userInput, exchange, symbolType] = args;
        try {
            const response = await fetch(`${COINGECKO_API}/search?query=${userInput}`);
            const data = await response.json();
            const symbols = data.coins.map(coin => ({
                symbol: coin.symbol.toUpperCase() + 'USD',
                full_name: coin.name + ' USD',
                description: coin.name,
                exchange: 'CRYPTO',
                type: 'crypto',
                logo_urls: [coin.thumb] // برای زیبا کردن نوار جستجو
            }));
            postMessage({ type: 'searchResult', result: symbols });
        } catch (error) {
            postMessage({ type: 'error', error });
        }
    } else if (method === 'resolveSymbol') {
        const [symbolName] = args;
        const [symbol, vs] = symbolName.split('USD'); // فرض BTCUSD
        try {
            const response = await fetch(`${COINGECKO_API}/coins/${symbol.toLowerCase()}`);
            const data = await response.json();
            postMessage({
                type: 'symbolResolved',
                name: symbolName,
                description: data.name,
                type: 'crypto',
                session: '24x7',
                timezone: 'Etc/UTC',
                exchange: 'CRYPTO',
                minmov: 1,
                pricescale: 100,
                has_intraday: true,
                has_daily: true,
                supported_resolutions: ['1', '5', '15', '30', '60', 'D', 'W', 'M'],
                volume_precision: 2,
                data_status: 'streaming'
            });
        } catch (error) {
            postMessage({ type: 'error', error });
        }
    } else if (method === 'getBars') {
        const [symbolInfo, resolution, periodParams] = args;
        const id = symbolInfo.name.split('USD')[0].toLowerCase();
        const from = periodParams.from * 1000;
        const to = periodParams.to * 1000;
        try {
            const response = await fetch(`${COINGECKO_API}/coins/${id}/ohlc?vs_currency=usd&days=${(to - from) / (86400 * 1000)}`);
            const data = await response.json();
            const bars = data.map(bar => ({
                time: bar[0],
                open: bar[1],
                high: bar[2],
                low: bar[3],
                close: bar[4],
                volume: bar[5] || 0 // اگر حجم نباشد
            }));
            postMessage({ type: 'bars', bars, noData: bars.length === 0 });
        } catch (error) {
            postMessage({ type: 'error', error });
        }
    } else if (method === 'subscribeBars') {
        const [symbolInfo, resolution, listenerGuid] = args;
        // Polling برای realtime (هر 10 ثانیه)
        const interval = setInterval(async () => {
            const id = symbolInfo.name.split('USD')[0].toLowerCase();
            try {
                const response = await fetch(`${COINGECKO_API}/simple/price?ids=${id}&vs_currencies=usd`);
                const data = await response.json();
                const price = data[id].usd;
                postMessage({ type: 'tick', listenerGuid, time: Date.now(), close: price, open: price, high: price, low: price, volume: 0 });
            } catch (error) {}
        }, 10000);
        self.subscriptions = self.subscriptions || {};
        self.subscriptions[listenerGuid] = interval;
    } else if (method === 'unsubscribeBars') {
        const [listenerGuid] = args;
        clearInterval(self.subscriptions[listenerGuid]);
        delete self.subscriptions[listenerGuid];
    }
});
