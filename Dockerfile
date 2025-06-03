# Use official slim Node.js 18 image for smaller size
FROM node:18-slim

# Install required system packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg wget && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean

# Install yt-dlp using pip
RUN pip3 install yt-dlp

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install

# Copy all source files
COPY . ./

# Expose the port your app runs on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]