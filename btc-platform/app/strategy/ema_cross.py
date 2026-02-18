from __future__ import annotations

import pandas as pd


def ema_signal(df: pd.DataFrame, fast: int = 20, slow: int = 50) -> pd.Series:
    out = df.copy()
    out['ema_fast'] = out['close'].ewm(span=fast, adjust=False).mean()
    out['ema_slow'] = out['close'].ewm(span=slow, adjust=False).mean()
    long_signal = (out['ema_fast'] > out['ema_slow']).astype(int)
    return long_signal


def simple_backtest(df: pd.DataFrame, fast: int = 20, slow: int = 50) -> dict:
    if len(df) < slow + 5:
        return {'trades': 0, 'win_rate': 0.0, 'pnl_pct': 0.0, 'max_drawdown_pct': 0.0}

    sig = ema_signal(df, fast, slow)
    ret = df['close'].pct_change().fillna(0)
    strat_ret = ret * sig.shift(1).fillna(0)

    equity = (1 + strat_ret).cumprod()
    peak = equity.cummax()
    dd = (equity / peak - 1).min()

    # proxy trade count: signal flips
    flips = sig.diff().abs().fillna(0)
    trades = int((flips > 0).sum())

    pnl_pct = float((equity.iloc[-1] - 1) * 100)
    max_dd_pct = float(dd * 100)

    wins = (strat_ret > 0).sum()
    non_zero = (strat_ret != 0).sum()
    win_rate = float((wins / non_zero) * 100) if non_zero else 0.0

    return {
        'trades': trades,
        'win_rate': round(win_rate, 2),
        'pnl_pct': round(pnl_pct, 2),
        'max_drawdown_pct': round(max_dd_pct, 2),
    }
