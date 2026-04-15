# Caddy reverse proxy setup for app.llm-insights.com

One-time setup on the VPS. After this, `git pull` + `docker compose up -d`
is enough to ship changes — Caddy runs as a systemd service and stays up.

## Prerequisites

- A record `app.llm-insights.com` → VPS IP (already done, propagated)
- VPS ports 80 and 443 open in the firewall (see step 4)
- `llmi` container running with the new docker-compose binding
  (`127.0.0.1:8080:80` — already in this commit)

## 1. Install Caddy (Ubuntu/Debian)

```bash
# Official Cloudsmith repo — auto-updates via apt:
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
caddy version
```

## 2. Install the Caddyfile

```bash
sudo mkdir -p /var/log/caddy
sudo chown caddy:caddy /var/log/caddy
sudo cp ~/llminsights/deploy/Caddyfile /etc/caddy/Caddyfile

# Validate:
sudo caddy validate --config /etc/caddy/Caddyfile
```

Edit `/etc/caddy/Caddyfile` if you want a different `email` for Let's Encrypt
account notifications (recommended: a real address you monitor).

## 3. Re-deploy the llmi container on the new port

```bash
cd ~/llminsights
git pull                     # picks up the 127.0.0.1:8080:80 binding
docker compose up -d llmi
docker ps --format 'table {{.Names}}\t{{.Ports}}' | grep llmi
# Expect:  127.0.0.1:8080->80/tcp
```

Now port 80 on the host is free — verify:

```bash
sudo ss -tlnp | grep -E ':80|:443'
# Should show nothing bound to 0.0.0.0:80 or :::80 from docker-proxy.
```

## 4. Open firewall

```bash
# UFW (most Ubuntu VPS):
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status

# If using iptables / cloud provider security group, open 80+443 there.
```

## 5. Start Caddy

```bash
sudo systemctl enable --now caddy
sudo systemctl status caddy --no-pager
```

Caddy will automatically:
- bind :80 and :443
- issue a Let's Encrypt cert for `app.llm-insights.com` within ~30 s
- set up HTTP→HTTPS redirect
- auto-renew the cert before expiry (every ~60 days)

Watch it in real time:

```bash
sudo journalctl -u caddy -f
# Look for:  "certificate obtained successfully" with identifiers=["app.llm-insights.com"]
```

## 6. Smoke test

```bash
# From anywhere:
curl -I https://app.llm-insights.com/health
# Expect: HTTP/2 200

curl -I http://app.llm-insights.com
# Expect: HTTP/1.1 308 Permanent Redirect → https://app.llm-insights.com/

# TLS details:
echo | openssl s_client -servername app.llm-insights.com \
  -connect app.llm-insights.com:443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
# Expect: issuer Let's Encrypt, notAfter ~90 days out
```

Open **https://app.llm-insights.com** in the browser — you should see the
SPA + green padlock.

## Updating config later

```bash
sudo $EDITOR /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy    # zero-downtime reload
```

## Troubleshooting

- **Cert stuck on "obtaining"** → check that port 80 is publicly reachable
  (`curl http://app.llm-insights.com/.well-known/acme-challenge/test` from
  outside should at least reach Caddy). Let's Encrypt uses HTTP-01 by default.
- **502 Bad Gateway** → `docker ps` shows llmi down, or not bound to
  `127.0.0.1:8080`. `curl http://127.0.0.1:8080/health` from the VPS should
  return 200.
- **Rate-limited by Let's Encrypt** (5 fails/hour) → wait an hour, then fix
  the underlying issue and `sudo systemctl restart caddy`.
- **Wrong email in cert account** → edit `/etc/caddy/Caddyfile`, delete
  `/var/lib/caddy/.local/share/caddy/acme/acme-v02.api.letsencrypt.org/` and
  reload; Caddy will re-register.

## Future: additional domains / www redirect

Add more site blocks to the Caddyfile, e.g. to redirect apex or www:

```caddy
llm-insights.com, www.llm-insights.com {
    redir https://app.llm-insights.com{uri} permanent
}
```
