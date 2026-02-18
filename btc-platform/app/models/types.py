from pydantic import BaseModel


class EngineStatus(BaseModel):
    running: bool
    mode: str
    symbol: str
    timeframe: str


class EmaBacktestRequest(BaseModel):
    fast: int = 20
    slow: int = 50
    candles: int = 500


class BacktestResult(BaseModel):
    trades: int
    win_rate: float
    pnl_pct: float
    max_drawdown_pct: float
