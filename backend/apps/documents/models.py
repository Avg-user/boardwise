from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import models

# Files live outside any public URL; served only through a permission-checked view.
# TODO: swap for encrypted storage before real data.
private_storage = FileSystemStorage(location=settings.PRIVATE_MEDIA_ROOT, base_url=None)


def upload_path(instance, filename):
    return f"cases/{instance.case_id}/{filename}"


class Document(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PROCESSING = "processing", "Processing"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"

    case = models.ForeignKey("cases.Case", on_delete=models.CASCADE, related_name="documents")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    file = models.FileField(upload_to=upload_path, storage=private_storage)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100, blank=True)
    extracted_text = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
