from django.contrib.auth import authenticate
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .serializers import LoginResponseSerializer, LoginSerializer, UserSerializer


@extend_schema(request=LoginSerializer, responses=LoginResponseSerializer, auth=[])
@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    user = authenticate(
        request, username=request.data.get("username"), password=request.data.get("password")
    )
    if user is None:
        return Response({"detail": "Invalid credentials."}, status=status.HTTP_400_BAD_REQUEST)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": UserSerializer(user).data})


@extend_schema(request=None, responses={204: None})
@api_view(["POST"])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(request=UserSerializer, responses=UserSerializer)
@api_view(["GET", "PATCH"])
def me(request):
    if request.method == "PATCH":
        s = UserSerializer(request.user, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        return Response(s.data)
    return Response(UserSerializer(request.user).data)
