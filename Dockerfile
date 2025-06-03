# Use official Node.js image
FROM node:18-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y curl ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Download and install yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp  -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install

# Copy source files
COPY index.js ./

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "index.js"]