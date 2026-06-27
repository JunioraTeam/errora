"""
Default plan catalog (Toman). Modeled loosely on Laravel Nightwatch tiers plus a
PAYG option. Seed into the DB with ``python manage.py seed_plans``.
"""

from __future__ import annotations

DEFAULT_PLANS = [
    {
        "slug": "free",
        "name": "Free",
        "name_fa": "رایگان",
        "description": "برای پروژه‌های شخصی و شروع کار",
        "price_toman_monthly": 0,
        "price_toman_yearly": 0,
        "included_events": 5_000,
        "payg_per_event_toman": 0,
        "retention_days": 7,
        "max_seats": 1,
        "sort_order": 1,
        "features": [
            "۵٬۰۰۰ رویداد در ماه",
            "نگهداری ۷ روزه",
            "ردیابی خطا و گروه‌بندی",
            "۱ کاربر",
        ],
    },
    {
        "slug": "team",
        "name": "Team",
        "name_fa": "تیمی",
        "description": "برای تیم‌های کوچک",
        "price_toman_monthly": 299_000,
        "price_toman_yearly": 2_990_000,
        "included_events": 100_000,
        "payg_per_event_toman": 2,
        "retention_days": 30,
        "max_seats": 10,
        "sort_order": 2,
        "features": [
            "۱۰۰٬۰۰۰ رویداد در ماه",
            "نگهداری ۳۰ روزه",
            "اتصال GitLab",
            "هشدارها و وب‌هوک",
            "تا ۱۰ کاربر",
        ],
    },
    {
        "slug": "business",
        "name": "Business",
        "name_fa": "کسب‌وکار",
        "description": "برای کسب‌وکارهای در حال رشد",
        "price_toman_monthly": 990_000,
        "price_toman_yearly": 9_900_000,
        "included_events": 1_000_000,
        "payg_per_event_toman": 1,
        "retention_days": 90,
        "max_seats": 50,
        "sort_order": 3,
        "features": [
            "۱٬۰۰۰٬۰۰۰ رویداد در ماه",
            "نگهداری ۹۰ روزه",
            "رفع خودکار خطا با هوش مصنوعی",
            "RBAC پیشرفته",
            "تا ۵۰ کاربر",
        ],
    },
    {
        "slug": "payg",
        "name": "Pay as you go",
        "name_fa": "مصرفی",
        "description": "فقط بابت آنچه استفاده می‌کنید پرداخت کنید",
        "price_toman_monthly": 0,
        "price_toman_yearly": 0,
        "included_events": 0,
        "payg_per_event_toman": 3,
        "retention_days": 30,
        "max_seats": 25,
        "is_payg": True,
        "sort_order": 4,
        "features": [
            "بدون هزینه ثابت ماهانه",
            "۳ تومان به ازای هر رویداد",
            "نگهداری ۳۰ روزه",
            "تمام امکانات تیمی",
        ],
    },
]
