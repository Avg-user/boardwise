from rest_framework import serializers

from .models import Task


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ["id", "title", "notes", "due_date", "done", "created_by_ai", "created_at"]
        read_only_fields = ["id", "created_by_ai", "created_at"]
