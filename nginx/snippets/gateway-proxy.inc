# Reject unsupported HTTP verbs early (TRACE, TRACK, CONNECT, etc.)
if ($request_method !~ ^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$) {
    return 405;
}

# Block hidden file & config probing (/.env, /.git, etc.)
location ~ /\.(?!well-known) {
    access_log off;
    log_not_found off;
    return 404;
}

# Dynamically controlled OpenAPI / Swagger block (disabled in production)
include /etc/nginx/snippets/docs-guard.inc;

# Return structured JSON on 429 rate/connection limits for React frontend handling
error_page 429 = @rate_limited;
location @rate_limited {
    default_type application/json;
    add_header Retry-After "30" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    return 429 '{"detail":"Rate limit exceeded. Too many requests from your network; please wait before retrying."}';
}

# Local proxy health endpoint (exempt from rate limits)
location = /nginx-health {
    access_log off;
    default_type application/json;
    return 200 '{"status":"healthy","service":"nginx"}';
}

# Gateway health check (exempt from auth/general burst caps)
location = /health {
    access_log off;
    include /etc/nginx/snippets/proxy-params.inc;
    proxy_pass http://hip_gateway;
}

# 1. Strict Auth Protection (Brute-Force, Credential Stuffing, Reset Floods)
location ~ ^/(api/v1/)?auth/(login|forgot-password|reset-password|refresh|force-reset-password)/?$ {
    limit_req  zone=auth_strict burst=10 nodelay;
    limit_conn conn_per_ip 15;
    include /etc/nginx/snippets/proxy-params.inc;
    proxy_pass http://hip_gateway;
}

# 2. Expensive AI / LLM Endpoints (ELON Chat & LangChain Bed Recommender)
location ~ ^/(api/v1/)?beds/(beds/)?(elon/chat|recommend(/reserve)?)/?$ {
    limit_req  zone=ai_limit burst=6 nodelay;
    limit_conn conn_per_ip 6;
    include /etc/nginx/snippets/proxy-params.inc;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
    proxy_pass http://hip_gateway;
}

# 3. WebSocket Proxy (/ws/beds) — Cap concurrent sockets & handshake bursts per IP
location /ws/ {
    limit_req  zone=ws_handshake burst=10 nodelay;
    limit_conn ws_per_ip 5;
    include /etc/nginx/snippets/proxy-params.inc;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_pass http://hip_gateway;
}

# 4. General API Traffic — Allows parallel clinical dashboard loads while blocking floods
location / {
    limit_req  zone=api_general burst=60 nodelay;
    limit_conn conn_per_ip 30;
    include /etc/nginx/snippets/proxy-params.inc;
    proxy_pass http://hip_gateway;
}

