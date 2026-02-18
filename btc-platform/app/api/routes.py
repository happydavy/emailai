from fastapi import APIRouter

from app.core.config import settings
from app.exchange.okx_client import OKXClient
from app.execution.paper_engine import PaperEngine
from app.models.types import BacktestResult, EmaBacktestRequest, EngineStatus
from app.services.risk import RiskManager
from app.strategy.ema_cross import simple_backtest

router = APIRouter()

okx = OKXClient()
paper = PaperEngine()
risk = RiskManager(settings.max_position_usdt, settings.max_daily_loss_usdt)


@router.get('/health')
def health():
    return {'ok': True, 'env': settings.app_env}


@router.get('/status', response_model=EngineStatus)
def status():
    return EngineStatus(
        running=paper.running,
        mode='paper' if settings.paper_mode else 'live',
        symbol=settings.symbol,
        timeframe=settings.timeframe,
    )


@router.post('/engine/start')
def start_engine():
    paper.start()
    return {'ok': True, 'running': True}


@router.post('/engine/stop')
def stop_engine():
    paper.stop()
    return {'ok': True, 'running': False}


@router.post('/backtest/ema', response_model=BacktestResult)
def backtest_ema(req: EmaBacktestRequest):
    df = okx.fetch_ohlcv(settings.symbol, settings.timeframe, limit=req.candles)
    result = simple_backtest(df, fast=req.fast, slow=req.slow)
    return BacktestResult(**result)
