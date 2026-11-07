from apps.cases.views import CaseChildViewSet

from .models import Task
from .serializers import TaskSerializer


class TaskViewSet(CaseChildViewSet):
    model = Task
    serializer_class = TaskSerializer
    queryset = Task.objects.none()
