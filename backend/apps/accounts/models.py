from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        VICTIM = "victim", "Victim"
        HR = "hr", "HR board"
        LAW_FIRM = "law_firm", "Law firm"

    role = models.CharField(max_length=20, choices=Role.choices, default=Role.VICTIM)
    preferred_language = models.CharField(max_length=10, default="en")
