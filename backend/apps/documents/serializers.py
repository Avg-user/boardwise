from rest_framework import serializers

from .models import Document

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


class DocumentSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True)

    class Meta:
        model = Document
        fields = ["id", "file", "original_name", "content_type", "status", "created_at"]
        read_only_fields = ["id", "original_name", "content_type", "status", "created_at"]

    def validate_file(self, f):
        if f.size > MAX_UPLOAD_BYTES:
            raise serializers.ValidationError("File too large (max 20 MB).")
        return f


class DocumentDetailSerializer(DocumentSerializer):
    class Meta(DocumentSerializer.Meta):
        fields = DocumentSerializer.Meta.fields + ["extracted_text"]
        read_only_fields = DocumentSerializer.Meta.read_only_fields + ["extracted_text"]
