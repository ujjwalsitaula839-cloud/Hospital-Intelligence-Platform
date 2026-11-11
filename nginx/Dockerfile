FROM nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/nginx.conf
COPY snippets/ /etc/nginx/snippets/
COPY templates/ /etc/nginx/hip-templates/
COPY docker-entrypoint.d/10-hip-tls-mode.sh /docker-entrypoint.d/10-hip-tls-mode.sh

RUN chmod +x /docker-entrypoint.d/10-hip-tls-mode.sh

EXPOSE 80 443

