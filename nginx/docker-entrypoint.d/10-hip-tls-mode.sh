#!/bin/sh
set -eu

if [ -f /etc/nginx/ssl/cert.pem ] && [ -f /etc/nginx/ssl/key.pem ]; then
    echo "[hip-nginx] TLS certificates detected; enabling HTTPS on :443 with HTTP->HTTPS redirect."
    cp /etc/nginx/hip-templates/https.conf /etc/nginx/conf.d/default.conf
else
    echo "[hip-nginx] No TLS certificates in /etc/nginx/ssl; running HTTP edge proxy on :80."
    cp /etc/nginx/hip-templates/http.conf /etc/nginx/conf.d/default.conf
fi

if [ "${ENABLE_DOCS:-false}" = "true" ]; then
    echo "# OpenAPI docs enabled via ENABLE_DOCS=true" > /etc/nginx/snippets/docs-guard.inc
else
    cat << 'EOF' > /etc/nginx/snippets/docs-guard.inc
location ~ ^/(docs|redoc|openapi\.json)$ {
    access_log off;
    return 404;
}
EOF
fi

