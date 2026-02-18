from __future__ import annotations

import ccxt
import pandas as pd

from app.core.config import settings


class OKXClient:
    def __init__(self) -> None:
        cfg = {
            'enableRateLimit': True,
        }
        if not settings.paper_mode:
            cfg.update(
                {
                    'apiKey': settings.okx_api_key,
                    'secret': settings.okx_api_secret,
                    'password': settings.okx_passphrase,
                }
            )
        self.exchange = ccxt.okx(cfg)

    def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int = 500) -> pd.DataFrame:
        rows = self.exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
        df = pd.DataFrame(rows, columns=['ts', 'open', 'high', 'low', 'close', 'volume'])
        df['ts'] = pd.to_datetime(df['ts'], unit='ms', utc=True)
        return df

    def create_market_buy(self, symbol: str, amount: float):
        return self.exchange.create_market_buy_order(symbol, amount)

    def create_market_sell(self, symbol: str, amount: float):
        return self.exchange.create_market_sell_order(symbol, amount)
