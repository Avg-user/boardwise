from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        # is_staff: Boardwise staff, who use the staff tools (/staff in the app).
        fields = ["id", "username", "role", "preferred_language", "is_staff"]
        read_only_fields = ["id", "username", "role", "is_staff"]


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class LoginResponseSerializer(serializers.Serializer):
    token = serializers.CharField()
    user = UserSerializer()


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True)
    role = serializers.ChoiceField(choices=get_user_model().Role.choices)
    preferred_language = serializers.ChoiceField(choices=["en", "fr"], default="en")

    def validate_username(self, value):
        value = value.strip()
        User = get_user_model()
        User.username_validator(value)
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("That username is taken.")
        return value

    def validate(self, attrs):
        user = get_user_model()(username=attrs["username"], role=attrs["role"])
        try:
            validate_password(attrs["password"], user)
        except Exception as exc:  # DjangoValidationError -> field error
            raise serializers.ValidationError({"password": list(getattr(exc, "messages", [str(exc)]))})
        return attrs

    def create(self, data):
        return get_user_model().objects.create_user(**data)
