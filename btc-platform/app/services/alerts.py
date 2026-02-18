from __future__ import annotations

import httpx


async def send_telegram(token: str | None, chat_id: str | None, text: str) -> None:
    if not token or not chat_id:
        return
    url = f'https://api.telegram.org/bot{token}/sendMessage'
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(url, json={'chat_id': chat_id, 'text': text})
