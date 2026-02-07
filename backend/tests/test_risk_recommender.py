import pandas as pd

from app.risk import recommend_daily_max_loss


def test_recommend_daily_max_loss_with_balance() -> None:
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 10:30:00",
                    "2026-01-02 09:30:00",
                    "2026-01-02 10:30:00",
                ]
            ),
            "pnl": [-100.0, 50.0, -200.0, 25.0],
            "balance": [200_000.0, 200_100.0, 199_900.0, 199_950.0],
        }
    )

    # median balance ~199,975 -> 2% = 3,999.5, 10% cap = 19,997.5 => 3,999.5
    rec = recommend_daily_max_loss(df)
    assert abs(rec - 3999.5) < 1e-9


def test_recommend_daily_max_loss_without_balance_uses_day_pnl_quantiles() -> None:
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                [
                    "2026-01-01 09:30:00",
                    "2026-01-01 10:30:00",
                    "2026-01-02 09:30:00",
                    "2026-01-02 10:30:00",
                    "2026-01-03 09:30:00",
                    "2026-01-03 10:30:00",
                ]
            ),
            "pnl": [-300.0, -300.0, -2000.0, -1000.0, 100.0, 200.0],
        }
    )

    rec = recommend_daily_max_loss(df)
    assert rec >= 1000.0
