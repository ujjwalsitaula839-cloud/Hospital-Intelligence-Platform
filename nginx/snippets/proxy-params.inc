proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
# Always overwrite X-Forwarded-For with Nginx's verified $remote_addr so attackers cannot inject fake IPs
# (trusted CDN/ALB hops update $remote_addr via set_real_ip_from in nginx.conf).
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;

proxy_connect_timeout 10s;

