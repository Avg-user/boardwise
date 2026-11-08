"""Aggregates for the HR dashboard, with small-number suppression.

Nothing is shown unless the company has at least HR_MIN_GROUP_SIZE reports in the window. Any
count from 1 to HR_MIN_GROUP_SIZE - 1 is hidden (None). When a breakdown has exactly one hidden
count, the smallest visible one is hidden too, so the hidden one can't be worked out by
subtracting the others from the total. Months and categories are never crossed with each other.
"""
from datetime import date

from django.conf import settings
from django.db.models import Count

from .models import IncidentCategory, IncidentReport

WINDOW_MONTHS = 12


def first_of_month(d: date) -> date:
    return d.replace(day=1)


def add_months(d: date, months: int) -> date:
    total = d.year * 12 + d.month - 1 + months
    return date(total // 12, total % 12 + 1, 1)


def suppress(counts: list[int], k: int) -> list[int | None]:
    shown: list[int | None] = [None if 0 < c < k else c for c in counts]
    hidden = [i for i, c in enumerate(shown) if c is None]
    if len(hidden) == 1:
        visible = [i for i, c in enumerate(shown) if c]
        if visible:
            shown[min(visible, key=lambda i: counts[i])] = None
    return shown


def build(company, today: date | None = None) -> dict:
    k = settings.HR_MIN_GROUP_SIZE
    end = first_of_month(today or date.today())
    start = add_months(end, -(WINDOW_MONTHS - 1))
    months = [add_months(start, i) for i in range(WINDOW_MONTHS)]
    reports = IncidentReport.objects.filter(company=company, occurred_month__gte=start, occurred_month__lte=end)
    total = reports.count()
    base = {"min_group_size": k, "window_start": start, "window_end": end}
    if total < k:
        return {**base, "enough_data": False, "total": None, "months": [], "categories": [], "ongoing": None}

    by_month = dict(reports.values_list("occurred_month").annotate(n=Count("pk")))
    by_category = dict(reports.values_list("category").annotate(n=Count("pk")))
    ongoing = reports.filter(ongoing=True).count()

    month_counts = suppress([by_month.get(m, 0) for m in months], k)
    categories = [c for c, _ in IncidentCategory.choices]
    category_counts = suppress([by_category.get(c, 0) for c in categories], k)
    ongoing_counts = suppress([ongoing, total - ongoing], k)
    return {
        **base,
        "enough_data": True,
        "total": total,
        "months": [{"month": m, "count": n} for m, n in zip(months, month_counts)],
        # Largest first; hidden ones last. Categories nobody reported are left out.
        "categories": sorted(
            ({"category": c, "count": n} for c, n in zip(categories, category_counts) if n != 0),
            key=lambda row: -(row["count"] or 0),
        ),
        "ongoing": {"ongoing": ongoing_counts[0], "resolved": ongoing_counts[1]},
    }
