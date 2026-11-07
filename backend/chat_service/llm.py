import os

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_openrouter import ChatOpenRouter
from openrouter.errors import ProviderOverloadedResponseError, TooManyRequestsResponseError

from .laws import PROMPTS_DIR, get_province_laws
from .schemas import Message

DEFAULT_MODEL = "liquid/lfm-3-1.7b:free"

# The free model's provider often returns 429 (busy). The OpenRouter SDK only retries 5xx
# responses itself, so busy errors are retried here, waiting longer each time:
# about 1, 2, 4, then 8 s between attempts (plus up to 1 s random jitter), roughly 20 s at most.
RETRY_ON = (TooManyRequestsResponseError, ProviderOverloadedResponseError)
RETRY_ATTEMPTS = 5
RETRY_WAIT = {"initial": 1, "max": 10, "exp_base": 2, "jitter": 1}

prompt = ChatPromptTemplate.from_messages([
    ("system", (PROMPTS_DIR / "system.md").read_text(encoding="utf-8")),
    MessagesPlaceholder("history"),
])


def _to_langchain(message: Message) -> BaseMessage:
    if message.role == "user":
        return HumanMessage(content=message.content)
    extra = {"reasoning_details": message.reasoning_details} if message.reasoning_details else {}
    return AIMessage(content=message.content, additional_kwargs=extra)


def respond(province: str, messages: list[Message]) -> Message:
    labour_law = get_province_laws(province)  # before the model, so an unknown province is a 404, not a 502
    model = ChatOpenRouter(
        model=os.environ.get("OPENROUTER_MODEL") or DEFAULT_MODEL,  # API key read from OPENROUTER_API_KEY
        reasoning={"enabled": True},
        # data_collection is not set to "deny": the free model's only provider may train on prompts.
    ).with_retry(
        retry_if_exception_type=RETRY_ON,
        wait_exponential_jitter=True,
        exponential_jitter_params=RETRY_WAIT,
        stop_after_attempt=RETRY_ATTEMPTS,
    )
    reply = (prompt | model).invoke({
        "province": province,
        "labour_law": labour_law,
        "history": [_to_langchain(m) for m in messages],
    })
    return Message(
        role="assistant",
        content=str(reply.text),
        reasoning_details=reply.additional_kwargs.get("reasoning_details"),
    )
