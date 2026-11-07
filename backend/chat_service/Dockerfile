FROM python:3.12-slim
WORKDIR /app
COPY chat_service/requirements.txt chat_service/requirements.txt
RUN pip install --no-cache-dir -r chat_service/requirements.txt
COPY chat_service/ chat_service/
COPY prompts/ prompts/
EXPOSE 8001
CMD ["uvicorn", "chat_service.main:app", "--host", "0.0.0.0", "--port", "8001"]
