from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8')

    app_env: str = 'dev'
    paper_mode: bool = True

    symbol: str = 'BTC/USDT'
    timeframe: str = '1h'

    okx_api_key: str | None = None
    okx_api_secret: str | None = None
    okx_passphrase: str | None = None

    max_position_usdt: float = 5000.0
    max_daily_loss_usdt: float = 200.0

    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None


settings = Settings()
