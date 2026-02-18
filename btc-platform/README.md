# BTC Quant Platform (OKX Spot)

Self-use MVP for BTC spot quant trading on OKX.

## Features (MVP)
- FastAPI control API
- OKX spot market client (via `ccxt`)
- Strategy interface + sample EMA crossover strategy
- Risk guardrails (position limit, daily loss cap)
- Paper trading engine
- Telegram alert hook (optional)

## Quick Start

1. Create env file:
```bash
cp .env.example .env
```

2. Install deps:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

3. Run API:
```bash
uvicorn app.main:app --reload --port 8080
```

4. Health check:
```bash
curl http://127.0.0.1:8080/health
```

## API Endpoints
- `GET /health`
- `GET /status`
- `POST /engine/start`
- `POST /engine/stop`
- `POST /backtest/ema`

## Notes
- Default runs in paper mode (`PAPER_MODE=true`).
- For live trading, set `PAPER_MODE=false` and provide OKX API credentials.
- Start with small size and keep risk limits strict.
