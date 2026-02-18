from dataclasses import dataclass


@dataclass
class RiskState:
    daily_pnl_usdt: float = 0.0


class RiskManager:
    def __init__(self, max_position_usdt: float, max_daily_loss_usdt: float):
        self.max_position_usdt = max_position_usdt
        self.max_daily_loss_usdt = max_daily_loss_usdt
        self.state = RiskState()

    def can_open(self, target_position_usdt: float) -> bool:
        if target_position_usdt > self.max_position_usdt:
            return False
        if self.state.daily_pnl_usdt <= -abs(self.max_daily_loss_usdt):
            return False
        return True

    def update_daily_pnl(self, pnl_usdt: float) -> None:
        self.state.daily_pnl_usdt += pnl_usdt
