from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PaperPortfolio:
    cash_usdt: float = 10000.0
    btc: float = 0.0


class PaperEngine:
    def __init__(self):
        self.portfolio = PaperPortfolio()
        self.running = False

    def start(self):
        self.running = True

    def stop(self):
        self.running = False

    def buy_usdt(self, price: float, usdt: float):
        usdt = min(usdt, self.portfolio.cash_usdt)
        if usdt <= 0:
            return
        qty = usdt / price
        self.portfolio.cash_usdt -= usdt
        self.portfolio.btc += qty

    def sell_all(self, price: float):
        if self.portfolio.btc <= 0:
            return
        self.portfolio.cash_usdt += self.portfolio.btc * price
        self.portfolio.btc = 0.0

    def equity(self, price: float) -> float:
        return self.portfolio.cash_usdt + self.portfolio.btc * price
