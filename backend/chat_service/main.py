import logging

from fastapi import FastAPI, HTTPException

from .laws import ProvinceNotFound
from .llm import respond
from .schemas import ChatRequest, ChatResponse

logger = logging.getLogger(__name__)
app = FastAPI(title="Boardwise chat service")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse, response_model_exclude_none=True)
def chat(request: ChatRequest) -> ChatResponse:
    try:
        reply = respond(request.province, request.messages)
    except ProvinceNotFound:
        raise HTTPException(status_code=404, detail=f"No labour laws found for province '{request.province}'.")
    except Exception:
        logger.exception("OpenRouter request failed")
        raise HTTPException(status_code=502, detail="The language model request failed.")
    return ChatResponse(province=request.province, messages=[*request.messages, reply])
