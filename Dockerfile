# Minimal Dockerfile for debugging
FROM node:18-bullseye-slim

# Install only essential dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    xvfb \
    dumb-init \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy server
COPY server.js ./

# Environment variables
ENV NODE_ENV=production
ENV DISPLAY=:99
ENV PORT=8080

EXPOSE 8080

# Simple startup without user switching
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "Xvfb :99 -screen 0 1024x768x24 & sleep 2 && node server.js"]
