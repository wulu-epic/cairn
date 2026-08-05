# chrome-headless-shell with CDP for agent browser testing
# Connect via Playwright: connectOverCDP('http://localhost:9222')
FROM debian:bookworm-slim

# Install Chromium + fonts for rendering + curl for health checks
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        chromium \
        fonts-liberation \
        fonts-noto-cjk \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Expose CDP port
EXPOSE 9222

# Launch Chromium headless with CDP
# --no-sandbox: required in Docker (running as root)
# --disable-dev-shm-usage: use /tmp instead of /dev/shm (avoids crashes in small containers)
# --remote-debugging-address=0.0.0.0: expose CDP outside the container
# --remote-allow-origins=*: Chrome 111+ blocks DevTools HTTP requests from non-loopback IPs (Docker proxy)
ENTRYPOINT ["chromium", \
    "--headless", \
    "--no-sandbox", \
    "--disable-gpu", \
    "--disable-dev-shm-usage", \
    "--remote-debugging-port=9222", \
    "--remote-debugging-address=0.0.0.0", \
    "--remote-allow-origins=*"]
