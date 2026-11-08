from celery import shared_task

from .models import JobOffer
from .offer_review import review


@shared_task
def review_job_offer(offer_id: int) -> None:
    offer = JobOffer.objects.filter(pk=offer_id).first()
    if offer is not None:
        review(offer)
