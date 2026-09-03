FROM python:3.11-alpine

WORKDIR /app

# Install system dependencies required for compiling PostgreSQL drivers
RUN apk add --no-cache gcc musl-dev postgresql-dev libffi-dev

# Copy and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application source code
COPY . .

EXPOSE 8003

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]