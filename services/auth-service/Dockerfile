FROM python:3.11-alpine

WORKDIR /app

# Install system dependencies required for compiling certain Python packages
RUN apk add --no-cache gcc musl-dev postgresql-dev

# Copy requirements first to leverage Docker caching
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Run the FastAPI application using Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]