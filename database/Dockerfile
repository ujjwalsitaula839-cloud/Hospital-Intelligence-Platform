FROM python:3.12-slim
WORKDIR /migrations
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENTRYPOINT ["python", "migrate.py"]
CMD ["status"]
