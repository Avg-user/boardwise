from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    # Returned by OpenRouter on assistant messages; must be sent back unmodified.
    reasoning_details: list[dict[str, Any]] | None = None


class ChatRequest(BaseModel):
    province: str = Field(default="AB", pattern=r"^[A-Z]{2}$")
    messages: list[Message] = Field(min_length=1)

    @field_validator("messages")
    @classmethod
    def last_message_is_from_user(cls, messages: list[Message]) -> list[Message]:
        if messages[-1].role != "user":
            raise ValueError("the last message must have role 'user'")
        return messages


class ChatResponse(BaseModel):
    province: str
    messages: list[Message]
