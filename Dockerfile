# Use Node.js 20 LTS as base image
FROM node:20-bullseye

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # FFmpeg and related tools
    ffmpeg \
    # X Virtual Framebuffer for headless operation
    xvfb \
    # Init system for proper signal handling
    dumb-init \
    # Additional dependencies that might be needed
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    # Canvas dependencies (for editly)
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Install editly globally
RUN npm install -g editly

# Copy application code
COPY server.js ./

# Create tmp directory with proper permissions
RUN mkdir -p /tmp && chmod 1777 /tmp

# Set environment variables
ENV NODE_ENV=production
ENV DISPLAY=:99

# Expose port 8080 (Cloud Run default)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Use dumb-init to handle signals properly and run with xvfb
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "Xvfb :99 -screen 0 1024x768x24 -ac +extension GLX +render -noreset & node server.js"]
