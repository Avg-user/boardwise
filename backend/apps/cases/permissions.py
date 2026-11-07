from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import SAFE_METHODS

from .models import Case


class CaseScopedMixin:
    """For views nested under /cases/{case_pk}/.

    Users without access get 404 (not 403) so case IDs don't leak.
    Shared users (HR / law firm) are read-only; only the owner can write.
    """

    def get_case(self) -> Case:
        if not hasattr(self, "_case"):
            self._case = get_object_or_404(
                Case.objects.accessible_by(self.request.user), pk=self.kwargs["case_pk"]
            )
            if self.request.method not in SAFE_METHODS and self._case.owner_id != self.request.user.pk:
                raise PermissionDenied("Only the case owner can modify this case.")
        return self._case
