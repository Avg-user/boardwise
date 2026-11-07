from django.http import FileResponse
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser

from apps.cases.permissions import CaseScopedMixin

from .models import Document
from .serializers import DocumentDetailSerializer, DocumentSerializer


class DocumentViewSet(CaseScopedMixin, mixins.ListModelMixin, mixins.CreateModelMixin,
                      mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """Upload with multipart/form-data field `file`. Files are only reachable via /download/."""

    parser_classes = [MultiPartParser, FormParser]
    queryset = Document.objects.none()

    def get_serializer_class(self):
        return DocumentDetailSerializer if self.action == "retrieve" else DocumentSerializer

    def get_queryset(self):
        return Document.objects.filter(case=self.get_case())

    def perform_create(self, serializer):
        f = serializer.validated_data["file"]
        serializer.save(
            case=self.get_case(), uploaded_by=self.request.user,
            original_name=f.name[:255], content_type=getattr(f, "content_type", "") or "",
        )
        # TODO(llm): enqueue extraction task here, e.g. extract_document.delay(doc.id)

    def perform_destroy(self, instance):
        instance.file.delete(save=False)
        instance.delete()

    @extend_schema(responses={(200, "application/octet-stream"): OpenApiTypes.BINARY})
    @action(detail=True, methods=["get"])
    def download(self, request, case_pk=None, pk=None):
        doc = self.get_object()
        return FileResponse(doc.file.open("rb"), as_attachment=True, filename=doc.original_name)
